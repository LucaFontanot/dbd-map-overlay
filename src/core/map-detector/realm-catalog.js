'use strict';

/**
 * Pure helpers that decide which folder names found under a creator's photo
 * directory are genuine REALM names and which are really map names being
 * (mis)used as the realm folder.
 *
 * Some creators label a realm by its best-known map: KaiserAleex and
 * SamoelColt put the Crotus Prenn Asylum maps under a folder literally named
 * `Disturbed Ward` — but Disturbed Ward is a MAP, not a realm. Feeding that
 * folder name into realmKeys makes OcrMatcher classify the loading-screen
 * line "Disturbed Ward" as a realm, so the map is never reported.
 *
 * Rule: a folder name is a genuine realm unless it also names a map in the
 * shipped i18n set. Genuine realms are excluded from that map-name set via
 * FALLBACK_REALMS (the maintained authority), which is why DLC realms must be
 * added there (see fallback-realms.js) to keep them discoverable from folders.
 */

// Name folding is defined once in map-match.js (the single source of map-name
// canonicalisation) and reused here; re-exported so callers/tests keep one import.
const { foldName } = require('../map-match');

/**
 * Folds of every i18n key that is a MAP (not a known realm). Used to reject
 * map names that some creators reuse as realm folder names.
 * @param {Iterable<string>} englishKeys  all English i18n keys (realms + maps)
 * @param {Iterable<string>} realmKeys     authoritative real-realm names (FALLBACK_REALMS)
 * @returns {Set<string>} folded map-name set
 */
function computeMapNameFolds(englishKeys, realmKeys) {
    const realmFolds = new Set();
    for (const r of realmKeys) realmFolds.add(foldName(r));
    const mapFolds = new Set();
    for (const k of englishKeys) {
        const f = foldName(k);
        if (!realmFolds.has(f)) mapFolds.add(f);
    }
    return mapFolds;
}

/**
 * True when a creator-folder name should count as a realm, i.e. it does not
 * collide with a shipped map name.
 * @param {string} folderName
 * @param {Set<string>} mapNameFolds from computeMapNameFolds
 */
function isRealRealmFolder(folderName, mapNameFolds) {
    return !mapNameFolds.has(foldName(folderName));
}

module.exports = {foldName, computeMapNameFolds, isRealRealmFolder};
