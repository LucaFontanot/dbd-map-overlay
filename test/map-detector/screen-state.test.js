const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { hasFilledProgressBar } = require('../../src/core/map-detector/screen-state');

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'map-detector');
const load = name => fs.readFileSync(path.join(FIXTURES, name));

/**
 * A solid background with an optional bright horizontal bar in the bottom
 * quarter, sized as a fraction of the scan region's width. Used to test that
 * bar detection is color-agnostic (event loading screens reskin the whole
 * palette, not just recolor the bar) without committing real, copyrighted
 * screenshots to the repo.
 */
async function syntheticFrame({ width = 1920, height = 1080, background, barWidthFrac = null, barYFrac = 0.9, barHeightFrac = 0.01 }) {
    const layers = [];
    if (barWidthFrac !== null) {
        const scanX = width * 0.15, scanW = width * 0.7;
        const barW = Math.round(scanW * barWidthFrac);
        const barX = Math.round(scanX + (scanW - barW) / 2);
        const barY = Math.round(height * barYFrac);
        const barH = Math.max(2, Math.round(height * barHeightFrac));
        const svg = `<svg width="${width}" height="${height}"><rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" fill="white"/></svg>`;
        layers.push({ input: Buffer.from(svg) });
    }
    return sharp({ create: { width, height, channels: 3, background } }).composite(layers).png().toBuffer();
}

test('progress-bar scan: finds the bar on the real loading screen at 100% UI scale', async () => {
    assert.ok(await hasFilledProgressBar(load('loading-screen-100.png')));
});

test('progress-bar scan: finds the bar on the real loading screen at 70% UI scale (bar sits at a different y position than 100% scale)', async () => {
    assert.ok(await hasFilledProgressBar(load('loading-screen-70.png')));
});

test('progress-bar scan: does NOT find a bar on the boot splash (its brightest row is wide but not isolated the way a real bar is)', async () => {
    assert.ok(!(await hasFilledProgressBar(load('boot-splash.png'))));
});

test('progress-bar scan: does NOT false-positive on normal UI screens', async () => {
    for (const name of [
        'menu-open.png',
        'lobby-public.png',
        'lobby-custom.png',
        'gameplay-100.png',
        'gameplay-public-2.png',
        'endgame-public-scoreboard.png',
        'offering-screen.png',
    ]) {
        assert.ok(!(await hasFilledProgressBar(load(name))), `${name} should NOT read as a loading bar`);
    }
});

test('progress-bar scan: an isolated bar reads the same regardless of background color (event loading screens reskin the whole palette, not just the bar)', async () => {
    // Real event loading screens are dark AND colorful (measured mean luma ~20-30,
    // not the ~120+ a vivid saturated color would produce) -- these stay under the
    // bright-pixel threshold (40) on their own, same as the real screens tested
    // against. Values picked by checking sharp's actual greyscale output, not a
    // hand-rolled luma formula -- see the two failures this test caught before this
    // comment was added, where the "obvious" formula undershot sharp's real value.
    const backgrounds = [
        { r: 10, g: 10, b: 10 },  // default near-black (grey ~10)
        { r: 65, g: 18, b: 12 },  // dark red/orange (grey ~34)
        { r: 10, g: 35, b: 14 },  // dark green (grey ~30)
        { r: 44, g: 34, b: 8 },   // dark gold (grey ~35)
    ];
    for (const background of backgrounds) {
        const frame = await syntheticFrame({ background, barWidthFrac: 0.4 });
        assert.ok(
            await hasFilledProgressBar(frame),
            `bar should be found against background rgb(${background.r},${background.g},${background.b})`
        );
    }
});

test('progress-bar scan: rejects a bar that is too wide (a menu divider/HUD row, not an actual progress bar)', async () => {
    const frame = await syntheticFrame({ background: { r: 10, g: 10, b: 10 }, barWidthFrac: 1.0 });
    assert.ok(!(await hasFilledProgressBar(frame)));
});

test('progress-bar scan: rejects a bounded-width bright row with no isolation (busy UI, not an otherwise-empty loading-screen background)', async () => {
    // Same width as a real bar, but filling the entire bottom-quarter scan region
    // (from its top edge, 0.75, straight to the bottom) instead of one thin strip
    // near the bottom -- every row is just as bright as every other row, so there's
    // no isolated peak the way a real bar has.
    const frame = await syntheticFrame({
        background: { r: 10, g: 10, b: 10 },
        barWidthFrac: 0.4,
        barYFrac: 0.75,
        barHeightFrac: 0.25,
    });
    assert.ok(!(await hasFilledProgressBar(frame)));
});
