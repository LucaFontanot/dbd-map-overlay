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

// A filled bar is a solid rectangle: its fill fraction stays close to its peak
// across its whole thickness. A text line (DBD's own boot-time tip/save/warning
// screens all have one sitting in this same band) fools the fill-range and
// isolation checks alike -- a centered sentence is "bounded width" and has blank
// paragraph space around it -- but it's a brightness SPIKE peaking at the
// glyphs' x-height, not a plateau. Ratio is loose (not a tight 0.85+) because
// compressed/downscaled captures introduce enough per-row noise to break a
// strict threshold even across a real bar's own interior; 0.6 still cleanly
// separated every real bar tested (0.65-1.5% of frame height) from every
// text-line false positive (under 0.4%).
const PLATEAU_STABILITY_RATIO = 0.6;
const PLATEAU_MIN_HEIGHT_FRAC = 0.005;

/**
 * Scans the bottom quarter of the frame for a real loading bar: a row whose
 * bright-pixel fraction is bounded (not a full-width divider or a nearly-full
 * HUD row), isolated (the rows around it are comparatively empty), AND holds
 * as a plateau across enough rows to be a filled rectangle rather than a line
 * of text. Color-agnostic by design -- it only looks at luma, so an event's
 * reskinned red/orange/green loading screen reads the same as the default
 * black one.
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
    if (peak - avgNearby < BAR_MIN_ISOLATION_CONTRAST) return false;

    const plateauThreshold = peak * PLATEAU_STABILITY_RATIO;
    let lo = peakIdx, hi = peakIdx;
    while (lo > 0 && fracs[lo - 1] >= plateauThreshold) lo--;
    while (hi < fracs.length - 1 && fracs[hi + 1] >= plateauThreshold) hi++;
    const plateauRows = hi - lo + 1;

    return plateauRows >= Math.max(2, Math.round(height * PLATEAU_MIN_HEIGHT_FRAC));
}

module.exports = { hasFilledProgressBar };
