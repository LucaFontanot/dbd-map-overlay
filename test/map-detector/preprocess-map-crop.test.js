const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWorker } = require('tesseract.js');
const { preprocessMapCrop } = require('../../src/core/map-detector/preprocess-map-crop');
const { OcrMatcher } = require('../../src/core/map-detector/ocr-matcher');

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'map-detector');
const load = name => fs.readFileSync(path.join(FIXTURES, name));

let worker;

before(async () => {
    worker = await createWorker('eng', 1);
});

after(async () => {
    await worker.terminate();
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
    const meta = await require('sharp')(pngBuffer).metadata();
    const preprocessed = await preprocessMapCrop(pngBuffer, meta.width, meta.height);
    const { data } = await worker.recognize(preprocessed, { tessedit_pageseg_mode: '11' });
    return (data.text || '').split('\n').map(t => t.trim()).filter(t => t.length > 3);
}

// Regression coverage for a real bug: the original preprocessing (normalize() +
// threshold(128)) produced pure noise -- hundreds of spurious "text" fragments and
// zero real characters -- against busy map-reveal backgrounds (grass/foliage, misty
// swamp). Both fixtures below are real captures that reproduced that failure.

test('reads the map name off a real capture with a dense grass/foliage background (previously produced 358 noise lines, 0 real text)', async () => {
    const matcher = buildMatcher(
        [["freddy fazbear's pizza", "Freddy Fazbear's Pizza"]],
        ['withered isle']
    );
    const lines = await recognizeLines(load('map-name-crop-freddy-fazbears-pizza.png'));
    const result = matcher.matchLines(lines);
    assert.equal(result?.map, "Freddy Fazbear's Pizza");
});

test('reads the map name off a real capture with a misty swamp background (previously produced pure noise, 0 real text)', async () => {
    const matcher = buildMatcher(
        [['forgotten ruins', 'Forgotten Ruins']],
        ['the decimated borgo']
    );
    const lines = await recognizeLines(load('map-name-crop-forgotten-ruins.png'));
    const result = matcher.matchLines(lines);
    assert.equal(result?.map, 'Forgotten Ruins');
});
