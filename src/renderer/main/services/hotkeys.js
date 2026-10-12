// Global hotkeys live in main (globalShortcut); this mirrors their state.
import {reactive} from 'vue';
import hotkeyConstants from '@shared/hotkeys-constants.js';
import {dbd} from './bridge';

export const {SYSTEM_HOTKEY_DEFS, acceleratorToDisplay, displayToAccelerator} = hotkeyConstants;

const state = reactive({
    // accelerator → {id, mapKey}
    maps: {},
    // actionId → accelerator
    system: {},
});

export const hotkeys = {
    state,

    listen() {
        dbd.on('hotkey-updated', (maps) => {
            state.maps = maps || {};
        });
        dbd.on('system-hotkeys-updated', (bindings) => {
            state.system = bindings || {};
        });
    },

    async load() {
        dbd.send('load-hotkeys');
        try {
            state.system = await dbd.invoke('get-system-hotkeys') || {};
        } catch (e) {
            state.system = {};
        }
    },

    systemAccelerator(actionId) {
        return state.system[actionId] || SYSTEM_HOTKEY_DEFS[actionId].defaultAccelerator;
    },

    /** @param {string} display "Ctrl + Shift + K" */
    saveMap(display, mapKey) {
        dbd.send('save-hotkeys', {hotkey: display.replace(/\s*\+\s*/g, '+'), mapkey: mapKey});
    },

    remove(id) {
        dbd.send('delete-hotkey', id);
    },

    saveSystem(actionId, display) {
        dbd.send('save-system-hotkey', {actionId, accelerator: displayToAccelerator(display)});
    },

    resetSystem(actionId) {
        dbd.send('reset-system-hotkey', {actionId});
    },
};

/** KeyboardEvent → "Ctrl + Shift + K" (modifiers alone give "Ctrl + "). */
export function keyEventToDisplay(e) {
    const keys = [];
    if (e.ctrlKey) keys.push('Ctrl');
    if (e.metaKey) keys.push('Meta');
    if (e.altKey) keys.push('Alt');
    if (e.shiftKey) keys.push('Shift');
    if (!['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
        keys.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
    }
    return keys.join(' + ');
}
