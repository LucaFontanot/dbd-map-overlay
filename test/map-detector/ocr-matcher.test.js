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
