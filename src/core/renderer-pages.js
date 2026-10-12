const path = require('path');

// Vite builds the renderer pages into out/renderer (see vite.config.mjs).
const RENDERER_DIR = path.join(__dirname, '..', '..', 'out', 'renderer');

/**
 * webPreferences shared by every window: isolated, sandboxed, no Node.
 * @param {'preload.js'|'overlay-preload.js'} preload
 */
function securePreferences(preload) {
    return {
        preload: path.join(__dirname, preload),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
    };
}

/**
 * @param {Electron.BrowserWindow} window
 * @param {'index'|'overlay'|'obs'} page
 */
function loadPage(window, page) {
    return window.loadFile(path.join(RENDERER_DIR, `${page}.html`));
}

module.exports = {securePreferences, loadPage, RENDERER_DIR};
