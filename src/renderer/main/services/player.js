// What the overlay shows. Every pick (gallery click, hotkey, detector, lobby,
// Stream Deck) goes through sendMap, which forwards it to main (`map-change`)
// and, for user picks, to the lobby.
import {reactive} from 'vue';
import mapMatch from '@core/map-match.js';
import {dbd} from './bridge';
import {debugLog} from './logger';
import {settings} from './settings';
import {catalog} from './catalog';
import {lobby} from './lobby';
import {buildPreviewImage} from './overlay-preview';

const {logicalMapKeyFromPath, parseMapPath} = mapMatch;

const state = reactive({
    lastMap: '',
    lastMapCache: '',
    lastMapType: 'default',
    // Realm/Map identity of the overlay currently shown (from OCR or path).
    // Used to swap creator layouts without losing the detected map.
    lastLogicalMapKey: '',
    // Sample image on the overlay while the Overlay settings tab is open
    previewActive: false,
    // Overlay accepts the mouse so it can be dragged
    settingPosition: false,
});

function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

async function sendPreview() {
    const img = await buildPreviewImage();
    // The tab may have been left while the sample map was still rendering
    if (!state.previewActive) return;
    dbd.send('map-change', img, {preview: true});
}

export const player = {
    state,

    /** Display info for the map on the overlay, or null. */
    current() {
        if (!state.lastMap || state.lastMapType === 'base64') return state.lastMap ? {name: 'Lobby custom map', realm: '', creator: ''} : null;
        const parsed = parseMapPath(state.lastMap);
        return parsed ? {name: parsed.base, realm: parsed.realm, creator: parsed.creator} : null;
    },

    /**
     * @param {string} map file path, base64 data, or "" to hide
     * @param {'standard'|'custom'|'base64'|string} type
     * @param {boolean} api forward the pick to the joined lobby
     * @param {boolean} fromDetector keep the detector running (re-apply, not a pick)
     */
    async sendMap(map, type, api = true, fromDetector = false) {
        if (state.settingPosition) this.setPositioning(false);
        if (map !== '') {
            state.lastMapCache = map;
            // Detector already stored the English Realm/Map key. Keep it so
            // later creator swaps match against the canonical name, not an
            // artist-specific filename (`Coal Tower 1 - Istari`).
            if (!fromDetector) {
                const fromPath = logicalMapKeyFromPath(map);
                if (fromPath) state.lastLogicalMapKey = fromPath;
            }
        }
        if (type === '') return false;
        state.lastMap = map;
        state.lastMapType = type;
        dbd.send('map-change', map, {fromDetector});
        // A map arriving mid-preview (detector, lobby) must not replace the
        // sample map on screen -- it is recorded above and re-covered here.
        if (state.previewActive) sendPreview();
        if (api) {
            // Hiding is "" for every type: never read the custom dir itself
            if (map === '') {
                await lobby.setMap('', 'standard');
            } else if (type === 'custom') {
                const data = await dbd.invoke('read-custom-data', map);
                await lobby.setMap(bytesToBase64(data), type);
            } else if (type === 'standard') {
                await lobby.setMap(map, 'standard');
            }
        }
        return true;
    },

    /**
     * Hide button / hotkey: hide the map, or bring back the last one. Not a
     * new pick, so auto-detect keeps running (fromDetector).
     */
    toggle() {
        if (state.lastMap === '') return this.sendMap(state.lastMapCache, state.lastMapType, true, true);
        return this.sendMap('', state.lastMapType, true, true);
    },

    /**
     * Re-send whatever the overlay should show after a settings change.
     * @param {{lobby?: boolean}} opts lobby: also push to the lobby (only
     *        rotation is shared; slider ticks would flood the server)
     */
    refresh({lobby: toLobby = false} = {}) {
        if (state.previewActive) return sendPreview();
        // Re-apply, not a pick: the detector's claim on the overlay must survive
        return this.sendMap(state.lastMap, state.lastMapType, toLobby, true);
    },

    async rotate() {
        const rotation = ((parseInt(settings.get('rotation'), 10) || 0) + 90) % 360;
        await settings.set('rotation', rotation);
        // Re-applies, not picks: the detector's claim on the overlay must survive
        if (state.lastMap !== '') {
            await this.sendMap(state.lastMap, state.lastMapType, true, true);
        } else if (state.lastMapCache !== '') {
            await this.sendMap(state.lastMapCache, state.lastMapType, true, true);
        }
    },

    startPreview() {
        if (state.previewActive) return;
        state.previewActive = true;
        sendPreview();
    },

    stopPreview() {
        if (!state.previewActive) return;
        state.previewActive = false;
        // Put the overlay back to whatever it showed before the preview
        dbd.send('map-change', state.lastMap || '', {preview: true});
    },

    setPositioning(on) {
        state.settingPosition = on;
        dbd.send('set-mouse-drag', on);
    },

    /**
     * Swap the overlay to the same realm/map in `creator`'s layout without
     * stopping the detector. Does not write preferredCreator — the gallery
     * filter is a per-match overlay pick; Settings owns the saved default.
     */
    async onCreatorLayoutChanged(creator) {
        if (!creator) return;
        const identity = state.lastLogicalMapKey
            || logicalMapKeyFromPath(state.lastMap)
            || logicalMapKeyFromPath(state.lastMapCache);
        if (!identity) return;

        const newPath = catalog.findClosestMapMatch(identity, creator, {fallback: false});
        if (!newPath) {
            debugLog('player::onCreatorLayoutChanged::no-layout', creator, identity);
            return;
        }
        // Overlay hidden (Ctrl+H): retarget the cache so unhide uses the new layout.
        if (!state.lastMap) {
            state.lastMapCache = newPath;
            return;
        }
        if (newPath === state.lastMap) return;
        debugLog('player::onCreatorLayoutChanged::swap', identity, creator, newPath);
        await this.sendMap(newPath, catalog.typeOf(newPath), true, true);
    },

    /** Main-process events that pick or clear a map. Call once. */
    listen() {
        // Detector pick (fromDetector: the detector keeps running)
        dbd.on('show-map-command', async (key) => {
            await catalog.whenLoaded();
            const path = catalog.findClosestMapMatch(key);
            if (!path) {
                debugLog('show-map-command::no-match', key);
                return;
            }
            state.lastLogicalMapKey = key;
            // A resolved path differing from the preferred creator means the
            // preferred creator has no local copy of this map, so another
            // artist's PNG is being substituted -- usually a stale/incomplete
            // preferred-creator download, not a matching bug.
            const preferred = (settings.get('preferredCreator') || '').trim();
            const resolvedCreator = parseMapPath(path)?.creator || '';
            if (preferred && resolvedCreator && resolvedCreator.toLowerCase() !== preferred.toLowerCase()) {
                debugLog('show-map-command::creator-fallback',
                    `"${key}" has no ${preferred} copy locally; showing ${resolvedCreator} (${path})`);
            }
            await this.sendMap(path, catalog.typeOf(path), true, true);
        });
        // Stream Deck buttons / second-instance `show-map=` args: same payload,
        // but it is the user picking a map, so it takes the overlay over.
        dbd.on('external-map-command', async (key) => {
            await catalog.whenLoaded();
            const path = catalog.lookup(key) || catalog.findClosestMapMatch(key);
            if (!path) {
                debugLog('external-map-command::no-match', key);
                return;
            }
            await this.sendMap(path, catalog.typeOf(path), true, false);
        });
        dbd.on('hotkey-pressed', async (key) => {
            await catalog.whenLoaded();
            const path = catalog.lookup(key);
            if (!path) {
                debugLog('hotkey::no-map', key);
                return;
            }
            await this.sendMap(path, catalog.typeOf(path));
        });
        dbd.on('map-detector-clear', (reason) => {
            debugLog('map-detector-clear', reason);
            state.lastLogicalMapKey = '';
            this.sendMap('', state.lastMapType || 'standard', true, true);
        });
        dbd.on('toggle-map', () => this.toggle());
        dbd.on('rotate-map', () => this.rotate());
    },
};
