const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    computeFrameStats,
    isNearBlackFrame,
    hasFilledProgressBar,
} = require('../../src/core/map-detector/screen-state');

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'map-detector');
const load = name => fs.readFileSync(path.join(FIXTURES, name));

test('near-black gate: real in-match loading screen is near-black at both UI scales', async () => {
    for (const name of ['loading-screen-100.png', 'loading-screen-70.png']) {
        const stats = await computeFrameStats(load(name));
        assert.ok(isNearBlackFrame(stats), `${name} should read as near-black (got mean=${stats.mean}, darkFrac=${stats.darkFrac})`);
    }
});

test('near-black gate: game boot splash is ALSO near-black (this is the known ambiguity the bar-scan resolves)', async () => {
    const stats = await computeFrameStats(load('boot-splash.png'));
    assert.ok(isNearBlackFrame(stats), 'boot splash should also read as near-black by brightness alone');
});

test('near-black gate: normal gameplay/menu/lobby screens are not near-black', async () => {
    for (const name of ['lobby-public.png', 'gameplay-100.png', 'menu-open.png', 'offering-screen.png', 'endgame-public-scoreboard.png']) {
        const stats = await computeFrameStats(load(name));
        assert.ok(!isNearBlackFrame(stats), `${name} should NOT read as near-black (got mean=${stats.mean}, darkFrac=${stats.darkFrac})`);
    }
});

test('progress-bar scan: finds the bar on the real loading screen at 100% UI scale', async () => {
    assert.ok(await hasFilledProgressBar(load('loading-screen-100.png')));
});

test('progress-bar scan: finds the bar on the real loading screen at 70% UI scale (bar sits at a different y position than 100% scale)', async () => {
    assert.ok(await hasFilledProgressBar(load('loading-screen-70.png')));
});

test('progress-bar scan: does NOT find a bar on the boot splash (disambiguates it from the real loading screen)', async () => {
    assert.ok(!(await hasFilledProgressBar(load('boot-splash.png'))));
});
