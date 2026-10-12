const { ipcMain, dialog } = require('electron');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');

// StreamController's flatpak pages dir -- the renderer writes there without
// a dialog. Both spellings: the renderer builds it from $USER, not homedir().
function flatpakPageDirs() {
    const suffix = path.join('.var', 'app', 'com.core447.StreamController', 'data', 'pages');
    const dirs = [path.join(os.homedir(), suffix)];
    if (process.env.USER) dirs.push(path.join('/home', process.env.USER, suffix));
    return dirs;
}

function isInside(root, target) {
    const relative = path.relative(path.resolve(root), target);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

class StreamDeck {
    constructor() {
        // Directories the user picked through our own dialog; saveConfig only
        // writes .json files inside these (or the flatpak pages dir).
        this.allowedDirs = new Set();

        ipcMain.handle('dialog:selectDirectory', async () => {
            const result = await dialog.showOpenDialog({
                properties: ['openDirectory'],
                title: 'Select Stream Controller Directory'
            });
            if (!result.canceled) {
                for (const dir of result.filePaths) this.allowedDirs.add(path.resolve(dir));
            }
            return result;
        });

        ipcMain.handle('streamdeck:saveConfig', async (event, filePath, config) => {
            try {
                if (typeof filePath !== 'string') throw new Error('Invalid config path');
                const target = path.resolve(filePath);
                const roots = [...this.allowedDirs, ...flatpakPageDirs()];
                if (path.extname(target).toLowerCase() !== '.json' || !roots.some(root => isInside(root, target))) {
                    throw new Error(`Refusing to write Stream Deck config outside the selected directory: ${filePath}`);
                }
                const dir = path.dirname(target);
                // fs is the promises API — callbacks are ignored and the error
                // branches were dead. Errors now surface through the catch below.
                await fs.mkdir(dir, { recursive: true });
                await fs.writeFile(target, JSON.stringify(config, null, 2));

                return { success: true };
            } catch (error) {
                console.error('Error saving config:', error);
                throw error;
            }
        });
    }
}

module.exports = StreamDeck;
