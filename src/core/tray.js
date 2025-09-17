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

        this.tray.on('double-click', () => {
            mainWindow.show();
            mainWindow.focus();
        });

        this.tray.on('click', () => {
            mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
        });
    }

    destroy() {
        if (this.tray) {
            this.tray.destroy();
        }
    }
}

module.exports = TrayController