'use strict';

/**
 * Pure map-path matching used by the renderer to resolve OCR keys and
 * creator-layout swaps.
 *
 * Lookup keys look like `Creator/Realm/MapName.png`.
 * Detector keys look like `Realm/MapName`.
 *
 * Artist folders disagree on punctuation, accents, suffixes, leading "The",
 * parenthetical floor labels, and sometimes swap realm/map in the path
 * (`Wreckers' Yard` vs `Wreckers Yard - Istari`, `Macmillan Estate I`,
 * `Disturbed Ward/Crotus Prenn Asylum.jpg`).
 * After exact/substring hits, pick the closest canonical map name.
 */

function stripExtension(key) {
    return key.replace(/\.[^.]+$/, '');
}

function fileBaseName(key) {
    return stripExtension(String(key).replace(/\\/g, '/').split('/').pop());
}

/**
 * Split any on-disk/user-data path or `Creator/Realm/Map` key into its logical
 * parts. This is the single source of Creator/Realm/Map path parsing shared by
 * the renderer (images.js catalog build, hotkeys.js labels) and the main
 * process. Accepts leading-slash paths (`/Creator/Realm/Map.png`), bare keys
 * (`Creator/Realm/Map.png`), Windows backslashes, and flat custom maps
 * (`/My Map.png`), which have no creator/realm and get the `Custom` label so
 * they sort into their own gallery bucket.
 * @param {string} filePath
 * @returns {{creator: string, realm: string, map: string, base: string}|null}
 *   `map` keeps the file extension (`Coal Tower.png`); `base` strips it.
 */
function parseMapPath(filePath) {
    const parts = String(filePath || '').replace(/\\/g, '/').split('/').filter(Boolean);
    if (!parts.length) return null;
    const map = parts[parts.length - 1];
    const base = stripExtension(map);
    if (parts.length >= 3) {
        return {creator: parts[0], realm: parts[parts.length - 2], map, base};
    }
    return {creator: 'Custom', realm: 'Custom', map, base};
}

function foldName(s) {
    return String(s || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[''`´’]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * `Coal Tower 1 - Istari` / `The Pale Rose` / `The Game (2)` /
 * `Wreckers' Yard` → `coal tower` / `pale rose` / `game` / `wreckers yard`.
 */
function canonicalMapName(fileBase) {
    let name = String(fileBase || '').trim();
    const dash = name.search(/\s+-\s+/);
    if (dash !== -1) name = name.slice(0, dash).trim();
    name = name.replace(/\([^)]*\)/g, ' ');
    name = foldName(name);
    name = name.replace(/\b(eu|na|\d+)\b/g, ' ').replace(/\s+/g, ' ').trim();
    name = name.replace(/^the /, '');
    return name;
}

function splitRealmMap(mapKey) {
    const parts = stripExtension(String(mapKey || '').replace(/\\/g, '/'))
        .split('/')
        .filter(Boolean);
    if (parts.length >= 3) {
        return {realm: parts[parts.length - 2], map: parts[parts.length - 1]};
    }
    if (parts.length === 2) return {realm: parts[0], map: parts[1]};
    return {realm: '', map: parts[0] || ''};
}

function destRealmName(key) {
    const parts = String(key).replace(/\\/g, '/').split('/').filter(Boolean);
    return parts.length >= 3 ? parts[parts.length - 2] : '';
}

function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({length: m + 1}, (_, i) => {
        const row = new Array(n + 1);
        row[0] = i;
        return row;
    });
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
    }
    return dp[m][n];
}

function firstTokenOk(a, b) {
    const ta = a.split(' ')[0] || '';
    const tb = b.split(' ')[0] || '';
    if (!ta || !tb) return false;
    if (ta === tb || ta.startsWith(tb) || tb.startsWith(ta)) return true;
    return Math.min(ta.length, tb.length) >= 6 && levenshtein(ta, tb) <= 2;
}

