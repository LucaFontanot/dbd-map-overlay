const { test } = require('node:test');
const assert = require('node:assert/strict');
const { foldName, computeMapNameFolds, isRealRealmFolder } = require('../../src/core/map-detector/realm-catalog');
const { FALLBACK_REALMS } = require('../../src/core/map-detector/fallback-realms');

const en = require('../../src/i18n/en.json');
const englishKeys = Object.keys(en);

test('foldName strips accents/apostrophes, keeps leading The', () => {
    assert.equal(foldName("Léry's Memorial Institute"), 'lerys memorial institute');
    assert.equal(foldName('The Decimated Borgo'), 'the decimated borgo');
    assert.equal(foldName('Disturbed Ward'), 'disturbed ward');
});

test('map-name set contains Disturbed Ward but no genuine realm', () => {
    const mapFolds = computeMapNameFolds(englishKeys, FALLBACK_REALMS);
    assert.equal(mapFolds.has(foldName('Disturbed Ward')), true, 'Disturbed Ward is a map');
    assert.equal(mapFolds.has(foldName('The MacMillan Estate')), false, 'MacMillan Estate is a realm');
    assert.equal(mapFolds.has(foldName('Crotus Prenn Asylum')), false, 'Crotus Prenn Asylum is a realm');
    assert.equal(mapFolds.has(foldName('Sleepless District')), false, 'Sleepless District is a realm (regression: was missing from FALLBACK_REALMS)');
    assert.equal(mapFolds.has(foldName('Gideon Meat Plant')), false, 'Gideon Meat Plant is a realm');
});

test('isRealRealmFolder rejects map names used as folders, accepts genuine realms', () => {
    const mapFolds = computeMapNameFolds(englishKeys, FALLBACK_REALMS);
    // KaiserAleex/SamoelColt mislabel the Crotus Prenn Asylum realm as "Disturbed Ward".
    assert.equal(isRealRealmFolder('Disturbed Ward', mapFolds), false, 'folder named after a map must not become a realm');
    assert.equal(isRealRealmFolder('disturbed ward', mapFolds), false, 'case-insensitive');
    assert.equal(isRealRealmFolder('Crotus Prenn Asylum', mapFolds), true);
    assert.equal(isRealRealmFolder('Sleepless District', mapFolds), true);
    assert.equal(isRealRealmFolder('Haddonfield', mapFolds), true);
});
