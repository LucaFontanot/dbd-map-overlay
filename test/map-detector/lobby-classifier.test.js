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

// Regression: a fuller loadout block above the roster pushes the names down to
// ~39% of screen height, past the old 32% ROI cutoff.
test('recognizes a custom lobby with a low-sitting roster (killer view) as custom', async () => {
    assert.ok(await classifier.isCustomLobby(load('lobby-custom-killer-2.png')));
});

test('recognizes a custom lobby with a low-sitting roster (survivor view) as custom', async () => {
    assert.ok(await classifier.isCustomLobby(load('lobby-custom-survivor.png')));
});

// Regression: the smallest startable custom (killer host + one survivor) only
// has two roster rows, so any count threshold above that misses real customs.
test('recognizes a minimal custom lobby (host + one bot) as custom', async () => {
    assert.ok(await classifier.isCustomLobby(load('lobby-custom-one-player.png')));
});

test('does not classify a public matchmaking lobby (no roster shown) as custom', async () => {
    assert.ok(!(await classifier.isCustomLobby(load('lobby-public.png'))));
});
