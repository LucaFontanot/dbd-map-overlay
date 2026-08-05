const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
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

// Real endgame screens must not just be seen but read confidently -- a confident
// read is what lets the state machine clear the overlay on a single pass.
async function assertEndgame(fixture) {
    const result = await detector.detectEndgame(load(fixture));
    assert.ok(result.seen, `${fixture}: expected the endgame keyword to be seen`);
    assert.ok(result.confident, `${fixture}: expected a confident read of the CONTINUE button`);
}

async function assertNotEndgame(fixture) {
    const result = await detector.detectEndgame(load(fixture));
    assert.ok(!result.seen, `${fixture}: must not read as an endgame screen`);
}

test('recognizes the public-match scoreboard screen as an endgame screen', async () => {
    await assertEndgame('endgame-public-scoreboard.png');
});

test('recognizes the public-match bloodpoints screen as an endgame screen', async () => {
    await assertEndgame('endgame-public-bloodpoints.png');
});

test('recognizes the custom-match scoreboard screen as an endgame screen (no "MATCH" prefix, different position/scale)', async () => {
    await assertEndgame('endgame-custom-scoreboard.png');
});

test('recognizes the public-match grade screen as an endgame screen', async () => {
    await assertEndgame('endgame-public-grade.png');
});

test('recognizes the public-match level screen as an endgame screen', async () => {
    await assertEndgame('endgame-public-level.png');
});

test('does not flag the lobby as an endgame screen', async () => {
    await assertNotEndgame('lobby-public.png');
});

test('does not flag gameplay as an endgame screen', async () => {
    await assertNotEndgame('gameplay-100.png');
    await assertNotEndgame('gameplay-public-2.png');
});

test('does not flag the offering screen as an endgame screen', async () => {
    await assertNotEndgame('offering-screen.png');
});

test('does not flag a loading screen as an endgame screen', async () => {
    await assertNotEndgame('loading-screen-100.png');
    await assertNotEndgame('loading-screen-70.png');
});

test('does not flag the custom lobby as an endgame screen', async () => {
    await assertNotEndgame('lobby-custom.png');
});

test('does not flag the in-match menu as an endgame screen', async () => {
    await assertNotEndgame('menu-open.png');
});

// Synthesized frame with arbitrary text in the CONTINUE-button corner, so the
// keyword matching can be pinned down exactly (no real screenshot has "CONTINUED").
function frameWithCornerText(word) {
    const svg = `<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
        <rect width="1920" height="1080" fill="#111111"/>
        <text x="1700" y="1050" font-size="36" fill="#ffffff" font-family="sans-serif" text-anchor="middle">${word}</text>
    </svg>`;
    return sharp(Buffer.from(svg)).png().toBuffer();
}

test('matches the keyword as a whole word only, not as a substring of another word', async () => {
    assert.ok((await detector.detectEndgame(await frameWithCornerText('CONTINUE'))).seen,
        'sanity check: the synthesized CONTINUE frame must be detected');
    assert.ok(!(await detector.detectEndgame(await frameWithCornerText('CONTINUED'))).seen,
        '"CONTINUED" must not count as an endgame screen');
});

test('detects the endgame screen quickly (small bounded ROI, not a full-frame OCR pass)', async () => {
    const t0 = Date.now();
    await detector.detectEndgame(load('endgame-public-scoreboard.png'));
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 400, `expected a fast small-ROI OCR pass (<400ms), took ${elapsed}ms`);
});
