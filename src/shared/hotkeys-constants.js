/**
 * Shared hotkey definitions used by both main and renderer processes.
 * Plain CommonJS — no build step needed.
 */

/** @type {Object<string, {id: string, defaultAccelerator: string, description: string, action: string}>} */
const SYSTEM_HOTKEY_DEFS = {
    'check-lobby': {
        id: 'check-lobby',
        defaultAccelerator: 'CommandOrControl+P',
        description: 'Reload Map when in a Lobby',
        action: 'check-lobby-update'
    },
    'toggle-map': {
        id: 'toggle-map',
        defaultAccelerator: 'CommandOrControl+H',
        description: 'Hide currently open Map',
        action: 'toggle-map'
    },
    'rotate-map': {
        id: 'rotate-map',
        defaultAccelerator: 'CommandOrControl+R',
        description: 'Rotate Map by 90 degrees',
        action: 'rotate-map'
    },
    'trigger-map-detection': {
        id: 'trigger-map-detection',
        defaultAccelerator: 'CommandOrControl+Q',
        description: 'Trigger auto-detection (OCR scan for current map)',
        action: 'trigger-map-detection'
    }
};

/**
 * Map action IDs to settings keys for persistence.
 * @type {Object<string, string>}
 */
const ACTION_TO_SETTING_KEY = {
    'check-lobby': 'hotkeyCheckLobby',
    'toggle-map': 'hotkeyToggleMap',
    'rotate-map': 'hotkeyRotateMap',
    'trigger-map-detection': 'hotkeyMapDetection'
};

/**
 * Convert an Electron accelerator to human-readable display format.
 * "CommandOrControl+Shift+P" → "Ctrl + Shift + P"
 * @param {string} accel
 * @returns {string}
 */
function acceleratorToDisplay(accel) {
    if (!accel) return '';
    return accel
        .replace('CommandOrControl', 'Ctrl')
        .replace('Command', 'Cmd')
        .replace('Control', 'Ctrl')
        .replace(/\+/g, ' + ');
}

/**
 * Convert a display-format string to Electron accelerator format.
 * "Ctrl + Shift + P" → "CommandOrControl+Shift+P"
 * @param {string} display
 * @returns {string}
 */
function displayToAccelerator(display) {
    if (!display) return '';
    return display
        .replace(/\s*\+\s*/g, '+')
        .replace('Ctrl', 'CommandOrControl')
        .replace('Cmd', 'CommandOrControl')
        .replace('CommandOrControl+CommandOrControl', 'CommandOrControl')
        .trim();
}

/**
 * Normalize an accelerator string: trim spaces around + separators.
 * "Ctrl + Shift + P" → "Ctrl+Shift+P"
 * @param {string} accel
 * @returns {string}
 */
function normalizeAccelerator(accel) {
    if (!accel) return '';
    return accel.replace(/\s*\+\s*/g, '+').trim();
}

module.exports = {
    SYSTEM_HOTKEY_DEFS,
    ACTION_TO_SETTING_KEY,
    acceleratorToDisplay,
    displayToAccelerator,
    normalizeAccelerator
};
