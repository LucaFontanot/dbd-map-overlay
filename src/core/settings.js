const uuid = require('uuid');
const {app, ipcMain} = require("electron");
const fs = require("fs");
const path = require("path");

const defaultConfig = {
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

class Settings {

    settings = {};

    constructor() {
        const userdata = app.getPath('userData');
        const fileDir = path.join(userdata, "settings-app.json")
        if (!fs.existsSync(fileDir)) {
            fs.writeFileSync(fileDir, JSON.stringify(defaultConfig))
        }
        this.settings = JSON.parse(fs.readFileSync(fileDir, "utf-8"));
        for (let key in defaultConfig) {
            if (this.settings[key] === undefined) {
                this.settings[key] = defaultConfig[key]
            }
        }
        let classInstance = this;
        ipcMain.handle('get-settings', async (event) => {
            return classInstance.settings
        })
        ipcMain.handle('save-settings', async (event, settings) => {
            if (settings !== null) {
                classInstance.save(settings)
            }
        })
    }

    get(key) {
        return this.settings[key];
    }

    set(key, value) {
        this.settings[key] = value;
        this.save(this.settings);
    }

    save(settings) {
        const userdata = app.getPath('userData');
        const fileDir = path.join(userdata, "settings-app.json")
        fs.writeFileSync(fileDir, JSON.stringify(settings))
        this.settings = settings;
    }

}

module.exports = Settings;