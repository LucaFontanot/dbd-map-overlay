const {BrowserWindow, app, shell, ipcMain, screen} = require("electron");
const path = require("path");
const {autoUpdater} = require("electron-updater");
const fs = require("fs");
const { imageSize } = require('image-size')
const { computeOverlayPosition, overlayAlign, overlayArea, rotatedSize } = require('./overlay-position');
const { safeJoin, lockDownWebContents } = require('./utils');
const { securePreferences, loadPage } = require('./renderer-pages');
const isWayland = require('./is-wayland');

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
        this.mapDetector = null; // set externally after construction
        ipcMain.on('obs-open', async (event, map) => {
            obsWindow.show()
        });
        ipcMain.handle('app-info', async () => ({
            // Read this app's package.json — app.getVersion() can pick up
            // Electron's own version (40.x) when running from `npm start`.
            version: require('../../package.json').version,
            platform: process.platform,
            // The env vars survive the x11 relaunch (see index.js), so this
            // still detects the real session type
            wayland: isWayland(),
        }))
        ipcMain.handle('get-displays', async () => {
            return screen.getAllDisplays().map((display, index) => {
                // bounds is logical (DPI-scaled) pixels, not physical ones -- show the
                // physical resolution so HiDPI displays are actually recognizable in the list.
                const physicalWidth = Math.round(display.bounds.width * display.scaleFactor);
                const physicalHeight = Math.round(display.bounds.height * display.scaleFactor);
                const refreshRate = Math.round(display.displayFrequency);
                return {
                    index,
                    id: display.id,
                    label: display.label || `Display ${index + 1} (${physicalWidth}x${physicalHeight}${refreshRate ? ` @ ${refreshRate}Hz` : ''})`,
                    bounds: display.bounds
                };
            });
        })
        // Monotonic ids of the latest map-change: a slower earlier request (file
        // read) must not overwrite a newer one that already landed. OBS has its
        // own counter, bumped only by real changes: a settings preview racing a
        // real change may win the overlay but must not drop the OBS update.
        this.overlayRequest = 0;
        this.obsRequest = 0;
        ipcMain.on('map-change', async (event, map, opts = {}) => {
            opts = (opts && typeof opts === 'object') ? opts : {};
            const request = {overlay: ++this.overlayRequest, obs: opts.preview ? null : ++this.obsRequest};
            try {
                await this.applyMapChange(map, opts, request);
            } catch (err) {
                console.error('map-change failed:', err);
            }
        });
        settings.on('change', () => {
            this.send('settings-updated', settings.forRenderer());
        });
        this.registerUpdater();
    }

    /**
     * Resolve a map-change payload into image bytes. Strings starting with
     * / or \ are files under userData/photo or userData/custom (containment
     * checked); anything else is base64 image data.
     * @returns {Promise<Buffer|null>} null when the path escapes the data dirs
     */
    async resolveMapImage(map) {
        if (!(map.startsWith("\\") || map.startsWith("/"))) {
            return Buffer.from(map, "base64");
        }
        const rel = map.replace(/\\/g, "/");
        const userdata = app.getPath('userData');
        let candidates;
        try {
            candidates = [safeJoin(path.join(userdata, "photo"), rel), safeJoin(path.join(userdata, "custom"), rel)];
        } catch (err) {
            console.warn('map-change: rejected path', err.message);
            return null;
        }
        for (const file of candidates) {
            try {
                return await fs.promises.readFile(file);
            } catch (err) {
                // Base64 JPEGs also start with "/" ("/9j/..."), so a miss is
                // expected; ENAMETOOLONG/ENOTDIR are that same case.
                if (!['ENOENT', 'EISDIR', 'ENOTDIR', 'ENAMETOOLONG'].includes(err.code)) {
                    console.warn('map-change: cannot read', file, err.message);
                }
            }
        }
        // Not a file on disk: keep the legacy fallback of decoding it as base64
        return Buffer.from(map, "base64");
    }

    async applyMapChange(map, opts, request) {
        const settings = this.settings;
        const overlayWindow = this.overlayWindow;
        const obsWindow = this.obsWindow;
        // Stop detection when map changes (user click, lobby update, etc.) --
        // unless the change came from the detector itself, which should keep
        // running, or is only the settings preview touching the overlay.
        if (!opts.fromDetector && !opts.preview && this.mapDetector) this.mapDetector.stop();

        const hide = () => {
            overlayWindow.send('map-hide');
            if (!opts.preview) obsWindow.send('map-hide');
        };
        if (!map || typeof map !== 'string') {
            hide();
            return;
        }
        const imgData = await this.resolveMapImage(map);
        // Superseded while reading?
        const overlayCurrent = request.overlay === this.overlayRequest;
        const obsCurrent = !opts.preview && request.obs === this.obsRequest;
        if (!overlayCurrent && !obsCurrent) return;
        if (!imgData) {
            if (overlayCurrent) overlayWindow.send('map-hide');
            if (obsCurrent) obsWindow.send('map-hide');
            return;
        }
        const bytes = new Uint8Array(imgData);
        // The settings preview stays off the OBS window -- it must never leak into a stream
        if (obsCurrent) obsWindow.send('map-change', bytes, settings.get('size'));
        if (!overlayCurrent) return;
        const dimensions = imageSize(imgData);
        const displays = screen.getAllDisplays();
        const monitorIndex = parseInt(settings.get('monitor')) || 0;
        const selectedDisplay = displays[monitorIndex] || displays[0] || screen.getPrimaryDisplay();
        // Window fits the rotated bounding box exactly so arbitrary angles don't
        // clip. No padding: any extra room shows up as a gap between the map
        // and the screen edge, so the corner presets / glide 0-100 could never
        // reach the corner.
        const displayWidth = parseInt(settings.get('size'));
        const rotated = rotatedSize({
            width: displayWidth,
            height: (displayWidth / dimensions.width) * dimensions.height,
            rotation: settings.get('rotation')
        });
        const draggable = settings.get('draggable');
        const {x, y} = draggable
            ? {x: settings.get('overlayX') || 0, y: settings.get('overlayY') || 0}
            : computeOverlayPosition({
                workArea: overlayArea(selectedDisplay, {platform: process.platform, displayCount: displays.length}),
                overlayWidth: rotated.width,
                overlayHeight: rotated.height,
                position: settings.get('position'),
                glideX: settings.get('glideX'),
                glideY: settings.get('glideY')
            });
        // One setBounds, not setSize + setPosition: on fractional scaling every
        // call rounds the window outward again, growing it a pixel per call.
        overlayWindow.setBounds({x, y, width: rotated.width, height: rotated.height});
        const layout = {
            box: rotated,
            align: overlayAlign({
                position: settings.get('position'),
                glideX: settings.get('glideX'),
                glideY: settings.get('glideY'),
                draggable
            })
        };
        // Raw bytes go over IPC (structured clone → Uint8Array in the renderer);
        // an empty payload means "hidden" for the overlay.
        const overlayBytes = settings.get('hideOverlay') ? new Uint8Array(0) : bytes;
        overlayWindow.send('map-change', overlayBytes, settings.get('size'), settings.get('opacity'), settings.get('draggable'), settings.get('rotation'), layout)
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
            width: 1180,
            height: 760,
            minWidth: 760,
            minHeight: 520,
            backgroundColor: '#0d0e12',
            webPreferences: securePreferences('preload.js'),
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
        loadPage(this.window, 'index')

        lockDownWebContents(this.window.webContents, shell);

        if(debug) this.window.webContents.openDevTools()
        if (!debug) this.window.setMenu(null)

        this.checkUpdates()
    }


    sendUpdate(message) {
        this.send('update-message', message);
    }

    // Listeners are registered once per process; show() can run again after
    // the window is closed and reopened from the tray.
    registerUpdater() {
        let classInstance = this;
        // Dev-only: lets `npm start` exercise the updater against dev-app-update.yml
        // without faking app.isPackaged for the whole app.
        if (process.env.DBD_DEV_UPDATER === 'true') autoUpdater.forceDevUpdateConfig = true;
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
    }

    checkUpdates() {
        if (this.updateCheckScheduled) return;
        this.updateCheckScheduled = true;
        setTimeout(() => {
            this.sendUpdate('Checking for updates...');
            autoUpdater.checkForUpdatesAndNotify().catch((err) => {
                console.error('Update check failed:', err);
                this.sendUpdate('Error while updating: ' + err);
            });
        },2000);
    }

    send(event, ...data) {
        if (this.window && !this.window.isDestroyed()) {
            this.window.webContents.send(event, ...data);
        }
    }

    focus() {
        if (this.window && !this.window.isDestroyed()) {
            this.window.focus();
        }
    }

    isVisible(){
        if (this.window && !this.window.isDestroyed()) {
            return this.window.isVisible();
        }
        return false;
    }

    hide(){
        if (this.window && !this.window.isDestroyed()) {
            this.window.hide();
        }
    }
}

module.exports = MainWindow;