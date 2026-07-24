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

/**
 * A font-free stand-in for a line of text sitting in the scan region: a small
 * triangular spike, bounded in width and isolated from its surroundings just
 * like a real bar, but tapering to a point within a few rows instead of
 * holding a flat plateau the way a filled rectangle does. Rendering actual
 * text via SVG would depend on whatever fonts happen to be installed on the
 * machine running the tests, which isn't reproducible -- this reproduces the
 * one geometric property that actually matters (spike vs. plateau) instead.
 */
async function spikeFrame({ width = 1920, height = 1080, baseFrac = 0.35, taperRows = 6 }) {
    const scanX = width * 0.15, scanW = width * 0.7;
    const baseW = Math.round(scanW * baseFrac);
    const cx = Math.round(scanX + scanW / 2);
    const baseY = Math.round(height * 0.9);
    const points = [
        [cx - baseW / 2, baseY],
        [cx + baseW / 2, baseY],
        [cx, baseY - taperRows],
    ];
    const svg = `<svg width="${width}" height="${height}"><polygon points="${points.map(p => p.join(',')).join(' ')}" fill="white"/></svg>`;
    return sharp({ create: { width, height, channels: 3, background: { r: 8, g: 8, b: 8 } } })
        .composite([{ input: Buffer.from(svg) }]).png().toBuffer();
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

test('progress-bar scan: does NOT false-positive on DBD\'s own client boot screens (a real IDLE -> HUNTING misfire seen live)', async () => {
    // Both pulled from a live capture of DBD's startup sequence -- each has a
    // single centered line of text sitting in the exact scan band, which used
    // to satisfy the fill-range and isolation checks the same way a real bar
    // does. This is what led to adding the plateau check.
    for (const name of ['boot-autosave-notice.png', 'boot-epilepsy-warning.png']) {
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

test('progress-bar scan: rejects a bounded, isolated spike that tapers instead of holding a plateau (a line of text, not a bar)', async () => {
    // DBD's own boot-time tip/save/warning screens each put a centered line of
    // text in this exact band -- bounded width, blank paragraph space around
    // it, same signature as a real bar right up until you look at whether it
    // holds its brightness across more than a couple of rows.
    const frame = await spikeFrame({});
    assert.ok(!(await hasFilledProgressBar(frame)));
});