/** `raccoon city east` is a subsequence of `raccoon city police station east wing`. */
function tokensInOrder(shorter, longer) {
    const a = shorter.split(' ').filter(Boolean);
    const b = longer.split(' ').filter(Boolean);
    if (a.length < 2) return false;
    let i = 0;
    for (const token of b) {
        if (token === a[i]) i++;
        if (i === a.length) return true;
    }
    return false;
}

function sharedPrefixTokens(a, b) {
    const ta = a.split(' ').filter(Boolean);
    const tb = b.split(' ').filter(Boolean);
    let n = 0;
    while (n < ta.length && n < tb.length && ta[n] === tb[n]) n++;
    return n;
}

function cleanliness(fileBase) {
    let n = String(fileBase || '').length / 1000;
    if (/\([^)]*\)/.test(fileBase)) n += 2;
    if (/\d/.test(fileBase)) n += 1;
    if (/\b(EU|NA)\b/i.test(fileBase)) n += 1;
    if (/\s-\s/.test(fileBase)) n += 0.5;
    return n;
}

/**
 * Score how close a file's map name is to the detected name. Lower is better.
 * null = too far (do not use).
 */
function nameScore(candidateBase, targetBase) {
    const cand = canonicalMapName(candidateBase);
    const target = canonicalMapName(targetBase);
    if (!cand || !target) return null;
    if (cand === target) return 0;
    if (cand.startsWith(target) || target.startsWith(cand)) return 1;
    if (cand.includes(target) || target.includes(cand)) {
        const shorter = cand.length <= target.length ? cand : target;
        const tokens = shorter.split(' ').filter(Boolean);
        // "game" must not substring-match an unrelated longer name
        if (tokens.length >= 2 || shorter.length >= 8) return 2;
    }
    if (tokensInOrder(cand, target) || tokensInOrder(target, cand)) return 2;
    if (sharedPrefixTokens(cand, target) >= 2) return 4;
    if (!firstTokenOk(cand, target)) return null;
    const dist = levenshtein(cand, target);
    const maxLen = Math.max(cand.length, target.length);
    if (dist > Math.max(2, Math.floor(maxLen * 0.25))) return null;
    return 3 + dist;
}

function pickBestKey(keys, pathLookup, targetName) {
    let bestKey = null;
    let bestScore = Infinity;
    let bestClean = Infinity;
    for (const key of keys) {
        const base = fileBaseName(key);
        const score = nameScore(base, targetName);
        if (score === null) continue;
        const clean = cleanliness(base);
        if (score < bestScore || (score === bestScore && clean < bestClean)) {
            bestScore = score;
            bestClean = clean;
            bestKey = key;
        }
    }
    return bestKey ? pathLookup[bestKey] : null;
}

function closestByMapName(keys, pathLookup, mapName) {
    return pickBestKey(keys, pathLookup, mapName);
}

/**
 * Some artists swap realm/map in the path, or ship a single file named after
 * the realm (`Gideon Meat Plant.gif` for The Game).
 */
