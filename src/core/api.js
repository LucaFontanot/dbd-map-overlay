// Lobby backend client. Lives in main so the user token never reaches a
// renderer: the page calls the `lobby-*` handlers below, main adds the token.
const {ipcMain} = require('electron');
const axios = require('axios');
const crypto = require('crypto');

const BASEURL = 'https://dbdmap.lucaservers.com';
const REQUEST_TIMEOUT_MS = 15000;
// Custom lobby maps travel as base64 PNG; refuse anything absurd
const MAX_MAP_PAYLOAD = 20 * 1024 * 1024;

// Proof-of-work challenge (formerly src/js/jspow.js). Server-controlled
// difficulty: bound the work so a bad/hostile challenge can't spin forever.
const MAX_DIFFICULTY = 6;
const MAX_ITERATIONS = 5e7;

function sha256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

// Hashes per slice before yielding: difficulty 6 is ~16M hashes, which would
// freeze main (every window, IPC and the overlay) for tens of seconds.
const YIELD_EVERY = 20000;
const yieldToLoop = () => new Promise(resolve => setImmediate(resolve));

/** @returns {Promise<number|null>} the answer whose hash starts with `conf.nonce` */
async function computeNonce(conf) {
    const nonce = conf.nonce ? String(conf.nonce) : '0';
    const data = conf.data ? String(conf.data) : '';
    let difficulty = parseInt(conf.difficulty, 10);
    if (!Number.isFinite(difficulty) || difficulty < 1) difficulty = 4;
    // A prefix longer/shorter than the difficulty can never match
    if (difficulty > MAX_DIFFICULTY || nonce.length !== difficulty) return null;
    for (let answer = 0; answer < MAX_ITERATIONS; answer++) {
        if (sha256(data + answer).substring(0, difficulty) === nonce) return answer;
        if (answer % YIELD_EVERY === YIELD_EVERY - 1) await yieldToLoop();
    }
    return null;
}

/**
 * Copy of a request/response object that is safe to log: the user token is
 * never written out and base64 map payloads are reduced to their length.
 */
function redact(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const out = {};
    for (const [key, value] of Object.entries(obj)) {
        if (key === 'user' || key === 'token') {
            out[key] = '<redacted>';
        } else if (typeof value === 'string' && value.length > 200) {
            out[key] = `<${value.length} chars>`;
        } else {
            out[key] = value;
        }
    }
    return out;
}

const isId = (v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length > 0 && v.length <= 100);

class API {
    constructor(settings, baseUrl = BASEURL) {
        this.settings = settings;
        this.baseUrl = baseUrl;
        this.registering = null;
        this.registerIpc();
    }

    get token() {
        return this.settings.get('token') || '';
    }

    /** Registers this install once; later calls share the same attempt. */
    ensureRegistered() {
        if (this.token) return Promise.resolve(true);
        if (!this.registering) {
            this.registering = this.register().finally(() => {
                this.registering = null;
            });
        }
        return this.registering;
    }

    async register() {
        try {
            const res = await axios.get(this.baseUrl + '/api/register', {responseType: 'json', timeout: REQUEST_TIMEOUT_MS});
            if (!res.data || typeof res.data.token !== 'string') return false;
            this.settings.set('token', res.data.token);
            if (res.data.id) this.settings.set('id', res.data.id);
            return true;
        } catch (e) {
            console.warn('api: register failed:', e.message);
            return false;
        }
    }

    async verificationHeader(fields, data) {
        const digest = sha256(data.join(','));
        let header = `target="${fields.join(',')}" digest="SHA256${digest}" `;
        let payload;
        try {
            const res = await axios.get(this.baseUrl + '/api/challange?data=' + encodeURIComponent(digest), {timeout: REQUEST_TIMEOUT_MS});
            payload = res.data;
        } catch (e) {
            console.warn('api: challenge failed:', e.message);
            return '-1';
        }
        if (!payload || typeof payload !== 'object') return '-1';
        const answer = await computeNonce(payload);
        if (answer === null) return '-1';
        header += `token="${payload.token}" `;
        header += `answer="${answer}"`;
        return header;
    }

    async post(endpoint, fields, {challenge = false} = {}) {
        await this.ensureRegistered();
        const body = {user: this.token, ...fields};
        const headers = {'content-type': 'application/json'};
        if (challenge) headers['l-content-sec'] = await this.verificationHeader(['(body)'], [body]);
        try {
            const res = await axios.post(this.baseUrl + '/api/' + endpoint, body, {headers, timeout: REQUEST_TIMEOUT_MS});
            return res.data;
        } catch (e) {
            console.warn(`api: ${endpoint} failed:`, e.message, redact(fields));
            return null;
        }
    }

    registerIpc() {
        ipcMain.handle('lobby-create', () => this.post('createLobby', {}, {challenge: true}));
        ipcMain.handle('lobby-join', (event, code) => {
            if (!Number.isInteger(code)) throw new Error('lobby-join: invalid code');
            return this.post('joinRoom', {code}, {challenge: true});
        });
        ipcMain.handle('lobby-set-status', (event, id, status) => {
            if (!isId(id) || typeof status !== 'boolean') throw new Error('lobby-set-status: invalid arguments');
            return this.post('setCloseStatus', {id, status});
        });
        ipcMain.handle('lobby-leave', (event, id) => {
            if (!isId(id)) throw new Error('lobby-leave: invalid id');
            return this.post('leaveRoom', {id});
        });
        ipcMain.handle('lobby-set-map', (event, id, map, type, rotation) => {
            if (!isId(id) || typeof map !== 'string' || map.length > MAX_MAP_PAYLOAD ||
                !['standard', 'custom'].includes(type)) {
                throw new Error('lobby-set-map: invalid arguments');
            }
            return this.post('setMap', {id, map, type, rotation: Number.isFinite(rotation) ? rotation : 0});
        });
        ipcMain.handle('lobby-get', (event, id) => {
            if (!isId(id)) throw new Error('lobby-get: invalid id');
            return this.post('getLobbyData', {id});
        });
        ipcMain.handle('lobby-custom-image', (event, id) => {
            if (!isId(id)) throw new Error('lobby-custom-image: invalid id');
            return this.post('getLobbyCustomImage', {id});
        });
    }
}

module.exports = API;
module.exports.computeNonce = computeNonce;
module.exports.redact = redact;
module.exports.BASEURL = BASEURL;
