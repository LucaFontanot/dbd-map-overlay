const {app, BrowserWindow, ipcMain, globalShortcut, screen, shell, ipcRenderer} = require('electron')
const path = require('path')
const fs = require("fs");
const sizeOf = require('image-size');
const uuid = require('uuid');
const {autoUpdater} = require("electron-updater");

function ensureDirectoryExistence(filePath) {
    var dirname = path.dirname(filePath);
    if (fs.existsSync(dirname)) {
        return true;
    }
    ensureDirectoryExistence(dirname);
    fs.mkdirSync(dirname);
}

function getFilesFromDir(dirPath) {
    let results = [];
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
        const filePath = path.join(dirPath, file);
        if (fs.statSync(filePath).isDirectory()) {
            results = results.concat(getFilesFromDir(filePath));
        } else {
            results.push(filePath);
        }
    }
    return results;
}

async function deleteDirectoryContents(directoryPath) {
    try {
        const files = await fs.promises.readdir(directoryPath);

        for (const file of files) {
            const filePath = path.join(directoryPath, file);
            const fileStat = await fs.promises.stat(filePath);

            if (fileStat.isDirectory()) {
                await deleteDirectoryContents(filePath);
                await fs.promises.rmdir(filePath);
            } else {
                await fs.promises.unlink(filePath);
            }
        }
    } catch (error) {
    }
}

