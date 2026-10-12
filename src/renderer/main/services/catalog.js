// Local map catalog: downloaded maps (<userData>/photo) + custom maps
// (<userData>/custom), indexed as Creator → Realm → [file names].
import {reactive, shallowReactive} from 'vue';
import mapMatch from '@core/map-match.js';
import {dbd} from './bridge';
import {debugLog} from './logger';
import {settings} from './settings';

const {findClosestMapMatch, parseMapPath, foldName, levenshtein} = mapMatch;

/** `\Creator\Realm\Map.png` / `/Creator/Realm/Map.png` → `Creator/Realm/Map.png` */
export function normalizePhotoKey(p) {
    return String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function foldTokens(str) {
    return foldName(str).split(' ').filter(Boolean);
}

/**
 * Nearest-string scoring for the gallery search. Every query token must find
 * an approximate match in the candidate's map+realm name tokens; the returned
 * penalty grows with edit distance. Built on map-match's shared foldName +
 * levenshtein (the app's single source of fuzzy name matching).
 * @returns {number|null} penalty (0 = exact) or null when too far / too short.
 */
function fuzzyTokenScore(queryTokens, candidateTokens) {
    let total = 0;
    for (const qt of queryTokens) {
        if (qt.length < 2) return null; // a 1-char token is too weak for fuzzy
        let best = Infinity;
        for (const ct of candidateTokens) {
            let d;
            if (ct === qt) {
                d = 0;
            } else if (ct.length >= 3 && (ct.startsWith(qt) || (qt.length >= 3 && qt.startsWith(ct)))) {
                d = 1; // prefix match (partial word)
            } else {
                const allowed = Math.max(2, Math.floor(Math.max(qt.length, ct.length) * 0.3));
                d = levenshtein(qt, ct);
                if (d > allowed) continue;
            }
            if (d < best) best = d;
        }
        if (!Number.isFinite(best)) return null;
        total += best;
    }
    return total;
}

const state = reactive({
    loaded: false,
    // Message when the local map lists could not be read
    loadError: '',
    // Creator → Realm → [map file names]
    mapDictionary: {},
    creators: [],
    customMaps: [],
    // Bumped when custom files change: they can be overwritten under the same name
    customVersion: 0,
});

// Gallery thumbnails: path → object URL of a small WebP made in this renderer
// from the file bytes (Chromium's decoder, off the main thread). Built for
// every map while the startup loading screen is up, like the old blob cache,
// but downscaled: maps are up to 3840 px and 200 full-size decodes cost
// hundreds of MB. Never sharp in main: on Linux its addon binds GLib calls to
// Chromium's system GLib and crashes Electron (see user-data.js).
const THUMB_SIZE = 480;
const THUMB_WORKERS = 4;
const thumbs = shallowReactive(new Map());

async function makeThumbnail(path, type) {
    const bytes = await dbd.invoke(type === 'custom' ? 'read-custom-data' : 'read-photo-data', path);
    if (!bytes || !bytes.length) return null;
    let bitmap = await createImageBitmap(new Blob([bytes]));
    const scale = THUMB_SIZE / Math.max(bitmap.width, bitmap.height);
    if (scale < 1) {
        const full = bitmap;
        bitmap = await createImageBitmap(full, {
            resizeWidth: Math.max(1, Math.round(full.width * scale)),
            resizeHeight: Math.max(1, Math.round(full.height * scale)),
            resizeQuality: 'high',
        });
        full.close();
    }
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    return URL.createObjectURL(await canvas.convertToBlob({type: 'image/webp', quality: 0.82}));
}

function dropThumbnail(path) {
    URL.revokeObjectURL(thumbs.get(path));
    thumbs.delete(path);
}

// Not reactive: large lookup tables only read imperatively
let pathLookup = {};
let customPaths = new Set();
let loadedPromise = null;
let resolveLoaded;
const whenLoadedPromise = new Promise((resolve) => {
    resolveLoaded = resolve;
});

async function load() {
    try {
        const [photos, custom] = await Promise.all([
            dbd.invoke('get-dir-photos'),
            dbd.invoke('get-custom-photos'),
        ]);
        const dictionary = {};
        const lookup = {};
        // Custom first: their keys (Custom/Custom/x) never collide with photos
        for (const path of [...custom, ...photos]) {
            // Creator/Realm/Map parsing lives in map-match.js (single source).
            // Paths with < 3 segments are custom maps → bucketed under Custom.
            const parsed = parseMapPath(path);
            if (!parsed) continue;
            const {creator, realm, map} = parsed;
            if (!dictionary[creator]) dictionary[creator] = {};
            if (!dictionary[creator][realm]) dictionary[creator][realm] = [];
            dictionary[creator][realm].push(map);
            lookup[`${creator}/${realm}/${map}`] = path;
        }
        pathLookup = lookup;
        customPaths = new Set(custom);
        state.mapDictionary = dictionary;
        state.creators = Object.keys(dictionary);
        state.customMaps = custom;
        state.loadError = '';
    } catch (e) {
        debugLog('catalog::load::error', e.message);
        state.loadError = e.message;
    } finally {
        // Waiters (detector, hotkeys, lobby) must never hang on a failed read
        state.loaded = true;
        resolveLoaded();
    }
}

export const catalog = {
    state,

    load() {
        loadedPromise = load();
        return loadedPromise;
    },

    /** Resolves once the first load finished (map commands can arrive earlier). */
    whenLoaded() {
        return whenLoadedPromise;
    },

    /** Custom maps changed on disk: re-read the lists, drop cached custom images. */
    async reload() {
        state.customVersion++;
        // Custom files can be overwritten under the same name: never reuse their thumbnails
        for (const path of [...thumbs.keys()]) {
            if (customPaths.has(path)) dropThumbnail(path);
        }
        await this.load();
        await this.buildThumbnails();
    },

    /**
     * Makes the missing gallery thumbnails and drops those of files that are
     * gone. A map that cannot be decoded keeps no entry (thumbUrl falls back).
     * @param {(done: number, total: number) => void} [onProgress]
     */
    async buildThumbnails(onProgress) {
        const present = new Set(Object.values(pathLookup));
        for (const path of [...thumbs.keys()]) {
            if (!present.has(path)) dropThumbnail(path);
        }
        const queue = [...present].filter(path => !thumbs.has(path));
        const total = queue.length;
        let done = 0;
        const worker = async () => {
            while (queue.length) {
                const path = queue.shift();
                try {
                    const url = await makeThumbnail(path, this.typeOf(path));
                    if (url) thumbs.set(path, url);
                } catch (e) {
                    debugLog('catalog::thumbnail::error', path, e.message);
                }
                done++;
                if (onProgress) onProgress(done, total);
            }
        };
        await Promise.all(Array.from({length: THUMB_WORKERS}, worker));
    },

    /** Gallery image: the cached thumbnail, or the full file if there is none. */
    thumbUrl(path, type = this.typeOf(path)) {
        return thumbs.get(path) || this.imageUrl(path, type);
    },

    /** "custom" for files in the custom dir, "standard" for downloaded maps. */
    typeOf(path) {
        return customPaths.has(path) ? 'custom' : 'standard';
    },

    /** Local file for a `Creator/Realm/Map.png` key. */
    lookup(key) {
        return Object.prototype.hasOwnProperty.call(pathLookup, key) ? pathLookup[key] : null;
    },

    /** Full-size dbd-img:// URL served by main (src/core/user-data.js). */
    imageUrl(path, type = this.typeOf(path)) {
        const host = type === 'custom' ? 'custom' : 'photo';
        const encoded = normalizePhotoKey(path).split('/').map(encodeURIComponent).join('/');
        // Custom files can be overwritten under the same name
        const query = type === 'custom' ? `?v=${state.customVersion}` : '';
        return `dbd-img://${host}/${encoded}${query}`;
    },

    findClosestMapMatch(mapKey, creatorOverride, opts) {
        const preferred = creatorOverride !== undefined
            ? creatorOverride
            : (settings.get('preferredCreator') || '');
        return findClosestMapMatch(mapKey, pathLookup, preferred, opts);
    },

    /**
     * Maps a path received from elsewhere (lobby server) onto a local
     * downloaded map file. Separators are normalised so Windows and Linux
     * peers agree. Custom files are never matched.
     * @returns {string|null} local path, or null if unknown
     */
    resolveLocalMapPath(path) {
        if (typeof path !== 'string' || path === '') return null;
        const wanted = normalizePhotoKey(path);
        for (const local of Object.values(pathLookup)) {
            if (customPaths.has(local)) continue;
            if (normalizePhotoKey(local) === wanted) return local;
        }
        return null;
    },

    /**
     * Substring hits (legacy behaviour) come first, then fuzzy "did you mean"
     * results sorted by how close each map's name is to the query.
     * @returns {{creator: string, realm: string, name: string, path: string}[]}
     */
    search(name = '', creator = '') {
        const creatorLower = (creator || '').toLowerCase();
        const queryTokens = foldTokens(name);
        const fuzzy = queryTokens.length > 0;
        const foldedQuery = foldName(name);
        const matches = [];

        for (const [cr, realms] of Object.entries(state.mapDictionary)) {
            if (creator && !cr.toLowerCase().includes(creatorLower)) continue;
            for (const [rl, maps] of Object.entries(realms)) {
                for (const mapName of maps) {
                    const path = pathLookup[`${cr}/${rl}/${mapName}`];
                    if (!path) continue;
                    const direct = !fuzzy || foldName(`${mapName} ${rl}`).includes(foldedQuery);
                    let score = null;
                    if (!direct) {
                        const candidateTokens = [
                            ...foldTokens(parseMapPath(mapName)?.base || mapName),
                            ...foldTokens(rl),
                        ];
                        score = fuzzyTokenScore(queryTokens, candidateTokens);
                        if (score === null) continue;
                    }
                    matches.push({
                        item: {creator: cr, realm: rl, name: mapName, path},
                        // Substring hits rank above fuzzy ones (0); stable sort keeps
                        // their original insertion order among equal scores.
                        score: direct ? 0 : score,
                    });
                }
            }
        }
        if (!fuzzy) return matches.map(m => m.item);
        return matches.sort((a, b) => a.score - b.score).map(m => m.item);
    },
};
