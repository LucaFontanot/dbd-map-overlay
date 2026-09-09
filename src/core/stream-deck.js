const { ipcMain, dialog } = require('electron');
const fs = require('fs').promises;
const path = require('path');

class StreamDeck {
    constructor() {
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
                // fs is the promises API — callbacks are ignored and the error
                // branches were dead. Errors now surface through the catch below.
                await fs.mkdir(dir, { recursive: true });
                await fs.writeFile(filePath, JSON.stringify(config, null, 2));

                return { success: true };
            } catch (error) {
                console.error('Error saving config:', error);
                throw error;
            }
        });
    }
}

module.exports = StreamDeck;