const { app, Menu, Tray } = require('electron');
const path = require('path');
const fs = require("fs");

class TrayController {
    mainWindow = null;
    tray = null;
    constructor(mainWindow) {
        this.mainWindow = mainWindow;
    }

    create() {
        // 'activate' can call createWindow() again -- reuse the existing icon
        if (this.tray && !this.tray.isDestroyed()) return;
        console.log("Creating tray icon…");
        const trayIconPath = path.join(global.dirname, "src", "images", "icon.png");
        if (!fs.existsSync(trayIconPath)) {
            console.log("Tray icon not found at path:", trayIconPath);
            return;
        }
        this.tray = new Tray(trayIconPath);
        this.tray.setToolTip('DBD Map Overlay');

        let mainWindow = this.mainWindow;

        const contextMenu = Menu.buildFromTemplate([
            {
                label: 'Show App',
                click: function(){
                    mainWindow.show();
                    mainWindow.focus();
                }
            },
            { type: 'separator' },
            {
                label: 'Quit',
                click: function(){
                    app.isQuiting = true;
                    app.quit();
                }
            }
        ]);

        this.tray.setContextMenu(contextMenu);

        // Windows fires 'click' for both halves of a double-click, which would
        // hide then re-show the window; single click toggles, double click only
        // brings it to front.
        this.tray.on('double-click', () => {
            mainWindow.show();
            mainWindow.focus();
        });

        this.tray.on('click', () => {
            if (process.platform === 'win32') {
                if (this._clickTimer) return;
                this._clickTimer = setTimeout(() => {
                    this._clickTimer = null;
                }, 400);
            }
            mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
        });
    }

    destroy() {
        if (this.tray && !this.tray.isDestroyed()) {
            this.tray.destroy();
        }
        this.tray = null;
    }
}

module.exports = TrayController