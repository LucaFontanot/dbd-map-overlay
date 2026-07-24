const { test } = require('node:test');
const assert = require('node:assert/strict');
const { OcrMatcher } = require('../../src/core/map-detector/ocr-matcher');

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
