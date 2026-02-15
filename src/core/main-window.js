const {BrowserWindow, app, shell, ipcMain, screen} = require("electron");
const path = require("path");
const {autoUpdater} = require("electron-updater");
const fs = require("fs");
const sizeOf = require("image-size");
const isWaylandSession = require("./is-wayland");

const debug = process.env.DEBUG === 'true';

class MainWindow {

    window = null;
    obsWindow;
    overlayWindow;
    settings;

    constructor(obsWindow, overlayWindow, settings) {
        this.obsWindow = obsWindow;
        this.overlayWindow = overlayWindow;
        this.settings = settings;
        ipcMain.on('obs-open', async (event, map) => {
            obsWindow.show()
        });
        ipcMain.handle('version', async (event, dir) => {
            return app.getVersion()
        })
        ipcMain.on('map-change', async (event, map) => {
            if (!map) {
                overlayWindow.send('map-hide');
                obsWindow.send('map-hide');
            } else {
                let imgData = "";
                if (map.startsWith("\\") || map.startsWith("/")) {
                    const userdata = app.getPath('userData');
                    const fileDir = path.join(userdata, "photo", map)
                    const fileCustom = path.join(userdata, "custom", map)
                    if (fs.existsSync(fileDir)) {
                        imgData = await fs.promises.readFile(fileDir);
                    } else if (fs.existsSync(fileCustom)) {
                        imgData = await fs.promises.readFile(fileCustom);
                    } else {
                        imgData = Buffer.from(map, "base64")
                    }
                } else {
                    imgData = Buffer.from(map, "base64")
                }
                const dimensions = sizeOf(imgData);
                const {width, height} = screen.getPrimaryDisplay().workAreaSize;
                overlayWindow.setSize(parseInt(settings.get('size')) + 5, parseInt((settings.get('size') / dimensions.width) * dimensions.height * 1.1))
                if (!settings.get('draggable')) {
                    switch (settings.get('position')) {
                        case "1":
                            overlayWindow.setPosition(0, 0);
                            break;
                        case "2":
                            overlayWindow.setPosition(width - overlayWindow.getBounds().width, 0);
                            break;
                        case "3":
                            overlayWindow.setPosition(0, height - overlayWindow.getBounds().height);
                            break;
                        case "4":
                            overlayWindow.setPosition(width - overlayWindow.getBounds().width, height - overlayWindow.getBounds().height);
                            break;
                    }
                }
                if (!settings.get('hideOverlay')) {
                    overlayWindow.send('map-change', Buffer.from(imgData).toString("base64"), settings.get('size'), settings.get('opacity'), settings.get('draggable'), settings.get('rotation'))
                } else {
                    overlayWindow.send('map-change', Buffer.from("").toString("base64"), settings.get('size'), settings.get('opacity'), settings.get('draggable'), settings.get('rotation'));
                }
                obsWindow.send('map-change', Buffer.from(imgData).toString("base64"), settings.get('size'));
            }

        });
    }

    show() {
        if (this.window) {
            if (!this.window.isDestroyed()){
                this.window.show();
                return
            }
            this.window = null;
        }
        this.window = new BrowserWindow({
            width: 1000,
            height: 600,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            },
            title: "DBD Map Overlay",
            icon: path.join(global.dirname, "build", "icon.png"),
            show: false // Don't show immediately, wait for proper load event
        })
        let window = this.window;
        let obsWindow = this.obsWindow;
        let overlayWindow = this.overlayWindow;
        this.window.on("closed", () => {
            overlayWindow.close()
            obsWindow.close()
        })
        let settings = this.settings;
        this.window.on("minimize", function(event){
            if (settings && settings.get('minimizeToTray')) {
                event.preventDefault();
                window.hide();
            }
        })
        this.window.on('close', function (event) {
            if (settings && settings.get('minimizeToTray')) {
                if (!app.isQuiting) {
                    event.preventDefault();
                    window.hide();
                }
            }
            return false;
        });
        this.window.loadFile('src/index.html')


        this.window.webContents.setWindowOpenHandler(({url}) => {
            shell.openExternal(url);
            return {action: 'deny'};
        });

        if(debug) this.window.webContents.openDevTools()
        if (!debug) this.window.setMenu(null)

        // On Wayland, the ready-to-show event is broken in Electron 38+
        // (see https://github.com/electron/electron/issues/48859)
        // Use did-finish-load instead, which fires when HTML is loaded and
        // React root is mounted, ensuring proper Wayland activation context
        if (isWaylandSession()) {
            this.window.webContents.once('did-finish-load', () => {
                if (!this.window.isDestroyed() && !this.window.isVisible()) {
                    this.window.show();
                    this.window.focus();
                }
            });
        } else {
            // On other platforms, use ready-to-show for optimal UX
            this.window.once('ready-to-show', () => {
                this.window.show();
            });
        }

        this.checkUpdates()
    }


    sendUpdate(message) {
        if (this.window){
            this.window.webContents.send('update-message', message);
        }
    }

    checkUpdates() {
        let classInstance = this;
        autoUpdater.on('checking-for-update', () => {
            classInstance.sendUpdate('Checking for update...');
        })
        autoUpdater.on('update-available', (info) => {
            classInstance.sendUpdate('Update available.');
        })
        autoUpdater.on('update-not-available', (info) => {
            classInstance.sendUpdate('App is up to date.');
        })
        autoUpdater.on('error', (err) => {
            classInstance.sendUpdate('Error while updating: ' + err);
        })
        autoUpdater.on('download-progress', (progressObj) => {
            let log_message = "Download speed: " + parseInt(progressObj.bytesPerSecond/1024) + "KB/s";
            log_message = log_message + ' - Downloaded ' + parseInt(progressObj.percent) + '%';
            classInstance.sendUpdate(log_message);
        })
        autoUpdater.on('update-downloaded', (info) => {
            classInstance.sendUpdate('Update downloaded. The will update on next restart.');
        });
        Object.defineProperty(app, 'isPackaged', {
            get() {
                return true;
            }
        });
        setTimeout(async () => {
            classInstance.sendUpdate('Checking for updates...');
            await autoUpdater.checkForUpdatesAndNotify();
        },2000);
    }

    send(event, ...data) {
        if (this.window) {
            this.window.webContents.send(event, ...data);
        }
    }

    focus() {
        if (this.window) {
            this.window.focus();
        }
    }

    isVisible(){
        if (this.window) {
            return this.window.isVisible();
        }
        return false;
    }

    hide(){
        if (this.window) {
            this.window.hide();
        }
    }
}

module.exports = MainWindow;