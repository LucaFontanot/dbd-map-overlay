// StreamController (Linux Stream Deck app) page generator. The renderer only
// collects the options; paths, file names and the shell command embedded in
// each button are built and checked here.
const { ipcMain, dialog } = require('electron');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');

// Characters that stay special inside a double-quoted shell word. Anything
// containing them is refused rather than escaped: map keys come from file
// names (and the remote catalog), so they must never reach a shell unquoted.
const UNSAFE_SHELL_CHARS = /["`$\\]/;

function isShellSafe(value) {
    return typeof value === 'string' && value.length > 0 && !UNSAFE_SHELL_CHARS.test(value);
}

// Realm names become page file names
function isSafeFileStem(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 120 &&
        !/[/\\\0]/.test(value) && !value.startsWith('.');
}

function flatpakDataDir() {
    return path.join(os.homedir(), '.var', 'app', 'com.core447.StreamController', 'data');
}

function isInside(root, target) {
    const relative = path.relative(path.resolve(root), target);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function createLabels(text) {
    const words = text.replace(/\.[^/.]+$/, '').split(' ');
    if (words.length === 1) return {center: {text: words[0]}};
    if (words.length === 2) return {top: {text: words[0]}, center: {text: words[1]}};
    return {
        top: {text: words[0]},
        center: {text: words.slice(1, -1).join(' ')},
        bottom: {text: words[words.length - 1]},
    };
}

/**
 * Pure page builder: returns {fileName: pageConfig}.
 * @param {{buttonCount: number, commandPrefix: string, creator: string,
 *          realms: Object<string, string[]>, pagePath: (f: string) => string,
 *          iconPath: (f: string) => string}} opts
 */
function buildPages({buttonCount, commandPrefix, creator, realms, pagePath, iconPath}) {
    const pages = {};
    // Linear index → "col x row" on a roughly square grid
    const cols = Math.ceil(Math.sqrt(buttonCount));
    const position = (index) => `${index % cols}x${Math.floor(index / cols)}`;
    const changePage = (target) => ({
        id: 'com_core447_DeckPlugin::ChangePage',
        settings: {selected_page: pagePath(target), deck_number: null},
    });
    const navButton = (icon, target) => ({
        states: {
            '0': {
                media: {path: iconPath(icon)},
                actions: [changePage(target)],
                'image-control-action': 0,
                'label-control-actions': [0, 0, 0],
                'background-control-action': 0,
            },
        },
    });
    const labelButton = (label, action) => ({
        states: {
            '0': {
                labels: createLabels(label),
                actions: [action],
                'image-control-action': null,
                'label-control-actions': [0, 0, 0],
                'background-control-action': 0,
                media: {path: null},
            },
        },
    });

    // Main pages: one button per realm, 2 reserved for navigation
    const realmNames = Object.keys(realms);
    const perMain = buttonCount - 2;
    const mainPages = Math.ceil(realmNames.length / perMain);
    const mainName = (page) => page === 0 ? 'DeadByDaylight.json' : `DeadByDaylight_page${page + 1}.json`;
    for (let page = 0; page < mainPages; page++) {
        const keys = {};
        const start = page * perMain;
        realmNames.slice(start, start + perMain).forEach((realm, i) => {
            keys[position(i)] = labelButton(realm, changePage(`${realm}_page1.json`));
        });
        if (mainPages > 1) {
            if (page > 0) keys[position(buttonCount - 2)] = navButton('arrow-left.svg', mainName(page - 1));
            if (page < mainPages - 1) keys[position(buttonCount - 1)] = navButton('arrow-right.svg', mainName(page + 1));
        }
        pages[mainName(page)] = {keys};
    }

    // Realm pages: back button + page navigation reserved
    const perRealm = buttonCount - 3;
    for (const [realm, maps] of Object.entries(realms)) {
        const realmPages = Math.ceil(maps.length / perRealm);
        for (let page = 0; page < realmPages; page++) {
            const keys = {};
            keys[position(buttonCount - 1)] = navButton('arrow-left.svg', 'DeadByDaylight.json');
            const start = page * perRealm;
            maps.slice(start, start + perRealm).forEach((mapName, i) => {
                keys[position(i)] = labelButton(mapName, {
                    id: 'com_core447_OSPlugin::RunCommand',
                    settings: {command: `"${commandPrefix}" show-map="${creator}/${realm}/${mapName}"`},
                });
            });
            if (realmPages > 1) {
                if (page > 0) keys[position(buttonCount - 3)] = navButton('arrow-left.svg', `${realm}_page${page}.json`);
                if (page < realmPages - 1) keys[position(buttonCount - 2)] = navButton('arrow-right.svg', `${realm}_page${page + 2}.json`);
            }
            pages[`${realm}_page${page + 1}.json`] = {keys};
        }
    }
    return pages;
}

class StreamDeck {
    constructor() {
        // Directories the user picked through our own dialog; configs are only
        // written inside these (or the flatpak data dir).
        this.allowedDirs = new Set();

        ipcMain.handle('dialog:selectDirectory', async () => {
            const result = await dialog.showOpenDialog({
                properties: ['openDirectory'],
                title: 'Select Stream Controller Directory'
            });
            if (!result.canceled) {
                for (const dir of result.filePaths) this.allowedDirs.add(path.resolve(dir));
            }
            return {canceled: result.canceled, filePaths: result.filePaths};
        });

        ipcMain.handle('streamdeck:create', (event, options) => this.create(options));
    }

    async create(options) {
        const {installType, outputDir, creator} = options || {};
        const buttonCount = parseInt(options && options.buttonCount, 10);
        const commandPrefix = (options && options.commandPrefix) || 'dbd-map-tool';
        if (!Number.isInteger(buttonCount) || buttonCount < 4 || buttonCount > 64) {
            throw new Error('The button count must be between 4 and 64.');
        }
        if (!isShellSafe(commandPrefix)) throw new Error('The command prefix must not contain " ` $ or \\');
        if (!isShellSafe(creator) || creator.includes('/')) throw new Error('Invalid creator.');

        let dataDir;
        if (installType === 'flatpak') {
            dataDir = flatpakDataDir();
        } else if (installType === 'system' && typeof outputDir === 'string' &&
            [...this.allowedDirs].some(dir => dir === path.resolve(outputDir))) {
            dataDir = path.resolve(outputDir);
        } else {
            throw new Error('Pick the output directory with the Browse button first.');
        }

        const realms = {};
        const input = (options && options.realms) || {};
        for (const [realm, maps] of Object.entries(input)) {
            if (!isSafeFileStem(realm) || !isShellSafe(realm) || !Array.isArray(maps)) continue;
            // The key is embedded in a shell command (RunCommand)
            const safe = maps.filter(name => isShellSafe(name) && !name.includes('/'));
            if (safe.length > 0) realms[realm] = safe;
        }
        if (Object.keys(realms).length === 0) throw new Error('No maps found for the selected creator.');

        const pagesDir = path.join(dataDir, 'pages');
        const iconsDir = installType === 'flatpak'
            ? path.join(dataDir, 'icons', 'com_axolotlmaid_FontAwesomeIcons', 'icons', 'white')
            : path.join(dataDir, 'icons', 'white');
        const pages = buildPages({
            buttonCount, commandPrefix, creator, realms,
            pagePath: (file) => path.join(pagesDir, file),
            iconPath: (file) => path.join(iconsDir, file),
        });

        await fs.mkdir(pagesDir, {recursive: true});
        for (const [file, config] of Object.entries(pages)) {
            const target = path.join(pagesDir, file);
            if (!isInside(pagesDir, target)) throw new Error(`Refusing to write ${file}`);
            await fs.writeFile(target, JSON.stringify(config, null, 2));
        }
        return {pages: Object.keys(pages).length, dir: pagesDir};
    }
}

module.exports = StreamDeck;
module.exports.buildPages = buildPages;
module.exports.isShellSafe = isShellSafe;