function createWindow() {
    let s = null;
    const win = new BrowserWindow({
        width: 1000,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        title: "DBD Map Overlay",
        icon: path.join(__dirname, "build", "icon.png"),
    })
    win.loadFile('src/index.html')

    win.webContents.setWindowOpenHandler(({url}) => {
        shell.openExternal(url);
        return {action: 'deny'};
    });
    win.setMenu(null)
    let overlayWindow = new BrowserWindow({
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
    let obsWindow = null;
    overlayWindow.loadFile('src/map/map.html')
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    overlayWindow.setVisibleOnAllWorkspaces(true, {visibleOnFullScreen: true});
    overlayWindow.setSkipTaskbar(true);
    overlayWindow.setIgnoreMouseEvents(true);
    globalShortcut.register('CommandOrControl+p', () => {
        win.webContents.send('shortcut-key-pressed');
    });
    ipcMain.on('set-mouse-drag', async (event, drag) => {
        if (drag) {
            overlayWindow.setIgnoreMouseEvents(false);
        } else {
            overlayWindow.setIgnoreMouseEvents(true);
        }
    });
    ipcMain.on('map-change', async (event, map) => {
        if (map === "") {
            overlayWindow.webContents.send('map-hide');
            if (obsWindow !== null) {
                obsWindow.webContents.send('map-hide');
            }
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
            overlayWindow.setSize(parseInt(s.size) + 5, parseInt((s.size / dimensions.width) * dimensions.height * 1.1))
            if (!s.draggable) {
                switch (s.position) {
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
            if (!s.hideOverlay) {
                overlayWindow.webContents.send('map-change', Buffer.from(imgData).toString("base64"), s.size, s.opacity, s.draggable);
            } else {
                overlayWindow.webContents.send('map-change', Buffer.from("").toString("base64"), s.size, s.opacity, s.draggable);
            }
            if (obsWindow !== null) {
                obsWindow.webContents.send('map-change', Buffer.from(imgData).toString("base64"), s.size);
            }
        }

    });
    ipcMain.on('obs-open', async (event, map) => {
        if (obsWindow === null) {
            obsWindow = new BrowserWindow({
                width: 700,
                height: 700,
                webPreferences: {
                    nodeIntegration: true,
                    contextIsolation: false
                },
                title: "DBD Map Overlay for OBS",
                icon: path.join(__dirname, "build", "icon.png")
            })
            obsWindow.loadFile('src/map/map_obs.html')
            obsWindow.setMenu(null)
            obsWindow.on("closed", () => {
                obsWindow = null;
            })
        }
    });
    ipcMain.handle('read-user-data', async (event, fileName) => {

        const userdata = app.getPath('userData');
        const fileDir = path.join(userdata, "photo", fileName)
        ensureDirectoryExistence(fileDir)

        if (!fs.existsSync(fileDir)) {
            return Buffer.from("")
        }
        const buf = await fs.promises.readFile(fileDir);
        return buf;
    })
    ipcMain.handle('read-custom-data', async (event, fileName) => {
        const userdata = app.getPath('userData');
        const fileDir = path.join(userdata, "custom", fileName)
        ensureDirectoryExistence(fileDir)
        if (!fs.existsSync(fileDir)) {
            return Buffer.from("")
        }
        const buf = await fs.promises.readFile(fileDir);
        return buf;
    })
    const defValues = {
        size: 250,
        position: 1,
        opacity: 0.5,
        id: uuid.v4(),
        draggable: false,
        hideOverlay: false,
        token: ""
    };
    ipcMain.handle('get-settings', async (event) => {
        const userdata = app.getPath('userData');
        const fileDir = path.join(userdata, "settings-app.json")
        if (!fs.existsSync(fileDir)) {
            fs.writeFileSync(fileDir, JSON.stringify(defValues))
        }
        s = JSON.parse(fs.readFileSync(fileDir, "utf-8"));
        for (let key in defValues) {
            if (s[key] === undefined) {
                s[key] = defValues[key]
            }
        }
        return s
    })
    ipcMain.handle('save-settings', async (event, settings) => {
        if (settings !== null) {
            const userdata = app.getPath('userData');
            const fileDir = path.join(userdata, "settings-app.json")
            fs.writeFileSync(fileDir, JSON.stringify(settings))
            s = settings;
        }
    })
    ipcMain.handle('write-user-data', async (event, fileName, data) => {
        const userdata = app.getPath('userData');
        const fileDir = path.join(userdata, "photo", fileName)
        ensureDirectoryExistence(fileDir)
        fs.writeFileSync(fileDir, Buffer.from(data));
    })
    ipcMain.handle('write-custom-data', async (event, fileName, data) => {
        const userdata = app.getPath('userData');
        const fileDir = path.join(userdata, "custom", fileName)
        ensureDirectoryExistence(fileDir)
        fs.writeFileSync(fileDir, Buffer.from(data));
    })
    ipcMain.handle('delete-user-data', async (event, fileName) => {
        const userdata = app.getPath('userData');
        const fileDir = path.join(userdata, "photo", fileName)
        ensureDirectoryExistence(fileDir)
        fs.unlinkSync(fileDir);
    })
    ipcMain.handle('delete-custom-data', async (event, fileName) => {
        const userdata = app.getPath('userData');
        const fileDir = path.join(userdata, "custom", fileName)
        ensureDirectoryExistence(fileDir)
        fs.unlinkSync(fileDir);
    })

    ipcMain.handle('get-dir-photos', async (event, dir) => {
        const userdata = app.getPath('userData');
        const fileDir = path.join(userdata, "photo")
        if (!fs.existsSync(fileDir)) {
            fs.mkdirSync(fileDir)
        }

        return getFilesFromDir(fileDir).map((file) => {
            return file.replace(fileDir.toString(), "")
        })
    })
    ipcMain.handle('get-custom-photos', async (event, dir) => {
        const userdata = app.getPath('userData');
        const fileDir = path.join(userdata, "custom")
        if (!fs.existsSync(fileDir)) {
            fs.mkdirSync(fileDir)
        }

        return getFilesFromDir(fileDir).map((file) => {
            return file.replace(fileDir.toString(), "")
        })
    })
    ipcMain.handle('clear-photos', async (event, dir) => {
        const userdata = app.getPath('userData');
        const fileDir = path.join(userdata, "photo")
        await deleteDirectoryContents(fileDir)
    })
    ipcMain.handle('version', async (event, dir) => {
        return app.getVersion()
    })
    win.on("closed", () => {
        overlayWindow.close()
        if (obsWindow !== null) {
            obsWindow.close()
        }
    })

    function sendUpdateStatusToWindow(text) {
        win.webContents.send('update-message', text);
    }
    autoUpdater.on('checking-for-update', () => {
        sendUpdateStatusToWindow('Checking for update...');
    })
    autoUpdater.on('update-available', (info) => {
        sendUpdateStatusToWindow('Update available.');
    })
    autoUpdater.on('update-not-available', (info) => {
        sendUpdateStatusToWindow('Update not available.');
    })
    autoUpdater.on('error', (err) => {
        sendUpdateStatusToWindow('Error in auto-updater. ' + err);
    })
    autoUpdater.on('download-progress', (progressObj) => {
        let log_message = "Download speed: " + parseInt(progressObj.bytesPerSecond/1024) + "KB/s";
        log_message = log_message + ' - Downloaded ' + parseInt(progressObj.percent) + '%';
        sendUpdateStatusToWindow(log_message);
    })
    autoUpdater.on('update-downloaded', (info) => {
        sendUpdateStatusToWindow('Update downloaded. Restart the app to install.');
    });
    Object.defineProperty(app, 'isPackaged', {
        get() {
            return true;
        }
    });
    setTimeout(() => {
        sendUpdateStatusToWindow('Checking for update...');
        autoUpdater.checkForUpdatesAndNotify();
    },2000);
}

app.whenReady().then(() => {
    createWindow()
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow()
        }
    })
})

app.on('window-all-closed', (w) => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

