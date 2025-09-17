global.dirname = __dirname
const {app, BrowserWindow, dialog} = require('electron')
const ObsWindow = require("./src/core/obs-window");
const MainWindow = require("./src/core/main-window");
const OverlayWindow = require("./src/core/overlay-window");
const Hotkeys = require("./src/core/hotkeys");
const Settings = require("./src/core/settings");
const UserData = require("./src/core/user-data");
const TrayController = require("./src/core/tray");
const StreamDeck = require("./src/core/stream-deck");

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
    if (process.argv.length <= 1) {
        console.log("Another instance is already running.");
        app.whenReady().then(async () => {
            const tempWin = new BrowserWindow({show: false});

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
}

const settings = new Settings();
const obsWindow = new ObsWindow();
const overlayWindow = new OverlayWindow();
const mainWindow = new MainWindow(obsWindow, overlayWindow, settings);
const hotkeys = new Hotkeys(mainWindow);
const userData = new UserData();
const trayController = new TrayController(mainWindow);
const streamDeck = new StreamDeck();

if (gotLock) {
    app.on('second-instance', (event, argv, workingDirectory) => {
        const args = argv.slice(1);
        args.forEach(arg => {
            console.log(arg)
            if (arg.startsWith('show-map=')) {
                const mapKey = arg.split('=')[1];
                console.log(`Opening map: ${mapKey}`);
                mainWindow.send('show-map-command', mapKey);
            }
        });
        console.log(`Received args from second instance: ${args.join(" ")}`);
    });
}

function createWindow() {
    mainWindow.show()
    overlayWindow.show()
    trayController.create()
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
    trayController.destroy();
});


