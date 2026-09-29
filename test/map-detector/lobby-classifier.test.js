const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { LobbyClassifier } = require('../../src/core/map-detector/lobby-classifier');
const { missingModelsReason, createOcrService, loadFixture: load } = require('../helpers/ocr');

// Real OCR: these fixtures are read by the production engine (PaddleOCR), so the
// suite skips when the model files are not on this machine yet.
const SKIP = missingModelsReason();

let classifier, ocr;

before(async () => {
    if (SKIP) return;
    ocr = createOcrService();
    classifier = new LobbyClassifier(ocr);
});

after(async () => {
    await ocr?.dispose();
});

test('recognizes a custom lobby (visible player/bot name roster, top-right) as custom', async (t) => {
    if (SKIP) return t.skip(SKIP);
    assert.ok(await classifier.isCustomLobby(load('lobby-custom.png')));
});

// Regression: a fuller loadout block above the roster pushes the names down to
// ~39% of screen height, past the old 32% ROI cutoff.
test('recognizes a custom lobby with a low-sitting roster (killer view) as custom', async (t) => {
    if (SKIP) return t.skip(SKIP);
    assert.ok(await classifier.isCustomLobby(load('lobby-custom-killer-2.png')));
});

test('recognizes a custom lobby with a low-sitting roster (survivor view) as custom', async (t) => {
    if (SKIP) return t.skip(SKIP);
    assert.ok(await classifier.isCustomLobby(load('lobby-custom-survivor.png')));
});

// Regression: the smallest startable custom (killer host + one survivor) only
// has two roster rows, so any count threshold above that misses real customs.
test('recognizes a minimal custom lobby (host + one bot) as custom', async (t) => {
    if (SKIP) return t.skip(SKIP);
    assert.ok(await classifier.isCustomLobby(load('lobby-custom-one-player.png')));
});

test('does not classify a public matchmaking lobby (no roster shown) as custom', async (t) => {
    if (SKIP) return t.skip(SKIP);
    assert.ok(!(await classifier.isCustomLobby(load('lobby-public.png'))));
});

// Regression for the PaddleOCR migration: this engine reads the HUD/perk labels
// that sit in the same corner during a match ("DISTRACTION", "ASSIST", the
// replay toast) far more eagerly than tesseract did, so they must be filtered
// out by shape and not counted as roster rows.
test('does not classify an in-match frame with HUD labels and a replay toast as custom', async (t) => {
    if (SKIP) return t.skip(SKIP);
    assert.ok(!(await classifier.isCustomLobby(load('gameplay-public-2.png'))));
    assert.ok(!(await classifier.isCustomLobby(load('gameplay-100.png'))));
});

test('does not classify the endgame scoreboard (shows "You" and a currency row) as custom', async (t) => {
    if (SKIP) return t.skip(SKIP);
    assert.ok(!(await classifier.isCustomLobby(load('endgame-public-scoreboard.png'))));
    assert.ok(!(await classifier.isCustomLobby(load('endgame-custom-scoreboard.png'))));
});

test('does not classify the in-match menu ("TAB" / "MATCH DETAILS") as custom', async (t) => {
    if (SKIP) return t.skip(SKIP);
    assert.ok(!(await classifier.isCustomLobby(load('menu-open.png'))));
});
