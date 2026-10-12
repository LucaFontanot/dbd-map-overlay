// Shared lobby: one player picks a map, everyone in the lobby sees it.
// Main holds the user token and talks to the server (src/core/api.js).
import {reactive} from 'vue';
import {dbd} from './bridge';
import {debugLog} from './logger';
import {settings} from './settings';
import {catalog} from './catalog';
import {player} from './player';

// Lobby state is polled only while joined
const POLL_INTERVAL_MS = 15000;

/** Server-provided rotation → integer 0-359, or null when not a finite number. */
export function normalizeRotation(value) {
    const num = typeof value === 'string' ? Number(value) : value;
    if (typeof num !== 'number' || !Number.isFinite(num)) return null;
    return ((Math.round(num) % 360) + 360) % 360;
}

const state = reactive({
    joined: false,
    id: 0,
    code: '',
    creator: false,
    // Creator closed the lobby to new players
    closed: false,
    busy: false,
});

// Last values applied from the server, so a poll only acts on changes
const remote = {map: '', mapBase64Hash: '', lastMapUser: '', rotation: 0};
let pollTimer = null;

function stopPolling() {
    if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => lobby.checkUpdate(), POLL_INTERVAL_MS);
}

async function busy(task) {
    state.busy = true;
    try {
        return await task();
    } catch (e) {
        debugLog('lobby::error', e.message);
        return null;
    } finally {
        state.busy = false;
    }
}

function enter(response, creator) {
    state.id = response.id;
    state.code = String(response.code);
    state.joined = true;
    state.creator = creator;
    state.closed = false;
    startPolling();
    return lobby.checkUpdate();
}

export const lobby = {
    state,

    /** @returns {Promise<boolean>} */
    create() {
        return busy(async () => {
            const response = await dbd.invoke('lobby-create');
            if (!response || !response.ok) return false;
            await enter(response, true);
            return true;
        });
    },

    /** @returns {Promise<boolean>} */
    join(code) {
        return busy(async () => {
            const response = await dbd.invoke('lobby-join', code);
            if (!response || !response.ok) return false;
            await enter(response, false);
            return true;
        });
    },

    /** Creator only: open (true) or close (false) the lobby to new players. */
    setOpen(open) {
        if (!state.joined || !state.creator) return Promise.resolve(false);
        return busy(async () => {
            const response = await dbd.invoke('lobby-set-status', state.id, open);
            if (!response || !response.ok) return false;
            state.closed = !open;
            return true;
        });
    },

    leave() {
        if (!state.joined) return Promise.resolve(false);
        return busy(async () => {
            const response = await dbd.invoke('lobby-leave', state.id);
            if (!response || !response.ok) return false;
            stopPolling();
            Object.assign(state, {joined: false, id: 0, code: '', creator: false, closed: false});
            remote.map = '';
            return true;
        });
    },

    async setMap(map, type) {
        if (!state.joined) return;
        try {
            const rotation = parseInt(settings.get('rotation'), 10) || 0;
            const response = await dbd.invoke('lobby-set-map', state.id, map, type, rotation);
            // Keep the local rotation state in step with what we sent
            if (response) remote.rotation = rotation;
        } catch (e) {
            debugLog('lobby::setMap::error', e.message);
        }
    },

    async checkUpdate() {
        if (!state.joined) return;
        try {
            const data = await dbd.invoke('lobby-get', state.id);
            if (!data || !data.ok) {
                debugLog('lobby::checkUpdate::error', 'Failed to fetch lobby data');
                return;
            }
            if (data.rotation !== undefined && data.rotation !== null) {
                const rotation = normalizeRotation(data.rotation);
                if (rotation === null) {
                    debugLog('lobby::checkUpdate::invalid-rotation', String(data.rotation).slice(0, 50));
                } else if (rotation !== remote.rotation) {
                    remote.rotation = rotation;
                    await settings.set('rotation', rotation);
                }
            }
            if (data.type === 'standard') {
                if (remote.map === data.map) return;
                await catalog.whenLoaded();
                // Only maps we have downloaded are shown ("" hides the
                // overlay); never pass an arbitrary server path on.
                const localPath = data.map === '' ? '' : catalog.resolveLocalMapPath(data.map);
                remote.map = data.map;
                if (localPath === null) {
                    debugLog('lobby::checkUpdate::unknown-map', String(data.map).slice(0, 200));
                    return;
                }
                remote.mapBase64Hash = '';
                await player.sendMap(localPath, 'standard', false);
            } else if (data.type === 'custom') {
                if (remote.lastMapUser === data.last_changer || remote.mapBase64Hash === data.map64hash) return;
                const image = await dbd.invoke('lobby-custom-image', state.id);
                if (image && image.ok && typeof image.map === 'string' && image.map !== '') {
                    remote.mapBase64Hash = data.map64hash;
                    remote.map = '';
                    await player.sendMap(image.map, 'base64', false);
                }
            }
        } catch (e) {
            debugLog('lobby::checkUpdate::error', e.message);
        }
    },

    listen() {
        // System hotkey (Ctrl+P by default): poll now
        dbd.on('check-lobby-update', () => this.checkUpdate());
    },
};
