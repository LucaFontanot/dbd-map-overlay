const path = require('path');
const { app, globalShortcut, ipcMain} = require('electron');
const fs = require("fs");
const {randomUUID} = require("crypto");

const hotkeyFilePath = path.join(app.getPath('userData'), 'hotkeys.json');

class Hotkeys {

    mainWindow;

    constructor(mainWindow) {
        this.mainWindow = mainWindow;
        let classInstance = this;
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
                classInstance.mainWindow.sendUpdate('Hotkey saved successfully.');
                console.log("Reloading hotkeys…");
                classInstance.loadKeys();
            } catch (err) {
                console.error("Failed to save hotkeys:", err);
                classInstance.mainWindow.sendUpdate('Failed to save hotkey.');
            }
        });

        ipcMain.on('load-hotkeys', (event) => {
            console.log("Loading hotkeys…");
            classInstance.loadKeys()
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
                classInstance.mainWindow.sendUpdate('Hotkey deleted.');
                classInstance.loadKeys();
            } else {
                console.warn(`No hotkey found for id ${id}`);
            }
        });
    }

    setDefaultHotkeys() {
        const win = this.mainWindow;
        if (!win) {
            console.log("Main window not available, cannot set hotkeys.");
            return;
        }
        console.log("Setting default hotkeys…");
        globalShortcut.register('CommandOrControl+p', () => {
            console.log('CommandOrControl+p pressed → toggle-map');
            win.send('check-lobby-update');
        });
        globalShortcut.register('CommandOrControl+h', () => {
            console.log('CommandOrControl+h pressed → toggle-map');
            win.send('toggle-map');
        });
        globalShortcut.register('CommandOrControl+r', () => {
            console.log('CommandOrControl+r pressed → rotate-map');
            win.send('rotate-map');
        });
    }

    registerHotkeys(hotkeys) {
        globalShortcut.unregisterAll();
        this.setDefaultHotkeys()

        const win = this.mainWindow;

        for (const [hotkey, { mapKey, id }] of Object.entries(hotkeys)) {
            const ok = globalShortcut.register(hotkey, () => {
                console.log(`(${id}) ${hotkey} pressed → ${mapKey}`);
                win.send('hotkey-pressed', mapKey);
            });

            if (!ok) {
                console.warn(`Failed to register “${hotkey}” (id: ${id})`);
                win.sendUpdate(`Failed to register “${hotkey}”`);
            }
        }
    }

    loadKeys() {
        if (!fs.existsSync(hotkeyFilePath)){
            console.log("Hotkey file does not exist");
            this.registerHotkeys({})
            return
        }

        try {
            const data   = fs.readFileSync(hotkeyFilePath, "utf-8");
            const parsed = JSON.parse(data);

            this.mainWindow.send('hotkey-updated', parsed);
            this.registerHotkeys(parsed);
        } catch (err) {
            console.error("Failed to load hotkeys:", err);
        }
    }
}

module.exports = Hotkeys;