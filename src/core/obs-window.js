const {app, BrowserWindow, ipcMain, globalShortcut, screen, shell, dialog, Tray, Menu } = require('electron')
const path = require("path");


class ObsWindow {

    window = null;

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
        this.window.loadFile('src/map/map_obs.html')
        this.window.setMenu(null)
        let obsWindow = this;
        this.window.on("closed", () => {
            obsWindow = null;
        })
    }

    send(event, ...data) {
        if (this.window) {
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