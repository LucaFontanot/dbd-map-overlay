const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWorker } = require('tesseract.js');
const { EndgameDetector } = require('../../src/core/map-detector/endgame-detector');

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'map-detector');
const load = name => fs.readFileSync(path.join(FIXTURES, name));

let worker, detector;

before(async () => {
    worker = await createWorker('eng', 1);
    detector = new EndgameDetector(worker);
});

after(async () => {
    await worker.terminate();
});

test('recognizes the public-match scoreboard screen as an endgame screen', async () => {
    assert.ok(await detector.isEndgameScreen(load('endgame-public-scoreboard.png')));
});

test('recognizes the public-match bloodpoints screen as an endgame screen', async () => {
    assert.ok(await detector.isEndgameScreen(load('endgame-public-bloodpoints.png')));
});

test('recognizes the custom-match scoreboard screen as an endgame screen (no "MATCH" prefix, different position/scale)', async () => {
    assert.ok(await detector.isEndgameScreen(load('endgame-custom-scoreboard.png')));
});

test('recognizes the public-match grade screen as an endgame screen', async () => {
    assert.ok(await detector.isEndgameScreen(load('endgame-public-grade.png')));
});

test('recognizes the public-match level screen as an endgame screen', async () => {
    assert.ok(await detector.isEndgameScreen(load('endgame-public-level.png')));
});

test('does not flag the lobby as an endgame screen', async () => {
    assert.ok(!(await detector.isEndgameScreen(load('lobby-public.png'))));
});

test('does not flag gameplay as an endgame screen', async () => {
    assert.ok(!(await detector.isEndgameScreen(load('gameplay-100.png'))));
    assert.ok(!(await detector.isEndgameScreen(load('gameplay-public-2.png'))));
});

test('does not flag the offering screen as an endgame screen', async () => {
    assert.ok(!(await detector.isEndgameScreen(load('offering-screen.png'))));
});

test('does not flag a loading screen as an endgame screen', async () => {
    assert.ok(!(await detector.isEndgameScreen(load('loading-screen-100.png'))));
    assert.ok(!(await detector.isEndgameScreen(load('loading-screen-70.png'))));
});

test('does not flag the custom lobby as an endgame screen', async () => {
    assert.ok(!(await detector.isEndgameScreen(load('lobby-custom.png'))));
});

test('does not flag the in-match menu as an endgame screen', async () => {
    assert.ok(!(await detector.isEndgameScreen(load('menu-open.png'))));
});

test('detects the endgame screen quickly (small bounded ROI, not a full-frame OCR pass)', async () => {
    const t0 = Date.now();
    await detector.isEndgameScreen(load('endgame-public-scoreboard.png'));
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 400, `expected a fast small-ROI OCR pass (<400ms), took ${elapsed}ms`);
});
