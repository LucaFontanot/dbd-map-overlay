// Preload for the overlay and OBS windows: they only ever receive the map.
const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('overlay', {
    onMapChange(listener) {
        ipcRenderer.on('map-change', (event, ...args) => listener(...args));
    },
    onMapHide(listener) {
        ipcRenderer.on('map-hide', () => listener());
    },
});
