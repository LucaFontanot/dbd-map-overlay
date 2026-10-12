// In-app docs (FAQ, changelog, credits, privacy) are Markdown fetched from
// GitHub master at runtime; the renderer renders them through DOMPurify.
const {ipcMain} = require('electron');
const axios = require('axios');

const DOCS_BASE = 'https://raw.githubusercontent.com/LucaFontanot/dbd-map-overlay/master';
const DOCS = {
    privacy: 'TERMS%20AND%20PRIVACY.md',
    faq: 'FAQ.md',
    changelog: 'CHANGELOG.md',
    credits: 'CREDITS.md',
};
const CACHE_MS = 10 * 60 * 1000;

class Docs {
    constructor() {
        this.cache = new Map();
        ipcMain.handle('docs-get', (event, name) => this.get(name));
    }

    async get(name) {
        if (!Object.prototype.hasOwnProperty.call(DOCS, name)) throw new Error('docs-get: unknown document');
        const hit = this.cache.get(name);
        if (hit && Date.now() - hit.at < CACHE_MS) return hit.text;
        const res = await axios.get(`${DOCS_BASE}/${DOCS[name]}`, {responseType: 'text', timeout: 15000});
        const text = String(res.data || '');
        this.cache.set(name, {text, at: Date.now()});
        return text;
    }
}

module.exports = Docs;
