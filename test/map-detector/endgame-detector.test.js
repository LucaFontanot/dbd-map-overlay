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
