const {ipcRenderer} = require("electron");
const {debugLog} = require("./logger");

class Settings {

    constructor(api) {
        debugLog("settings::constructor::called");
        this.api = api;
        this.settings = {};
        this.init()
    }

    async init() {
        debugLog("settings::init::called");
        this.settings = await ipcRenderer.invoke('get-settings');
        if (this.get("token") === "" || this.get("token") === null) {
            debugLog("settings::init::no-token", "Attempting to register user.");
            try {
                const user = await this.api.register();
                debugLog("settings::init::user-registered", user);
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
        return this.settings[key] || null;
    }

    async set(key, value) {
        this.settings[key] = value;
        await ipcRenderer.invoke('save-settings', this.settings)
    }

}

module.exports = Settings;