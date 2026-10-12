global.dirname = __dirname
const {spawn} = require('child_process');
const isWayland = require("./src/core/is-wayland");

if (isWayland() && !process.argv.includes('--ozone-platform=x11')) {

    const args = [
        ...process.argv.slice(1),
        '--ozone-platform=x11',
    ];

    const child = spawn(process.execPath, args, {
        stdio: 'inherit'
    });

    child.on('error', (err) => {
        console.error('Wayland respawn failed:', err);
        process.exit(1);
    });

    child.on('exit', (code) => {
        process.exit(code);
    });
} else {

    const {app, BrowserWindow, dialog} = require('electron')

    // ONNX/Chromium route GLib messages through LOG(ERROR) (browser_main_loop.cc),
    // so every libvips call from sharp dumps pages of
    // "GLib-GObject: g_object_ref: assertion 'G_IS_OBJECT (object)' failed"
    // into the console. FATAL-only logging silences them. Linux-only: GLib is the
    // only handler that reroutes native-library chatter, and Windows keeps its
    // Chromium error log. Must be set before `app.whenReady()`.
    if (process.platform === 'linux') {
        app.commandLine.appendSwitch('log-level', '3')
    }

    const ObsWindow = require("./src/core/obs-window");
    const MainWindow = require("./src/core/main-window");
    const OverlayWindow = require("./src/core/overlay-window");
    const Hotkeys = require("./src/core/hotkeys");
    const Settings = require("./src/core/settings");
    const UserData = require("./src/core/user-data");
    const TrayController = require("./src/core/tray");
    const StreamDeck = require("./src/core/stream-deck");
    const MapDetector = require("./src/core/map-detector");
    const API = require("./src/core/api");
    const PhotoSync = require("./src/core/photo-sync");
    const Docs = require("./src/core/docs");


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
            // `electron index.js` (dev) also lands here with argv length 2 and
            // no show-map= arg -- log it so the silent quit is explainable.
            if (!process.argv.some(arg => arg.startsWith('show-map='))) {
                console.log("Another instance is already running; forwarding args and exiting.");
            }
            console.log(`Sending args to application: ${process.argv.slice(1).join(" ")}`);
            app.quit();
        }
        return;
    }

    const settings = new Settings();
    const obsWindow = new ObsWindow();
    const overlayWindow = new OverlayWindow(settings);
    const mainWindow = new MainWindow(obsWindow, overlayWindow, settings);
    const hotkeys = new Hotkeys(mainWindow, settings);
    const userData = new UserData();
    const trayController = new TrayController(mainWindow);
    const streamDeck = new StreamDeck();
    const mapDetector = new MapDetector(mainWindow, settings);
    mainWindow.mapDetector = mapDetector;
    const api = new API(settings);
    // First run: realm folders only exist after the first sync
    new PhotoSync(mainWindow, {onSynced: () => mapDetector.reloadRealms()});
    new Docs();

    if (settings.get('mapDetection')) {
        const ocrLang = (settings.get('ocrLanguage') || 'all').trim();
        if (ocrLang !== 'all') {
            mapDetector.startAutomatic().catch(err => console.error('MapDetector: failed to start automatic detection:', err));
        } else {
            console.log('MapDetector: mapDetection is on but no game language set — skipping auto-start');
            settings.set('mapDetection', false)
        }
    }

    // Stream Deck buttons launch a second instance with `show-map=<key>`; it
    // forwards its argv here and quits. These are user picks, so they go out on
    // external-map-command (not the detector's show-map-command).
    app.on('second-instance', (event, argv, workingDirectory) => {
        const args = argv.slice(1);
        args.forEach(arg => {
            if (arg.startsWith('show-map=')) {
                const mapKey = arg.slice(arg.indexOf('=') + 1);
                console.log(`Opening map: ${mapKey}`);
                mainWindow.send('external-map-command', mapKey);
            }
        });
        console.log(`Received args from second instance: ${args.join(" ")}`);
    });

    function createWindow() {
        mainWindow.show()
        overlayWindow.show()
        trayController.create()
    }

    app.whenReady().then(() => {
        createWindow()
        api.ensureRegistered()
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

    app.on('before-quit', () => {
        // Lets the main window's minimizeToTray close handler through, so OS
        // shutdown and autoUpdater.quitAndInstall() are not blocked.
        app.isQuiting = true;
        trayController.destroy();
    });
}