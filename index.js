const {app, BrowserWindow, ipcMain, globalShortcut, screen, shell, dialog, Tray, Menu } = require('electron')
const path = require('path')
const fs = require("fs");
const sizeOf = require('image-size');
const uuid = require('uuid');
const {autoUpdater} = require("electron-updater");
const { randomUUID } = require('crypto');

const gotLock = app.requestSingleInstanceLock();
const debug = process.env.DEBUG === 'true';

let tray = null;

if (!gotLock) {
  if (process.argv.length <= 1) {
    console.log("Another instance is already running.");
    app.whenReady().then(async () => {
      const tempWin = new BrowserWindow({ show: false });

      await dialog.showMessageBox(tempWin, {
        type: 'info',
        title: 'App already running',
        message: 'The application is already running.',
        buttons: ['OK']
      });

      app.quit();
    });
  } else {
    console.log(`Sending args to application: ${process.argv.slice(1).join(" ")}`);
    app.quit();
  }
  return;
} else {
  app.on('second-instance', (event, argv, workingDirectory) => {
    const args = argv.slice(1);
    args.forEach(arg => {
        console.log(arg)
        if (arg.startsWith('show-map=')) {
            const mapKey = arg.split('=')[1];
            console.log(`Opening map: ${mapKey}`);
            if (win) {
                win.webContents.send('show-map-command', mapKey);
            }
        }
    });
    console.log(`Received args from second instance: ${args.join(" ")}`);
  });
}

const hotkeyFilePath = path.join(app.getPath('userData'), 'hotkeys.json');
let win = null

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

function setDefaultHotkeys() {
    console.log("Setting default hotkeys…");
    globalShortcut.register('CommandOrControl+p', () => {
        console.log('CommandOrControl+p pressed → toggle-map');
        win.webContents.send('check-lobby-update');
    });
    globalShortcut.register('CommandOrControl+h', () => {
        console.log('CommandOrControl+h pressed → hide-map');
        win.webContents.send('hide-map');
    });
}

function registerHotkeys(hotkeys) {
    globalShortcut.unregisterAll();
    setDefaultHotkeys()

    for (const [hotkey, { mapKey, id }] of Object.entries(hotkeys)) {
        const ok = globalShortcut.register(hotkey, () => {
            console.log(`(${id}) ${hotkey} pressed → ${mapKey}`);
            win.webContents.send('hotkey-pressed', mapKey);
        });

        if (!ok) {
            console.warn(`Failed to register “${hotkey}” (id: ${id})`);
            sendUpdateStatusToWindow(`Failed to register “${hotkey}”`);
        }
    }
}

function sendUpdateStatusToWindow(text) {
    win.webContents.send('update-message', text);
}

