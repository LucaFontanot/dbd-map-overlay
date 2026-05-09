const {BrowserWindow, ipcMain} = require('electron');

class OverlayWindow {
    window = null;
    settings = null;

    constructor(settings) {
        this.settings = settings || null;
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
        const isDraggable = this.settings && this.settings.get('draggable');
        const savedX = this.settings && this.settings.get('overlayX');
        const savedY = this.settings && this.settings.get('overlayY');
        this.window = new BrowserWindow({
            width: 0,
            height: 0,
            x: (isDraggable && savedX !== null && savedX !== undefined) ? savedX : 0,
            y: (isDraggable && savedY !== null && savedY !== undefined) ? savedY : 0,
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
        // On Windows, 'screen-saver' level is not supported and gets silently ignored.
        // Use 'pop-up-menu' on Windows which correctly maps to HWND_TOPMOST and stays
        // above fullscreen game windows. On other platforms keep 'screen-saver'.
        const alwaysOnTopLevel = process.platform === 'win32' ? 'pop-up-menu' : 'screen-saver';
        this.window.setAlwaysOnTop(true, alwaysOnTopLevel);
        this.window.setVisibleOnAllWorkspaces(true, {visibleOnFullScreen: true});
        this.window.setSkipTaskbar(true);
        this.window.setIgnoreMouseEvents(true, { forward: true });

        // On Windows, periodically re-assert always-on-top to prevent the game
        // or other HWND_TOPMOST windows from pushing the overlay behind them.
        if (process.platform === 'win32') {
            this._alwaysOnTopInterval = setInterval(() => {
                if (this.window && !this.window.isDestroyed()) {
                    this.window.setAlwaysOnTop(true, 'pop-up-menu');
                }
            }, 1000);
        }

        this.window.on('moved', () => {
            console.log("Window moved");
            console.log(this.window.getBounds());
            if (this.settings && this.settings.get('draggable') && this.window) {
                const bounds = this.window.getBounds();
                this.settings.set('overlayX', bounds.x);
                this.settings.set('overlayY', bounds.y);
            }
        });
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
        if (this._alwaysOnTopInterval) {
            clearInterval(this._alwaysOnTopInterval);
            this._alwaysOnTopInterval = null;
        }
        if (this.window) {
            if (!this.window.isDestroyed()) this.window.close();
            this.window = null;
        }
    }
}

module.exports = OverlayWindow;