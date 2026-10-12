import {reactive} from 'vue';
import {dbd} from './bridge';
import {debugLog} from './logger';

// Main owns settings-app.json and broadcasts the full object (minus the token)
// after every change, including keys it writes itself (overlayX/Y, hotkeys).
const state = reactive({values: {}, loaded: false});
let ready = null;

dbd.on('settings-updated', (values) => {
    if (values && typeof values === 'object') state.values = values;
});

export const settings = {
    state,

    /** Idempotent: every caller shares the same promise. */
    init() {
        if (!ready) {
            ready = dbd.invoke('get-settings').then((values) => {
                state.values = values || {};
                state.loaded = true;
            });
        }
        return ready;
    },

    // `??`: a saved false stays false -- compare with === true / !== false
    get(key) {
        return state.values[key] ?? null;
    },

    /** Writes ONE key; main validates it and returns the full object. */
    async set(key, value) {
        state.values[key] = value;
        try {
            const updated = await dbd.invoke('set-setting', key, value);
            if (updated && typeof updated === 'object') state.values = updated;
        } catch (e) {
            debugLog('settings::set::error', key, e.message);
            throw e;
        }
    },
};