function loadKeys() {
    if (!fs.existsSync(hotkeyFilePath)){
        console.log("Hotkey file does not exist");
        registerHotkeys({})
        return
    }

    try {
        const data   = fs.readFileSync(hotkeyFilePath, "utf-8");
        const parsed = JSON.parse(data);

        win.webContents.send('hotkey-updated', parsed);
        registerHotkeys(parsed);
    } catch (err) {
        console.error("Failed to load hotkeys:", err);
    }
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
    win = new BrowserWindow({
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

    if(debug) win.webContents.openDevTools()

    win.webContents.setWindowOpenHandler(({url}) => {
        shell.openExternal(url);
        return {action: 'deny'};
    });
    if (!debug) win.setMenu(null)

    createTray();

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
        token: "",
        minimizeToTray: false,
        disableFaqPopup: false
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

    ipcMain.on('save-hotkeys', (event, settings) => {
        const { hotkey, mapkey, id: incomingId } = settings;   // renderer may already send an id
        if (!hotkey || !mapkey) {
            console.warn("Hotkey or map not selected");
            return;
        }

        let saved = {};
        if (fs.existsSync(hotkeyFilePath)) {
            try {
                saved = JSON.parse(fs.readFileSync(hotkeyFilePath, "utf-8"));
            } catch (err) {
                console.error("Error parsing existing hotkeys:", err);
            }
        }
        const id = incomingId || (saved[hotkey] && saved[hotkey].id) || randomUUID();

        saved[hotkey] = { id, mapKey: mapkey };

        try {
            fs.writeFileSync(hotkeyFilePath, JSON.stringify(saved, null, 2), "utf-8");
            console.log(`Saved hotkey [${id}]: ${hotkey} → ${mapkey}`);
            sendUpdateStatusToWindow('Hotkey saved successfully.');
            console.log("Reloading hotkeys…");
            loadKeys();
        } catch (err) {
            console.error("Failed to save hotkeys:", err);
            sendUpdateStatusToWindow('Failed to save hotkey.');
        }
    });

    ipcMain.on('load-hotkeys', (event) => {
        console.log("Loading hotkeys…");
        loadKeys()
    });

    ipcMain.on('delete-hotkey', (event, id) => {
        let saved = {};

        if (fs.existsSync(hotkeyFilePath)) {
            try {
                saved = JSON.parse(fs.readFileSync(hotkeyFilePath, 'utf-8'));
            } catch (err) {
                console.error('Error parsing existing hotkeys:', err);
            }
        }

        const keyToDelete = Object.keys(saved).find(hk => saved[hk].id === id);

        if (keyToDelete) {
            delete saved[keyToDelete];
            fs.writeFileSync(hotkeyFilePath, JSON.stringify(saved, null, 2), 'utf-8');
            console.log(`Removed hotkey: ${keyToDelete} (id: ${id})`);
            sendUpdateStatusToWindow('Hotkey deleted.');
            loadKeys();
        } else {
            console.warn(`No hotkey found for id ${id}`);
        }
    });

    ipcMain.handle('dialog:selectDirectory', async () => {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: 'Select Stream Controller Directory'
        });
        return result;
    });

    ipcMain.handle('streamdeck:saveConfig', async (event, filePath, config) => {
        try {
            const dir = path.dirname(filePath);
            await fs.mkdir(dir, { recursive: true }, (err) => {
                if (err) {
                    console.error("Failed to create directory:", err);
                    return;
                }
            });
            
            await fs.writeFile(filePath, JSON.stringify(config, null, 2), (err) => {
                if (err) {
                    console.error("Failed to create directory:", err);
                    return;
                }
            });
            
            return { success: true };
        } catch (error) {
            console.error('Error saving config:', error);
            throw error;
        }
    });

    win.on("closed", () => {
        if (overlayWindow !== null && !overlayWindow.isDestroyed()) {
            overlayWindow.close()
        }
        if (obsWindow !== null && !obsWindow.isDestroyed()) {
            obsWindow.close()
        }
    })

    autoUpdater.on('checking-for-update', () => {
        sendUpdateStatusToWindow('Checking for update...');
    })
    autoUpdater.on('update-available', (info) => {
        sendUpdateStatusToWindow('Update available.');
    })
    autoUpdater.on('update-not-available', (info) => {
        sendUpdateStatusToWindow('App is up to date.');
    })
    autoUpdater.on('error', (err) => {
        sendUpdateStatusToWindow('Error while updating: ' + err);
    })
    autoUpdater.on('download-progress', (progressObj) => {
        let log_message = "Download speed: " + parseInt(progressObj.bytesPerSecond/1024) + "KB/s";
        log_message = log_message + ' - Downloaded ' + parseInt(progressObj.percent) + '%';
        sendUpdateStatusToWindow(log_message);
    })
    autoUpdater.on('update-downloaded', (info) => {
        sendUpdateStatusToWindow('Update downloaded. The will update on next restart.');
    });
    Object.defineProperty(app, 'isPackaged', {
        get() {
            return true;
        }
    });
    setTimeout(() => {
        sendUpdateStatusToWindow('Checking for updates...');
        autoUpdater.checkForUpdatesAndNotify();
    },2000);

    win.on("minimize", function(event){
        if (s && s.minimizeToTray) {
            event.preventDefault();
            win.hide();
        }
    })


    win.on('close', function (event) {
        if (s && s.minimizeToTray) {
            if (!app.isQuiting) {
                event.preventDefault();
                win.hide();
            }
        }

        return false;
    });
}

function createTray() {
    const trayIconPath = path.join(__dirname, "build", "icon.png");
    tray = new Tray(trayIconPath);

    tray.setToolTip('DBD Map Overlay');

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Show App',
            click: function(){
                win.show();
                win.focus();
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

    tray.setContextMenu(contextMenu);

    tray.on('double-click', () => {
        win.show();
        win.focus();
    });

    tray.on('click', () => {
        win.isVisible() ? win.hide() : win.show();
    });
}


app.whenReady().then(() => {
    if (gotLock) {
        createWindow()
        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow()
            }
        })
    }
})

app.on('window-all-closed', (w) => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('before-quit', () => {
    if (tray) {
        tray.destroy();
    }
});


