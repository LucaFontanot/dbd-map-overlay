const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWorker } = require('tesseract.js');
const { LobbyClassifier } = require('../../src/core/map-detector/lobby-classifier');

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'map-detector');
const load = name => fs.readFileSync(path.join(FIXTURES, name));

let worker, classifier;

before(async () => {
    worker = await createWorker('eng', 1);
    classifier = new LobbyClassifier(worker);
});

after(async () => {
    await worker.terminate();
});

test('recognizes a custom lobby (visible player/bot name roster, top-right) as custom', async () => {
    assert.ok(await classifier.isCustomLobby(load('lobby-custom.png')));
});

test('does not classify a public matchmaking lobby (no roster shown) as custom', async () => {
    assert.ok(!(await classifier.isCustomLobby(load('lobby-public.png'))));
});
