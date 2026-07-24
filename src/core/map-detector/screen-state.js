'use strict';

const sharp = require('sharp');

const BAR_SCAN_Y_START_FRAC = 0.75;   // search bottom 25% of the frame
const BAR_SCAN_X_START_FRAC = 0.15;   // ...within the middle 70% of its width
const BAR_SCAN_X_END_FRAC = 0.85;
const BAR_BRIGHT_PIXEL_THRESHOLD = 40; // 0-255 luma above this counts as "bar fill"

// A real loading bar -- any DBD event reskin, any color -- fills a bounded slice
// of the scan width and sits isolated against an otherwise-empty background above
// and below it. Neither bound alone is enough: menus/lobbies/gameplay/endgame
// screens almost always have SOME bright row in this band (HUD text, buttons,
// panels), and a plain "how dark is the whole frame" check misses colored event
// loading screens entirely (red/orange/green reskins measure nowhere near black).
const BAR_MIN_FILL_FRAC = 0.20;          // thinnest observed real bar was 0.29
const BAR_MAX_FILL_FRAC = 0.60;          // widest observed real bar was 0.50; menu dividers/HUD rows run 0.72-1.00
const BAR_MIN_ISOLATION_CONTRAST = 0.18; // rows just off a real bar are near-empty; busy UI rows aren't

// How far from the peak row to sample for isolation, as a fraction of frame
// height rather than a fixed pixel count -- so it holds across 1080p-8K captures
// and different UI Scale settings, the same way the scan region itself does.
const ISOLATION_OFFSET_FRAC = 0.015;
const ISOLATION_BAND_FRAC = 0.004;

/**
 * Scans the bottom quarter of the frame for a real loading bar: a row whose
 * bright-pixel fraction is both bounded (not a full-width divider or a nearly-
 * full HUD row) and isolated (the rows around it are comparatively empty).
 * Color-agnostic by design -- it only looks at luma, so an event's reskinned
 * red/orange/green loading screen reads the same as the default black one.
 * @param {Buffer} pngBuffer
 * @returns {Promise<boolean>}
 */
async function hasFilledProgressBar(pngBuffer) {
    const { data, info } = await sharp(pngBuffer).greyscale().raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;

    const yStart = Math.floor(height * BAR_SCAN_Y_START_FRAC);
    const xStart = Math.floor(width * BAR_SCAN_X_START_FRAC);
    const xEnd = Math.floor(width * BAR_SCAN_X_END_FRAC);
    const rowWidth = xEnd - xStart;
    if (rowWidth <= 0) return false;

    const fracs = [];
    for (let y = yStart; y < height; y++) {
        let bright = 0;
        const rowOffset = y * width;
        for (let x = xStart; x < xEnd; x++) {
            if (data[rowOffset + x] > BAR_BRIGHT_PIXEL_THRESHOLD) bright++;
        }
        fracs.push(bright / rowWidth);
    }

    let peakIdx = 0;
    for (let i = 1; i < fracs.length; i++) {
        if (fracs[i] > fracs[peakIdx]) peakIdx = i;
    }
    const peak = fracs[peakIdx];
    if (peak < BAR_MIN_FILL_FRAC || peak > BAR_MAX_FILL_FRAC) return false;

    const offset = Math.max(3, Math.round(height * ISOLATION_OFFSET_FRAC));
    const band = Math.max(2, Math.round(height * ISOLATION_BAND_FRAC));
    const nearby = fracs
        .slice(Math.max(0, peakIdx - offset - band), Math.max(0, peakIdx - offset))
        .concat(fracs.slice(Math.min(fracs.length, peakIdx + offset), Math.min(fracs.length, peakIdx + offset + band)));
    const avgNearby = nearby.length ? nearby.reduce((a, b) => a + b, 0) / nearby.length : 0;

    return peak - avgNearby >= BAR_MIN_ISOLATION_CONTRAST;
}

module.exports = { hasFilledProgressBar };
