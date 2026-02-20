const {BrowserWindow, ipcMain} = require('electron');

class OverlayWindow {
    window = null;
    constructor() {
        let classInstance = this;
        ipcMain.on('set-mouse-drag', async (event, drag) => {
            if (!classInstance.window) return
            if (drag) {
                classInstance.window.setIgnoreMouseEvents(false);
            } else {
                classInstance.window.setIgnoreMouseEvents(true);
            }
        });
    }

    show() {
        if (this.window) {
            if (!this.window.isDestroyed()) return
            this.window = null;
        }
        this.window = new BrowserWindow({
            width: 0,
            height: 0,
            x: 0,
            y: 0,
            maximizable: true,
            minimizable: false,
            focusable: false,
            skipTaskbar: true,
            alwaysOnTop: true,
            frame: false,
            transparent: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        })
        this.window.loadFile('src/map/map.html')
        this.window.setAlwaysOnTop(true, 'screen-saver');
        this.window.setVisibleOnAllWorkspaces(true, {visibleOnFullScreen: true});
        this.window.setSkipTaskbar(true);
        this.window.setIgnoreMouseEvents(true);
    }

    send(event, ...data) {
        if (this.window) {
            this.window.webContents.send(event, ...data);
        }
    }

    setSize(width, height) {
        if (this.window) {
            this.window.setSize(width, height);
        }
    }

    setBounds(bounds) {
        if (this.window) {
            this.window.setBounds(bounds);
        }
    }

    setPosition(x, y) {
        if (this.window) {
            this.window.setPosition(x, y);
        }
    }

    getBounds() {
        if (this.window) {
            return this.window.getBounds();
        }
        return {width: 0, height: 0};
    }

    close() {
        if (this.window) {
            if (!this.window.isDestroyed()) this.window.close();
            this.window = null;
        }
    }
}

module.exports = OverlayWindow;