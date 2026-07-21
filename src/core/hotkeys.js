const path = require('path');
const { app, globalShortcut, ipcMain } = require('electron');
const fs = require("fs");
const { randomUUID } = require("crypto");
const { SYSTEM_HOTKEY_DEFS, ACTION_TO_SETTING_KEY, acceleratorToDisplay } = require("../shared/hotkeys-constants");

const hotkeyFilePath = path.join(app.getPath('userData'), 'hotkeys.json');

class Hotkeys {

    mainWindow;
    settings;

    constructor(mainWindow, settings) {
        this.mainWindow = mainWindow;
        this.settings = settings;
        let classInstance = this;

        // --- Custom map hotkeys ---
        ipcMain.on('save-hotkeys', (event, settings) => {
            const { hotkey, mapkey, id: incomingId } = settings;
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
            classInstance.loadKeys();
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

        // --- System hotkeys ---
        ipcMain.handle('get-system-hotkeys', async () => {
            return classInstance.getSystemHotkeys();
        });

        ipcMain.on('save-system-hotkey', (event, { actionId, accelerator }) => {
            if (!actionId || !accelerator) {
                console.warn("save-system-hotkey: missing actionId or accelerator");
                classInstance.mainWindow.sendUpdate('Failed to save hotkey: missing data.');
                return;
            }

            const settingKey = ACTION_TO_SETTING_KEY[actionId];
            if (!settingKey) {
                console.warn(`save-system-hotkey: unknown actionId "${actionId}"`);
                classInstance.mainWindow.sendUpdate('Failed to save hotkey: unknown action.');
                return;
            }

            // Check for conflicts with other system hotkeys
            const current = classInstance.getSystemHotkeys();
            for (const [otherActionId, otherAccel] of Object.entries(current)) {
                if (otherActionId !== actionId && otherAccel === accelerator) {
                    const def = SYSTEM_HOTKEY_DEFS[otherActionId];
                    const name = def ? def.description : otherActionId;
                    classInstance.mainWindow.sendUpdate(`Conflict: "${acceleratorToDisplay(accelerator)}" is already bound to "${name}".`);
                    return;
                }
            }

            // Check for conflicts with custom map hotkeys
            if (fs.existsSync(hotkeyFilePath)) {
                try {
                    const customHotkeys = JSON.parse(fs.readFileSync(hotkeyFilePath, 'utf-8'));
                    if (customHotkeys[accelerator]) {
                        classInstance.mainWindow.sendUpdate(`Conflict: "${acceleratorToDisplay(accelerator)}" is already used by a custom map hotkey.`);
                        return;
                    }
                } catch (err) {
                    console.error("Error checking custom hotkey conflicts:", err);
                }
            }

            // Save and re-register
            classInstance.settings.set(settingKey, accelerator);
            classInstance.mainWindow.sendUpdate('System hotkey saved.');
            classInstance.loadKeys();
        });

        ipcMain.on('reset-system-hotkey', (event, { actionId }) => {
            const settingKey = ACTION_TO_SETTING_KEY[actionId];
            if (!settingKey) {
                console.warn(`reset-system-hotkey: unknown actionId "${actionId}"`);
                return;
            }

            const def = SYSTEM_HOTKEY_DEFS[actionId];
            if (!def) return;

            classInstance.settings.set(settingKey, def.defaultAccelerator);
            classInstance.mainWindow.sendUpdate('Hotkey reset to default.');
            classInstance.loadKeys();
        });
    }

    /**
     * Get the current system hotkey accelerators, merging defaults
     * with any user overrides stored in settings.
     * @returns {Object<string, string>} actionId → accelerator
     */
    getSystemHotkeys() {
        const result = {};
        for (const [actionId, def] of Object.entries(SYSTEM_HOTKEY_DEFS)) {
            const settingKey = ACTION_TO_SETTING_KEY[actionId];
            const stored = this.settings.get(settingKey);
            result[actionId] = stored || def.defaultAccelerator;
        }
        return result;
    }

    /**
     * Register the 4 system hotkeys from settings (with defaults fallback).
     */
    registerSystemHotkeys() {
        const win = this.mainWindow;
        if (!win) {
            console.log("Main window not available, cannot set system hotkeys.");
            return;
        }

        const systemHotkeys = this.getSystemHotkeys();
        console.log("Registering system hotkeys…");

        // Map action IDs to the IPC events they should fire
        const actionToIpc = {
            'check-lobby': 'check-lobby-update',
            'toggle-map': 'toggle-map',
            'rotate-map': 'rotate-map',
            'trigger-map-detection': 'trigger-map-detection'
        };

        for (const [actionId, accelerator] of Object.entries(systemHotkeys)) {
            const ipcEvent = actionToIpc[actionId];
            if (!ipcEvent) continue;

            const ok = globalShortcut.register(accelerator, () => {
                console.log(`${accelerator} pressed → ${ipcEvent}`);
                win.send(ipcEvent);
            });

            if (!ok) {
                console.warn(`Failed to register system hotkey "${accelerator}" (${actionId})`);
                win.sendUpdate(`Failed to register "${acceleratorToDisplay(accelerator)}"`);
            }
        }
    }

    /**
     * Register custom map hotkeys from the hotkeys.json data object.
     * System hotkeys take priority — conflicts are skipped.
     * @param {Object} hotkeys — { accelerator: { id, mapKey } }
     */
    registerCustomHotkeys(hotkeys) {
        const win = this.mainWindow;
        if (!win) return;

        const systemAccelerators = new Set(Object.values(this.getSystemHotkeys()));

        for (const [hotkey, { mapKey, id }] of Object.entries(hotkeys)) {
            // Skip if this accelerator is already used by a system hotkey
            if (systemAccelerators.has(hotkey)) {
                console.warn(`Skipping custom hotkey "${hotkey}" — conflicts with a system hotkey.`);
                continue;
            }

            const ok = globalShortcut.register(hotkey, () => {
                console.log(`(${id}) ${hotkey} pressed → ${mapKey}`);
                win.send('hotkey-pressed', mapKey);
            });

            if (!ok) {
                console.warn(`Failed to register "${hotkey}" (id: ${id})`);
                win.sendUpdate(`Failed to register "${hotkey}"`);
            }
        }
    }

    /**
     * Reload all hotkeys: unregister everything, then re-register
     * system hotkeys first, then custom map hotkeys.
     */
    loadKeys() {
        globalShortcut.unregisterAll();

        // Register system hotkeys first (they take priority)
        this.registerSystemHotkeys();

        // Then register custom map hotkeys
        if (!fs.existsSync(hotkeyFilePath)) {
            console.log("Hotkey file does not exist — only system hotkeys active.");
            this.mainWindow.send('hotkey-updated', {});
        } else {
            try {
                const data = fs.readFileSync(hotkeyFilePath, "utf-8");
                const parsed = JSON.parse(data);
                this.mainWindow.send('hotkey-updated', parsed);
                this.registerCustomHotkeys(parsed);
            } catch (err) {
                console.error("Failed to load custom hotkeys:", err);
                this.mainWindow.send('hotkey-updated', {});
            }
        }

        // Send current system hotkey bindings to renderer
        const systemBindings = this.getSystemHotkeys();
        this.mainWindow.send('system-hotkeys-updated', systemBindings);
    }
}

module.exports = Hotkeys;
