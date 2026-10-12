const {ipcRenderer} = require("electron");
const {debugLog} = require("./logger");

class Settings {

    constructor(api) {
        debugLog("settings::constructor::called");
        this.api = api;
        this.settings = {};
        this.ready = null;
        // Main is the source of truth: it broadcasts the full object whenever
        // any key changes (including keys main writes itself).
        ipcRenderer.on('settings-updated', (event, settings) => {
            if (settings && typeof settings === 'object') {
                this.settings = settings;
            }
        });
    }

    /**
     * Loads settings from main and registers the user if needed. Idempotent:
     * every caller shares the same promise, so it only runs once.
     * @returns {Promise<void>}
     */
    init() {
        if (!this.ready) {
            this.ready = this._init();
        }
        return this.ready;
    }

    async _init() {
        debugLog("settings::init::called");
        this.settings = await ipcRenderer.invoke('get-settings') || {};
        if (this.get("token") === "" || this.get("token") === null) {
            debugLog("settings::init::no-token", "Attempting to register user.");
            try {
                const user = await this.api.register();
                debugLog("settings::init::user-registered", user ? user.id : null);
                if (user) {
                    await this.set("token", user.token);
                    await this.set("id", user.id);
                }
            } catch (error) {
                debugLog("settings::init::error-registering", error.message);
            }
        }
        this.api.setToken(this.get("token"));
    }

    get(key) {
        return this.settings[key] ?? null;
    }

    async set(key, value) {
        this.settings[key] = value;
        const updated = await ipcRenderer.invoke('set-setting', key, value);
        if (updated && typeof updated === 'object') {
            this.settings = updated;
        }
    }

}

module.exports = Settings;
