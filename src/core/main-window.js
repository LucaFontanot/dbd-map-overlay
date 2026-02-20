const {BrowserWindow, app, shell, ipcMain, screen} = require("electron");
const path = require("path");
const {autoUpdater} = require("electron-updater");
const fs = require("fs");
const { imageSize } = require('image-size')

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
        ipcMain.handle('get-displays', async () => {
            return screen.getAllDisplays().map((display, index) => ({
                index,
                id: display.id,
                label: display.label || `Display ${index + 1} (${display.bounds.width}x${display.bounds.height})`,
                bounds: display.bounds
            }));
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
                const dimensions = imageSize(imgData);
                const displays = screen.getAllDisplays();
                const monitorIndex = parseInt(settings.get('monitor')) || 0;
                const selectedDisplay = displays[monitorIndex] || displays[0] || screen.getPrimaryDisplay();
                const {x: displayX, y: displayY, width, height} = selectedDisplay.workArea;
                overlayWindow.setSize(parseInt(settings.get('size')) + 5, parseInt((settings.get('size') / dimensions.width) * dimensions.height * 1.1))
                if (!settings.get('draggable')) {
                    switch (settings.get('position')) {
                        case "1":
                            overlayWindow.setPosition(displayX, displayY);
                            break;
                        case "2":
                            overlayWindow.setPosition(displayX + width - overlayWindow.getBounds().width, displayY);
                            break;
                        case "3":
                            overlayWindow.setPosition(displayX, displayY + height - overlayWindow.getBounds().height);
                            break;
                        case "4":
                            overlayWindow.setPosition(displayX + width - overlayWindow.getBounds().width, displayY + height - overlayWindow.getBounds().height);
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