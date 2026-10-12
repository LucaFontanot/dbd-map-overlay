const {ensureDirectoryExistence, getFilesFromDir, safeJoin} = require("./utils");
const {app, ipcMain, protocol, net} = require("electron");
const {pathToFileURL} = require("url");
const {imageSize} = require("image-size");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// Gallery images are served to the renderer as dbd-img://photo/<key> and
// dbd-img://custom/<key> instead of being copied over IPC.
const IMAGE_SCHEME = "dbd-img";
const IMAGE_KINDS = new Set(["photo", "custom"]);
const MAX_CUSTOM_IMAGE_BYTES = 20 * 1024 * 1024;
// Gallery thumbnails (?thumb): maps are up to 3840 px, decoding 200 of them
// at full size cost hundreds of MB in the renderer.
const THUMB_SIZE = 480;
const thumbJobs = new Map();
const CUSTOM_NAME = /^[^/\\\0]{1,120}\.png$/;

// Per-file MD5 cache for photo-sync, keyed by relative path → {size, mtimeMs, md5}.
// Lives inside the photo dir, so every listing of that dir must skip it.
const MD5_CACHE_NAME = ".md5cache.json";

// Also matches the ".tmp" sibling used for the atomic write
function isCacheFile(file) {
    return path.basename(file).startsWith(MD5_CACHE_NAME);
}

function baseDir(kind) {
    return path.join(app.getPath('userData'), kind);
}

// "/Creator/Realm/Map.png" — same shape get-dir-photos returns, with forward slashes
function toKey(root, file) {
    return "/" + path.relative(root, file).split(path.sep).join("/");
}

async function md5File(file) {
    const hash = crypto.createHash('md5');
    hash.update(await fs.promises.readFile(file));
    return hash.digest('hex');
}

async function listFiles(dir) {
    let results = [];
    let entries;
    try {
        entries = await fs.promises.readdir(dir, {withFileTypes: true});
    } catch (e) {
        if (e.code === 'ENOENT') return results;
        throw e;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results = results.concat(await listFiles(full));
        } else if (entry.isFile()) {
            results.push(full);
        }
    }
    return results;
}

/**
 * WebP thumbnail of `file`, cached under <userData>/thumbs and rebuilt when
 * the source is newer. Concurrent requests for the same file share one job.
 * @returns {Promise<string>} thumbnail path
 */
async function thumbnailFor(kind, rel, file) {
    const thumb = safeJoin(path.join(app.getPath('userData'), 'thumbs', kind), rel + '.webp');
    const [source, cached] = await Promise.all([
        fs.promises.stat(file),
        fs.promises.stat(thumb).catch(() => null),
    ]);
    if (cached && cached.mtimeMs >= source.mtimeMs) return thumb;
    if (!thumbJobs.has(thumb)) {
        const job = (async () => {
            // Lazy: sharp is heavy and only needed once per new/changed map
            const sharp = require('sharp');
            await fs.promises.mkdir(path.dirname(thumb), {recursive: true});
            const tmp = `${thumb}.${process.pid}.tmp`;
            await sharp(file)
                .resize({width: THUMB_SIZE, height: THUMB_SIZE, fit: 'inside', withoutEnlargement: true})
                .webp({quality: 82})
                .toFile(tmp);
            await fs.promises.rename(tmp, thumb);
            return thumb;
        })().finally(() => thumbJobs.delete(thumb));
        thumbJobs.set(thumb, job);
    }
    return thumbJobs.get(thumb);
}

