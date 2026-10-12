const {BrowserWindow, shell} = require('electron')
const path = require("path");
const {lockDownWebContents} = require('./utils');


class ObsWindow {

    window = null;
    lastMapMessage = null; // replayed on load: maps sent while the window opens would be lost

    constructor() {}

    show() {
        if (this.window) {
            if (!this.window.isDestroyed()) return
            this.window = null;
        }
        this.window = new BrowserWindow({
            width: 700,
            height: 700,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            },
            title: "DBD Map Overlay for OBS",
            icon: path.join(global.dirname, "build", "icon.png")
        })
        this.window.webContents.on('did-finish-load', () => {
            if (this.lastMapMessage) this.send(...this.lastMapMessage);
        });
        this.window.loadFile('src/map/map_obs.html')
        lockDownWebContents(this.window.webContents, shell);
        this.window.setMenu(null)
    }

    send(event, ...data) {
        if (event === 'map-change' || event === 'map-hide') this.lastMapMessage = [event, ...data];
        if (this.window && !this.window.isDestroyed()) {
            this.window.webContents.send(event, ...data);
        }
    }

    close() {
        if (this.window) {
            if (!this.window.isDestroyed()) this.window.close();
            this.window = null;
        }
    }
}

module.exports = ObsWindow;