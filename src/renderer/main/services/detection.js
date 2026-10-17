// Automatic map detection (OCR in main, src/core/map-detector.js).
import {reactive} from 'vue';
import {dbd} from './bridge';
import {settings} from './settings';
import {notify} from './ui';

const state = reactive({
    // {state: 'downloading'|'ready'|'error', code?, message}
    modelStatus: null,
    // "pick your game language first" dialog
    languageDialog: false,
});
let readyTimer = null;

async function restartIfRunning() {
    if (await dbd.invoke('map-detector-status')) {
        await dbd.invoke('map-detector-stop-automatic');
        await dbd.invoke('map-detector-start-automatic');
    }
}

export const detection = {
    state,

    listen() {
        // A first run downloads the language model; a failed download used to
        // be console-only, which looks exactly like "auto-detect is broken".
        dbd.on('map-detector-model-status', (status) => {
            clearTimeout(readyTimer);
            state.modelStatus = status;
            // Nothing to act on once the model is in place
            if (status && status.state === 'ready') {
                readyTimer = setTimeout(() => {
                    state.modelStatus = null;
                }, 4000);
            }
        });
        // Keybind mode: feedback for the detect-map key, the user is in game
        dbd.on('map-detector-keybind-status', (status) => {
            if (!status) return;
            if (status.state === 'scanning') notify('Detecting map…', 'info', 3000);
            else if (status.state === 'not-found') notify(`No map detected: ${status.reason || 'no map title seen'}`, 'warning');
        });
    },

    get mode() {
        return settings.get('detectionMode') === 'keybind' ? 'keybind' : 'automatic';
    },

    /** Switching mode rebuilds the running detector (state machine ↔ keybind). */
    async setMode(mode) {
        await settings.set('detectionMode', mode);
        await restartIfRunning();
    },

    get enabled() {
        return settings.get('mapDetection') === true;
    },

    async setEnabled(on) {
        if (on) {
            // All-language OCR is slow and error-prone: require a game language
            if ((settings.get('ocrLanguage') || 'all') === 'all') {
                state.languageDialog = true;
                return;
            }
            await settings.set('mapDetection', true);
            await dbd.invoke('map-detector-start-automatic');
        } else {
            await settings.set('mapDetection', false);
            await dbd.invoke('map-detector-stop-automatic');
        }
    },

    async setLanguage(lang) {
        await settings.set('ocrLanguage', lang);
        // Detection was switched on but blocked on the language: start it now
        if (lang !== 'all' && settings.get('mapDetection') === true &&
            !(await dbd.invoke('map-detector-status'))) {
            await dbd.invoke('map-detector-start-automatic');
            return;
        }
        await restartIfRunning();
    },

    /** Language dialog confirmed: save it and switch detection on. */
    async confirmLanguage(lang) {
        state.languageDialog = false;
        await settings.set('ocrLanguage', lang);
        await settings.set('mapDetection', true);
        await dbd.invoke('map-detector-start-automatic');
    },
};
