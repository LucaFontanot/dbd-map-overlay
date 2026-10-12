const {ensureDirectoryExistence, getFilesFromDir, deleteDirectoryContents, safeJoin} = require("./utils");
const {app, ipcMain} = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// Per-file MD5 cache for get-photo-hashes, keyed by relative path → {size, mtimeMs, md5}.
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

class UserData {
    constructor() {
        const readFile = async (kind, fileName) => {
            const fileDir = safeJoin(baseDir(kind), fileName)
            ensureDirectoryExistence(fileDir)
            try {
                return await fs.promises.readFile(fileDir);
            } catch (e) {
                if (e.code !== 'ENOENT') console.error(`read ${kind} data failed:`, fileName, e);
                return Buffer.from("")
            }
        }
        const writeFile = async (kind, fileName, data) => {
            const fileDir = safeJoin(baseDir(kind), fileName)
            ensureDirectoryExistence(fileDir)
            await fs.promises.writeFile(fileDir, Buffer.from(data));
        }
        const deleteFile = async (kind, fileName) => {
            const fileDir = safeJoin(baseDir(kind), fileName)
            await fs.promises.rm(fileDir, {force: true});
        }
        const listDir = (kind) => {
            const fileDir = baseDir(kind)
            fs.mkdirSync(fileDir, {recursive: true})
            return getFilesFromDir(fileDir)
                .map((file) => file.replace(fileDir.toString(), ""))
                .filter((file) => !isCacheFile(file))
        }

        ipcMain.handle('read-user-data', (event, fileName) => readFile("photo", fileName))
        ipcMain.handle('read-custom-data', (event, fileName) => readFile("custom", fileName))
        ipcMain.handle('write-user-data', (event, fileName, data) => writeFile("photo", fileName, data))
        ipcMain.handle('write-custom-data', (event, fileName, data) => writeFile("custom", fileName, data))
        ipcMain.handle('delete-user-data', (event, fileName) => deleteFile("photo", fileName))
        ipcMain.handle('delete-custom-data', (event, fileName) => deleteFile("custom", fileName))
        ipcMain.handle('get-dir-photos', async () => listDir("photo"))
        ipcMain.handle('get-custom-photos', async () => listDir("custom"))
        ipcMain.handle('clear-photos', async () => {
            await deleteDirectoryContents(baseDir("photo"))
        })
        ipcMain.handle('get-photo-hashes', () => UserData.computePhotoHashes(baseDir("photo")))
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
