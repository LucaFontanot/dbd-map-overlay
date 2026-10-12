const {randomUUID} = require('crypto');
const {EventEmitter} = require('events');
const {app, ipcMain} = require("electron");
const fs = require("fs");
const path = require("path");

const defaultConfig = {
    size: 250,
    position: 1,
    opacity: 0.5,
    id: null, // generated on first load (see constructor)
    draggable: false,
    hideOverlay: false,
    token: "",
    minimizeToTray: false,
    disableFaqPopup: false,
    rotation: 0,
    monitor: 0,
    overlayX: null,
    overlayY: null,
    glideX: null,
    glideY: null,
    mapDetection: false,
    ocrLanguage: 'all',
    preferredCreator: '',
    detectInCustoms: true,
    hotkeyCheckLobby: 'CommandOrControl+P',
    hotkeyToggleMap: 'CommandOrControl+H',
    hotkeyRotateMap: 'CommandOrControl+R'
};

/**
 * Main-process owner of settings-app.json. Renderers never write the whole
 * object: they send single keys via `set-setting`, so a stale renderer copy
 * cannot clobber keys main wrote (overlayX/Y, hotkeys, mapDetection).
 * Emits 'change' (key, value, settings) on every set.
 */
class Settings extends EventEmitter {

    settings = {};

    constructor() {
        super();
        this.filePath = path.join(app.getPath('userData'), "settings-app.json");
        this.settings = this.load();
        let changed = false;
        for (let key in defaultConfig) {
            if (this.settings[key] === undefined) {
                this.settings[key] = defaultConfig[key];
                changed = true;
            }
        }
        if (!this.settings.id) {
            this.settings.id = randomUUID();
            changed = true;
        }
        if (changed) this.persist();
        // set() debounces disk writes (sliders fire every ~60 ms); never lose the last one on quit
        app.on('will-quit', () => this.flush());

        let classInstance = this;
        ipcMain.handle('get-settings', async (event) => {
            return classInstance.settings
        })
        ipcMain.handle('set-setting', async (event, key, value) => {
            if (typeof key !== 'string' || !key) throw new Error('set-setting: key must be a non-empty string');
            classInstance.set(key, value);
            return classInstance.settings;
        })
    }

    load() {
        let raw;
        try {
            raw = fs.readFileSync(this.filePath, "utf-8");
        } catch (e) {
            if (e.code !== 'ENOENT') console.error("Settings: cannot read settings file:", e);
            return {...defaultConfig};
        }
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
            throw new Error("settings file is not a JSON object");
        } catch (e) {
            console.error("Settings: corrupt settings file, backing up and using defaults:", e.message);
            try {
                fs.copyFileSync(this.filePath, this.filePath + ".bak");
            } catch (backupErr) {
                console.error("Settings: failed to back up corrupt settings file:", backupErr);
            }
            return {...defaultConfig};
        }
    }

    get(key) {
        return this.settings[key];
    }

    set(key, value) {
        this.settings[key] = value;
        clearTimeout(this.persistTimer);
        this.persistTimer = setTimeout(() => this.flush(), 250);
        this.emit('change', key, value, this.settings);
    }

    flush() {
        if (!this.persistTimer) return;
        clearTimeout(this.persistTimer);
        this.persistTimer = null;
        this.persist();
    }

    // Write to a temp file then rename, so a crash mid-write never leaves a truncated settings file
    persist() {
        const tmp = this.filePath + ".tmp";
        try {
            fs.writeFileSync(tmp, JSON.stringify(this.settings));
            fs.renameSync(tmp, this.filePath);
        } catch (e) {
            console.error("Settings: failed to save settings:", e);
        }
    }

}

module.exports = Settings;