function matchByRealmSwapOrUnique(keys, pathLookup, sourceRealm, sourceMap) {
    const srcRealm = canonicalMapName(sourceRealm);
    const srcMap = canonicalMapName(sourceMap);
    if (!srcMap) return null;

    const swapped = [];
    const sameRealm = [];
    for (const key of keys) {
        const destRealm = canonicalMapName(destRealmName(key));
        const destMap = canonicalMapName(fileBaseName(key));
        if (srcRealm && destRealm === srcRealm) sameRealm.push(key);
        if (destRealm === srcMap) swapped.push(key);
        else if (srcRealm && destMap === srcRealm && destRealm !== srcRealm) swapped.push(key);
    }

    if (swapped.length === 1) return pathLookup[swapped[0]];
    if (swapped.length > 1) {
        const namedForRealm = swapped.filter(k => canonicalMapName(fileBaseName(k)) === srcRealm);
        if (namedForRealm.length) return pickBestKey(namedForRealm, pathLookup, sourceRealm);
        const namedForMap = pickBestKey(swapped, pathLookup, sourceMap);
        if (namedForMap) return namedForMap;
    }

    // File named after the realm folder: Disturbed Ward/Disturbed Ward.png
    // when the source file used the realm as the map name (Crotus Prenn Asylum.jpg).
    const namedAfterRealm = sameRealm.filter(k => canonicalMapName(fileBaseName(k)) === srcRealm);
    if (namedAfterRealm.length === 1) return pathLookup[namedAfterRealm[0]];

    // Unique file in that realm only if it is named after the realm or the map
    // (Gideon Meat Plant.gif for The Game). Never pick a sibling map.
    if (sameRealm.length === 1) {
        const only = sameRealm[0];
        const destMap = canonicalMapName(fileBaseName(only));
        if (destMap === srcRealm || destMap === srcMap) return pathLookup[only];
        if (nameScore(fileBaseName(only), sourceMap) !== null) return pathLookup[only];
        if (srcRealm && nameScore(fileBaseName(only), sourceRealm) !== null) return pathLookup[only];
    }
    if (sameRealm.length > 1) {
        const canons = new Set(sameRealm.map(k => canonicalMapName(fileBaseName(k))));
        if (canons.size === 1) {
            return pickBestKey(sameRealm, pathLookup, sourceMap)
                || pathLookup[sameRealm.slice().sort((a, b) =>
                    cleanliness(fileBaseName(a)) - cleanliness(fileBaseName(b)))[0]];
        }
    }
    return null;
}

/**
 * Creator/Realm/Map.png → Realm/Map  (no extension).
 * Custom one-segment files have no realm and return null.
 */
function logicalMapKeyFromPath(filePath) {
    if (!filePath) return null;
    const parts = String(filePath).replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length < 3) return null;
    const mapName = stripExtension(parts[parts.length - 1]);
    const realm = parts[parts.length - 2];
    if (!mapName || !realm) return null;
    return `${realm}/${mapName}`;
}

/**
 * @param {string} mapKey OCR key (`Realm/Map`) or a full `Creator/Realm/Map` path
 * @param {Object<string, string>} pathLookup dictionary key → file path
 * @param {string} [preferredCreator]
 * @param {{fallback?: boolean}} [opts] fallback (default true) searches all
 *   creators when the preferred one has no match. Pass false when the user
 *   just picked a creator so we never swap in a different artist's layout.
 * @returns {string|null} file path from pathLookup
 */
function findClosestMapMatch(mapKey, pathLookup, preferredCreator, opts = {}) {
    if (!mapKey || !pathLookup) return null;
    const fallback = opts.fallback !== false;
    const normalizedKey = String(mapKey).replace(/\\/g, '/').trim().toLowerCase();
    const preferred = (preferredCreator || '').trim().toLowerCase();
    const allKeys = Object.keys(pathLookup);
    const {realm, map: mapName} = splitRealmMap(normalizedKey);

    const exactMatch = key => foldName(stripExtension(key)) === foldName(normalizedKey);
    const partialMatch = key => foldName(key).includes(foldName(normalizedKey));

    const search = (keys) => {
        const exact = keys.find(exactMatch);
        if (exact) return pathLookup[exact];
        const partial = keys.find(partialMatch);
        if (partial) return pathLookup[partial];
        const byName = closestByMapName(keys, pathLookup, mapName);
        if (byName) return byName;
        return matchByRealmSwapOrUnique(keys, pathLookup, realm, mapName);
    };

    if (preferred) {
        const inPreferred = allKeys.filter(k => k.toLowerCase().startsWith(preferred + '/'));
        const hit = search(inPreferred);
        if (hit) return hit;
        if (!fallback) return null;
    }

    return search(allKeys);
}

module.exports = {
    foldName,
    levenshtein,
    parseMapPath,
    logicalMapKeyFromPath,
    findClosestMapMatch,
};
