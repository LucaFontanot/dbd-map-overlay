// Preload for the main window. Runs sandboxed with contextIsolation: the page
// never sees ipcRenderer or Node, only the allow-listed channels below. Main
// still validates every argument -- this list narrows the surface, it is not
// the security boundary.
const {contextBridge, ipcRenderer} = require('electron');

const INVOKE = new Set([
    'app-info',
    'get-displays',
    'get-settings',
    'set-setting',
    'maps-sync',
    'get-dir-photos',
    'get-custom-photos',
    'read-custom-data',
    'write-custom-data',
    'delete-custom-data',
    'docs-get',
    'lobby-create',
    'lobby-join',
    'lobby-set-status',
    'lobby-leave',
    'lobby-set-map',
    'lobby-get',
    'lobby-custom-image',
    'map-detector-status',
    'map-detector-start-automatic',
    'map-detector-stop-automatic',
    'get-system-hotkeys',
    'dialog:selectDirectory',
    'streamdeck:create',
]);

const SEND = new Set([
    'map-change',
    'obs-open',
    'set-mouse-drag',
    'save-hotkeys',
    'load-hotkeys',
    'delete-hotkey',
    'save-system-hotkey',
    'reset-system-hotkey',
]);

const RECEIVE = new Set([
    'settings-updated',
    'update-message',
    'maps-sync-progress',
    'check-lobby-update',
    'toggle-map',
    'rotate-map',
    'show-map-command',
    'external-map-command',
    'map-detector-clear',
    'map-detector-model-status',
    'hotkey-pressed',
    'hotkey-updated',
    'system-hotkeys-updated',
]);

function allowed(set, channel) {
    if (!set.has(channel)) throw new Error(`IPC channel not allowed: ${channel}`);
}

contextBridge.exposeInMainWorld('dbd', {
    invoke(channel, ...args) {
        allowed(INVOKE, channel);
        return ipcRenderer.invoke(channel, ...args);
    },
    send(channel, ...args) {
        allowed(SEND, channel);
        ipcRenderer.send(channel, ...args);
    },
    /** @returns {() => void} unsubscribe */
    on(channel, listener) {
        allowed(RECEIVE, channel);
        // The IpcRendererEvent (with its sender) never reaches the page
        const wrapped = (event, ...args) => listener(...args);
        ipcRenderer.on(channel, wrapped);
        return () => ipcRenderer.removeListener(channel, wrapped);
    },
});
