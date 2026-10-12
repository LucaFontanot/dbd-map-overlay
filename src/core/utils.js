const fs = require('fs');
const path = require('path');

/**
 * Join `rel` onto `base` and refuse anything that resolves outside `base`
 * (`..` segments, absolute paths, drive letters). Leading slashes and
 * backslashes in `rel` are treated as relative to `base`, matching the
 * "/Creator/Realm/Map.png" keys the renderer sends.
 * @param {string} base
 * @param {string} rel
 * @returns {string} absolute path inside base
 */
module.exports.safeJoin = function (base, rel) {
    if (typeof rel !== 'string') throw new Error('safeJoin: path must be a string');
    if (rel.includes('\0')) throw new Error('safeJoin: invalid path');
    const root = path.resolve(base);
    const cleaned = rel.replace(/\\/g, '/').replace(/^\/+/, '');
    const resolved = path.resolve(root, cleaned);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`safeJoin: "${rel}" escapes ${root}`);
    }
    return resolved;
}

module.exports.deleteDirectoryContents = async function (directoryPath) {
    try {
        const files = await fs.promises.readdir(directoryPath);
        for (const file of files) {
            await fs.promises.rm(path.join(directoryPath, file), {recursive: true, force: true});
        }
    } catch (error) {
        if (error.code !== 'ENOENT') console.error('deleteDirectoryContents:', directoryPath, error);
    }
}

module.exports.ensureDirectoryExistence = function (filePath) {
    try {
        fs.mkdirSync(path.dirname(filePath), {recursive: true});
        return true;
    } catch (error) {
        console.error('ensureDirectoryExistence:', filePath, error);
        return false;
    }
}

module.exports.getFilesFromDir = function (dirPath) {
    let results = [];
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
        const filePath = path.join(dirPath, file);
        if (fs.statSync(filePath).isDirectory()) {
            results = results.concat(module.exports.getFilesFromDir(filePath));
        } else {
            results.push(filePath);
        }
    }
    return results;
}

module.exports.isHttpUrl = function (url) {
    try {
        const {protocol} = new URL(url);
        return protocol === 'http:' || protocol === 'https:';
    } catch (e) {
        return false;
    }
}

/**
 * Keep a window on its own file:// page: new windows are always denied
 * (http(s) links open in the system browser instead) and navigation away
 * from the loaded page is blocked. `shell` is passed in so this module
 * stays loadable without electron.
 * @param {Electron.WebContents} webContents
 * @param {Electron.Shell} shell
 */
module.exports.lockDownWebContents = function (webContents, shell) {
    const openExternal = (url) => {
        if (module.exports.isHttpUrl(url)) {
            shell.openExternal(url).catch(err => console.error('openExternal failed:', url, err));
        } else {
            console.warn('Blocked opening non-http(s) URL:', url);
        }
    };
    webContents.setWindowOpenHandler(({url}) => {
        openExternal(url);
        return {action: 'deny'};
    });
    webContents.on('will-navigate', (event, url) => {
        if (url === webContents.getURL()) return;
        event.preventDefault();
        openExternal(url);
    });
}
