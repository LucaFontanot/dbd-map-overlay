// Keeps <userData>/photo in sync with the generated-pictures branch:
// deletes files the catalog dropped, downloads new/changed ones (md5 checked).
// Runs in main: the renderer only asks for it (`maps-sync`) and gets progress.
const {app, ipcMain} = require('electron');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {safeJoin} = require('./utils');
const UserData = require('./user-data');

const ASSETS_BASE = 'https://raw.githubusercontent.com/LucaFontanot/dbd-map-overlay/refs/heads/generated-pictures';
// Parallel image downloads during the catalog sync.
const DOWNLOAD_CONCURRENCY = 4;
const DOWNLOAD_TIMEOUT_MS = 15000;

/** `\Creator\Realm\Map.png` / `/Creator/Realm/Map.png` → `Creator/Realm/Map.png` */
function normalizePhotoKey(p) {
    return String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

/** Runs `worker` over `items` with at most `limit` calls in flight. */
async function runLimited(items, limit, worker) {
    let next = 0;
    const runners = [];
    for (let i = 0; i < Math.min(limit, items.length); i++) {
        runners.push((async () => {
            while (next < items.length) {
                const item = items[next++];
                await worker(item);
            }
        })());
    }
    await Promise.all(runners);
}

function md5(buffer) {
    return crypto.createHash('md5').update(buffer).digest('hex');
}

/**
 * Catalog entries look like {filePath: "maps/Creator/Realm/Map.png", md5}.
 * @returns {{key: string, url: string, md5: string}|null} key relative to the photo dir
 */
function parseCatalogEntry(entry) {
    if (!entry || typeof entry.filePath !== 'string' || typeof entry.md5 !== 'string') return null;
    const normalized = entry.filePath.replace(/\\/g, '/');
    if (!normalized.startsWith('maps/')) return null;
    const key = normalizePhotoKey(normalized.slice('maps/'.length));
    if (!key) return null;
    return {key, url: entry.filePath, md5: entry.md5};
}

class PhotoSync {
    constructor(mainWindow, {onSynced} = {}) {
        this.mainWindow = mainWindow;
        this.onSynced = onSynced;
        this.running = null;
        // One sync per call site at a time; repeated clicks share the run
        ipcMain.handle('maps-sync', () => this.sync());
    }

    progress(message) {
        this.mainWindow.send('maps-sync-progress', message);
    }

    sync() {
        if (!this.running) {
            this.running = this.run().finally(() => {
                this.running = null;
            });
        }
        return this.running;
    }

    async run() {
        const root = path.join(app.getPath('userData'), 'photo');
        let catalog;
        try {
            this.progress('Checking map catalog');
            const res = await axios.get(`${ASSETS_BASE}/images.json?t=${Date.now()}`, {timeout: DOWNLOAD_TIMEOUT_MS});
            catalog = (Array.isArray(res.data) ? res.data : []).map(parseCatalogEntry).filter(Boolean);
        } catch (e) {
            console.warn('photo-sync: catalog unavailable:', e.message);
            this.progress(null);
            return {ok: false, error: e.message};
        }

        if (catalog.length === 0) {
            // An empty/unparseable catalog would delete every local map below
            console.warn('photo-sync: empty catalog, keeping local maps');
            this.progress(null);
            return {ok: false, error: 'empty catalog'};
        }
        const local = await UserData.computePhotoHashes(root);
        const wanted = new Set(catalog.map(entry => entry.key));
        let deleted = 0;
        for (const key of Object.keys(local)) {
            if (wanted.has(normalizePhotoKey(key))) continue;
            try {
                await fs.promises.rm(safeJoin(root, key), {force: true});
                deleted++;
            } catch (e) {
                console.warn('photo-sync: cannot delete', key, e.message);
            }
        }

        const localByKey = {};
        for (const [key, hash] of Object.entries(local)) localByKey[normalizePhotoKey(key)] = hash;
        const toDownload = catalog.filter(entry => localByKey[entry.key] !== entry.md5);
        let done = 0;
        let failed = 0;
        await runLimited(toDownload, DOWNLOAD_CONCURRENCY, async (entry) => {
            this.progress(`Updating ${path.posix.basename(entry.key)} (${done + 1}/${toDownload.length})`);
            try {
                const target = safeJoin(root, entry.key);
                const res = await axios.get(`${ASSETS_BASE}/${entry.url}?md5=${entry.md5}`, {
                    responseType: 'arraybuffer',
                    timeout: DOWNLOAD_TIMEOUT_MS,
                });
                const data = Buffer.from(res.data);
                // Truncated/corrupted download or tampered CDN copy: keep the
                // local file, retry on the next sync.
                if (md5(data) !== entry.md5) throw new Error('md5 mismatch');
                await fs.promises.mkdir(path.dirname(target), {recursive: true});
                const tmp = target + '.part';
                await fs.promises.writeFile(tmp, data);
                await fs.promises.rename(tmp, target);
            } catch (e) {
                failed++;
                console.warn('photo-sync: download failed', entry.key, e.message);
            } finally {
                done++;
            }
        });
        this.progress(null);
        const result = {ok: true, downloaded: toDownload.length - failed, failed, deleted};
        if (toDownload.length || deleted) console.log('photo-sync:', result);
        if (this.onSynced) {
            try {
                await this.onSynced(result);
            } catch (e) {
                console.warn('photo-sync: onSynced failed:', e.message);
            }
        }
        return result;
    }
}

module.exports = PhotoSync;
module.exports.parseCatalogEntry = parseCatalogEntry;
module.exports.normalizePhotoKey = normalizePhotoKey;
