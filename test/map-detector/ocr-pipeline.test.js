const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { OcrMatcher } = require('../../src/core/map-detector/ocr-matcher');
const { missingModelsReason, createOcrService, loadFixture: load } = require('../helpers/ocr');

/**
 * End-to-end read of the map-name area: real OCR on a real capture, then the
 * matcher that turns the recognised lines into a Realm/Map key.
 *
 * These are the two captures that originally exposed the preprocessing bug of
 * the tesseract era: normalize()+threshold() turned the busy grass/foliage and
 * misty-swamp backgrounds into hundreds of noise fragments and zero real text.
 * The engine now reads the crop untouched — PaddleOCR's own pre-processing
 * (detection + resize) handles those backgrounds — so the fixtures still guard
 * against that class of regression, without the blur/threshold chain.
 *
 * Skips when the model files are not on this machine yet (see helpers/ocr.js).
 */
const SKIP = missingModelsReason();

let ocr;

before(async () => {
    if (SKIP) return;
    ocr = createOcrService();
});

after(async () => {
    await ocr?.dispose();
});

function buildMatcher(entries, realms) {
    const reverseI18n = new Map();
    const normalizedI18n = new Map();
    for (const [key, value] of entries) {
        reverseI18n.set(key.toLowerCase(), value);
        normalizedI18n.set(key.toLowerCase(), value);
    }
    return new OcrMatcher({ reverseI18n, normalizedI18n, realmKeys: new Set(realms) });
}

async function recognizeLines(pngBuffer) {
    const { items } = await ocr.recognize(pngBuffer);
    return items.map(i => i.text.trim()).filter(t => t.length > 3);
}

test('reads the map name off a real capture with a dense grass/foliage background', async (t) => {
    if (SKIP) return t.skip(SKIP);
    const matcher = buildMatcher(
        [["freddy fazbear's pizza", "Freddy Fazbear's Pizza"]],
        ['withered isle']
    );
    const lines = await recognizeLines(load('map-name-crop-freddy-fazbears-pizza.png'));
    const result = matcher.matchLines(lines);
    assert.equal(result?.map, "Freddy Fazbear's Pizza");
    // Realms come back as the realm key (lowercase) unless i18n translates them.
    assert.equal(result?.realm, 'withered isle');
});

test('reads the map name off a real capture with a misty swamp background', async (t) => {
    if (SKIP) return t.skip(SKIP);
    const matcher = buildMatcher(
        [['forgotten ruins', 'Forgotten Ruins']],
        ['the decimated borgo']
    );
    const lines = await recognizeLines(load('map-name-crop-forgotten-ruins.png'));
    const result = matcher.matchLines(lines);
    assert.equal(result?.map, 'Forgotten Ruins');
    assert.equal(result?.realm, 'the decimated borgo');
});

test('reads the map name off a full-resolution loading screen (no map name shown: nothing to match)', async (t) => {
    if (SKIP) return t.skip(SKIP);
    const matcher = buildMatcher([
        ['forgotten ruins', 'Forgotten Ruins'],
        ["freddy fazbear's pizza", "Freddy Fazbear's Pizza"],
    ], ['withered isle']);
    // 4K capture with only the loading tip in the map-name area: the tip lines
    // must not resolve to some unrelated map through the fuzzy fallbacks.
    const lines = await recognizeLines(load('loading-screen-70.png'));
    assert.equal(matcher.matchLines(lines), null);
});
