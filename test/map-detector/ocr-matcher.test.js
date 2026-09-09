const { test } = require('node:test');
const assert = require('node:assert/strict');
const { OcrMatcher } = require('../../src/core/map-detector/ocr-matcher');
const { FALLBACK_REALMS } = require('../../src/core/map-detector/fallback-realms');

// Mirrors MapDetector._loadI18n's table construction, minus the electron deps,
// so tests can catch data bugs in the shipped name lists rather than only
// exercising synthetic tables.
function buildProductionMatcher() {
    const en = require('../../src/i18n/en.json');
    const reverseI18n = new Map();
    const normalizedI18n = new Map();
    for (const [englishKey, localizedValue] of Object.entries(en)) {
        reverseI18n.set(localizedValue.toLowerCase().trim(), englishKey);
        reverseI18n.set(englishKey.toLowerCase().trim(), englishKey);
        const norm = englishKey.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
        if (norm.length > 2 && !normalizedI18n.has(norm)) normalizedI18n.set(norm, englishKey);
    }
    return new OcrMatcher({ reverseI18n, normalizedI18n, realmKeys: FALLBACK_REALMS });
}

function buildMatcher() {
    const reverseI18n = new Map([
        ['blood lodge', 'Blood Lodge'],
        ['autohaven wreckers', 'Autohaven Wreckers'],
        ['the macmillan estate', 'The MacMillan Estate'],
        ['coal tower', 'Coal Tower'],
    ]);
    const normalizedI18n = new Map([
        ['blood lodge', 'Blood Lodge'],
        ['autohaven wreckers', 'Autohaven Wreckers'],
        ['the macmillan estate', 'The MacMillan Estate'],
        ['coal tower', 'Coal Tower'],
    ]);
    const realmKeys = new Set(['autohaven wreckers', 'the macmillan estate']);
    return new OcrMatcher({ reverseI18n, normalizedI18n, realmKeys });
}

test('map line first, realm line second -> resolves to the map, captures the realm', () => {
    const matcher = buildMatcher();
    const result = matcher.matchLines(['Blood Lodge', 'Autohaven Wreckers']);
    assert.deepEqual(result, { realm: 'Autohaven Wreckers', map: 'Blood Lodge' });
});

test('realm line first, map line second -> still resolves to the map, not the realm (regression for the confirmed bug)', () => {
    const matcher = buildMatcher();
    const result = matcher.matchLines(['Autohaven Wreckers', 'Blood Lodge']);
    assert.deepEqual(result, { realm: 'Autohaven Wreckers', map: 'Blood Lodge' });
});

test('only the realm line is readable -> returns null, never reports the realm as the map', () => {
    const matcher = buildMatcher();
    const result = matcher.matchLines(['Autohaven Wreckers', 'garbled unreadable ocr junk']);
    assert.equal(result, null);
});

test('no lines match anything -> returns null', () => {
    const matcher = buildMatcher();
    const result = matcher.matchLines(['totally unrelated text', 'more noise']);
    assert.equal(result, null);
});

test('map name split across two lines by OCR is reconstructed (Pass 2)', () => {
    const matcher = buildMatcher();
    const result = matcher.matchLines(['Coal', 'Tower']);
    assert.deepEqual(result, { realm: null, map: 'Coal Tower' });
});

test('Disturbed Ward resolves as the map, Crotus Prenn Asylum as its realm (regression: map name misplaced into FALLBACK_REALMS)', () => {
    const matcher = buildProductionMatcher();
    assert.deepEqual(
        matcher.matchLines(['CROTUS PRENN ASYLUM', 'DISTURBED WARD']),
        { realm: 'Crotus Prenn Asylum', map: 'Disturbed Ward' }
    );
    // Loading screens sometimes only yield the map line to OCR; that alone must confirm.
    assert.deepEqual(
        matcher.matchLines(['DISTURBED WARD']),
        { realm: null, map: 'Disturbed Ward' }
    );
});

// Mirrors MapDetector._loadRealmKeys: FALLBACK_REALMS augmented with each
// creator's realm folders, minus folder names that collide with a shipped map
// name (KaiserAleex/SamoelColt store Crotus Prenn Asylum maps under a folder
// literally named "Disturbed Ward").
const fs = require('node:fs');
const path = require('node:path');
const { computeMapNameFolds, isRealRealmFolder } = require('../../src/core/map-detector/realm-catalog');

function buildAugmentedMatcher(creatorNames) {
    const en2 = require('../../src/i18n/en.json');
    const reverseI18n = new Map();
    const normalizedI18n = new Map();
    for (const [englishKey, localizedValue] of Object.entries(en2)) {
        reverseI18n.set(localizedValue.toLowerCase().trim(), englishKey);
        reverseI18n.set(englishKey.toLowerCase().trim(), englishKey);
        const norm = englishKey.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
        if (norm.length > 2 && !normalizedI18n.has(norm)) normalizedI18n.set(norm, englishKey);
    }
    const realmKeys = new Set(FALLBACK_REALMS);
    const mapNameFolds = computeMapNameFolds(Object.keys(en2), FALLBACK_REALMS);
    const root = path.join(__dirname, '..', '..', 'maps');
    for (const creator of creatorNames) {
        const cdir = path.join(root, creator);
        if (!fs.existsSync(cdir)) continue;
        for (const rl of fs.readdirSync(cdir)) {
            if (!fs.statSync(path.join(cdir, rl)).isDirectory()) continue;
            if (isRealRealmFolder(rl, mapNameFolds)) realmKeys.add(rl.toLowerCase());
        }
    }
    return new OcrMatcher({ reverseI18n, normalizedI18n, realmKeys });
}

test('folder-augmented realmKeys never misclassify map "Disturbed Ward" as a realm (regression: creator folder pollution)', () => {
    // KaiserAleex ships a "Disturbed Ward" folder -> without the guard this
    // puts the map name into realmKeys and the loading screen never resolves.
    const matcher = buildAugmentedMatcher(['Hens333', 'KaiserAleex']);
    assert.deepEqual(
        matcher.matchLines(['CROTUS PRENN ASYLUM', 'DISTURBED WARD']),
        { realm: 'Crotus Prenn Asylum', map: 'Disturbed Ward' }
    );
    assert.deepEqual(
        matcher.matchLines(['DISTURBED WARD']),
        { realm: null, map: 'Disturbed Ward' }
    );
});

test('Sleepless District is a realm, not a map, in a folder-augmented install (regression: real realm absent from FALLBACK_REALMS)', () => {
    const matcher = buildAugmentedMatcher(['KaiserAleex', 'SamoelColt', 'Hens333']);
    // Loading screen for Trickster's Delusion (realm Sleepless District):
    // the realm line must be captured, not swallowed as a map name.
    assert.deepEqual(
        matcher.matchLines(['SLEEPLESS DISTRICT', "TRICKSTER'S DELUSION"]),
        { realm: 'Sleepless District', map: "Trickster's Delusion" }
    );
});