class UserData {
    constructor() {
        const readFile = async (kind, fileName) => {
            const file = safeJoin(baseDir(kind), fileName)
            try {
                return await fs.promises.readFile(file);
            } catch (e) {
                if (e.code !== 'ENOENT') console.error(`read ${kind} data failed:`, fileName, e);
                return Buffer.from("")
            }
        }
        const listDir = (kind) => {
            const fileDir = baseDir(kind)
            fs.mkdirSync(fileDir, {recursive: true})
            return getFilesFromDir(fileDir)
                .map((file) => file.replace(fileDir.toString(), ""))
                .filter((file) => !isCacheFile(file) && !file.endsWith(".part"))
        }

        // Only custom maps are written/deleted from the renderer; the photo
        // dir belongs to photo-sync.js.
        ipcMain.handle('read-custom-data', (event, fileName) => readFile("custom", fileName))
        ipcMain.handle('write-custom-data', async (event, fileName, data) => {
            if (typeof fileName !== 'string' || !CUSTOM_NAME.test(fileName) || fileName.includes('..')) {
                throw new Error('write-custom-data: invalid name');
            }
            if (!(data instanceof Uint8Array) || data.length === 0 || data.length > MAX_CUSTOM_IMAGE_BYTES) {
                throw new Error('write-custom-data: invalid image data');
            }
            const buffer = Buffer.from(data);
            try {
                imageSize(buffer);
            } catch (e) {
                throw new Error('write-custom-data: not an image');
            }
            const file = safeJoin(baseDir("custom"), fileName)
            ensureDirectoryExistence(file)
            await fs.promises.writeFile(file, buffer);
        })
        ipcMain.handle('delete-custom-data', async (event, fileName) => {
            await fs.promises.rm(safeJoin(baseDir("custom"), fileName), {force: true});
        })
        ipcMain.handle('get-dir-photos', async () => listDir("photo"))
        ipcMain.handle('get-custom-photos', async () => listDir("custom"))

        UserData.registerImageProtocol();
    }

    /**
     * dbd-img://<photo|custom>/<url-encoded relative path>. Must be called
     * before app ready (scheme privileges), the handler is installed on ready.
     */
    static registerImageProtocol() {
        protocol.registerSchemesAsPrivileged([{
            scheme: IMAGE_SCHEME,
            privileges: {standard: true, secure: true, supportFetchAPI: true},
        }]);
        app.whenReady().then(() => {
            protocol.handle(IMAGE_SCHEME, async (request) => {
                try {
                    const url = new URL(request.url);
                    if (!IMAGE_KINDS.has(url.hostname)) return new Response(null, {status: 404});
                    const rel = decodeURIComponent(url.pathname);
                    const file = safeJoin(baseDir(url.hostname), rel);
                    if (isCacheFile(file)) return new Response(null, {status: 404});
                    let served = file;
                    if (url.searchParams.has('thumb')) {
                        try {
                            served = await thumbnailFor(url.hostname, rel, file);
                        } catch (e) {
                            // Unreadable by sharp: fall back to the original file
                            if (e.code === 'ENOENT') return new Response(null, {status: 404});
                            console.warn('dbd-img: thumbnail failed for', rel, e.message);
                        }
                    }
                    return await net.fetch(pathToFileURL(served).toString());
                } catch (e) {
                    return new Response(null, {status: 404});
                }
            });
        });
    }

    /**
     * MD5 of every file under `root`, keyed "/Creator/Realm/Map.png".
     * Unchanged files (same size + mtime) reuse the hash stored in
     * `<root>/.md5cache.json`, so only new or edited files are read.
     * @param {string} root
     * @returns {Promise<Object<string, string>>}
     */
    static async computePhotoHashes(root) {
        const cacheFile = path.join(root, MD5_CACHE_NAME);
        let cache = {};
        try {
            cache = JSON.parse(await fs.promises.readFile(cacheFile, "utf-8")) || {};
        } catch (e) {
            if (e.code !== 'ENOENT') console.warn("get-photo-hashes: ignoring unreadable cache:", e.message);
        }

        const result = {};
        const nextCache = {};
        let dirty = false;
        for (const file of await listFiles(root)) {
            if (isCacheFile(file)) continue;
            const key = toKey(root, file);
            try {
                const stat = await fs.promises.stat(file);
                const hit = cache[key];
                let md5;
                if (hit && hit.size === stat.size && hit.mtimeMs === stat.mtimeMs && hit.md5) {
                    md5 = hit.md5;
                } else {
                    md5 = await md5File(file);
                    dirty = true;
                }
                nextCache[key] = {size: stat.size, mtimeMs: stat.mtimeMs, md5};
                result[key] = md5;
            } catch (e) {
                console.error("get-photo-hashes: failed to hash", file, e);
            }
        }
        if (Object.keys(cache).length !== Object.keys(nextCache).length) dirty = true;

        if (dirty) {
            try {
                await fs.promises.mkdir(root, {recursive: true});
                const tmp = cacheFile + ".tmp";
                await fs.promises.writeFile(tmp, JSON.stringify(nextCache));
                await fs.promises.rename(tmp, cacheFile);
            } catch (e) {
                console.error("get-photo-hashes: failed to write cache:", e);
            }
        }
        return result;
    }
}

module.exports = UserData;
