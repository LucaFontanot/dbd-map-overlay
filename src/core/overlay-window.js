const {BrowserWindow, ipcMain, shell} = require('electron');
const {lockDownWebContents} = require('./utils');

// 'moved' never fires on Linux, so drags are also caught via 'move', debounced
const MOVE_SAVE_DEBOUNCE_MS = 300;

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
        lockDownWebContents(this.window.webContents, shell);
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

        const savePosition = () => {
            if (this._moveSaveTimer) {
                clearTimeout(this._moveSaveTimer);
                this._moveSaveTimer = null;
            }
            if (!this.settings || !this.settings.get('draggable')) return;
            if (!this.window || this.window.isDestroyed()) return;
            const bounds = this.window.getBounds();
            if (this.settings.get('overlayX') === bounds.x && this.settings.get('overlayY') === bounds.y) return;
            this.settings.set('overlayX', bounds.x);
            this.settings.set('overlayY', bounds.y);
        };
        this.window.on('moved', savePosition);
        this.window.on('move', () => {
            if (!this.settings || !this.settings.get('draggable')) return;
            if (this._moveSaveTimer) clearTimeout(this._moveSaveTimer);
            this._moveSaveTimer = setTimeout(savePosition, MOVE_SAVE_DEBOUNCE_MS);
        });
    }

    send(event, ...data) {
        if (this.window && !this.window.isDestroyed()) {
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
        if (this._moveSaveTimer) {
            clearTimeout(this._moveSaveTimer);
            this._moveSaveTimer = null;
        }
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