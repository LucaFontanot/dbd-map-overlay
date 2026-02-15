const {app, BrowserWindow, ipcMain, globalShortcut, screen, shell, dialog, Tray, Menu } = require('electron')
const path = require("path");
const isWaylandSession = require("./is-wayland");


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
            icon: path.join(global.dirname, "build", "icon.png"),
            show: false // Don't show immediately on Wayland
        })
        this.window.loadFile('src/map/map_obs.html')
        this.window.setMenu(null)
        let obsWindow = this;
        this.window.on("closed", () => {
            obsWindow = null;
        })

        // On Wayland, use did-finish-load to ensure proper activation context
        if (isWaylandSession()) {
            this.window.webContents.once('did-finish-load', () => {
                if (!this.window.isDestroyed() && !this.window.isVisible()) {
                    this.window.show();
                }
            });
        } else {
            this.window.once('ready-to-show', () => {
                this.window.show();
            });
        }
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