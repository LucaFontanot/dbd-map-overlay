'use strict';

const sharp = require('sharp');

const NEAR_BLACK_MAX_MEAN = 15;
const NEAR_BLACK_MIN_DARK_FRAC = 0.85;
const NEAR_BLACK_PIXEL_THRESHOLD = 15; // 0-255 luma below this counts as "dark"

const BAR_SCAN_Y_START_FRAC = 0.75;   // search bottom 25% of the frame
const BAR_SCAN_X_START_FRAC = 0.15;   // ...within the middle 70% of its width
const BAR_SCAN_X_END_FRAC = 0.85;
const BAR_BRIGHT_PIXEL_THRESHOLD = 40; // 0-255 luma above this counts as "bar fill"
const BAR_MIN_FILL_FRAC = 0.28;        // boot splash measures ~0.22, real loading screens 0.35-0.50

const THUMBNAIL_WIDTH = 32;
const THUMBNAIL_HEIGHT = 18;

/**
 * @param {Buffer} pngBuffer
 * @returns {Promise<{mean: number, darkFrac: number}>}
 */
async function computeFrameStats(pngBuffer) {
    const { data } = await sharp(pngBuffer)
        .resize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT)
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

    let sum = 0, darkCount = 0;
    for (const p of data) {
        sum += p;
        if (p < NEAR_BLACK_PIXEL_THRESHOLD) darkCount++;
    }
    return { mean: sum / data.length, darkFrac: darkCount / data.length };
}

/** @param {{mean: number, darkFrac: number}} stats */
function isNearBlackFrame(stats) {
    return stats.mean < NEAR_BLACK_MAX_MEAN && stats.darkFrac > NEAR_BLACK_MIN_DARK_FRAC;
}

/**
 * Scans the bottom quarter of the frame for the brightest row. A filled loading
 * bar is one wide, thin, mostly-bright strip, wherever it happens to land at a
 * given UI scale.
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

    let bestFrac = 0;
    for (let y = yStart; y < height; y++) {
        let bright = 0;
        const rowOffset = y * width;
        for (let x = xStart; x < xEnd; x++) {
            if (data[rowOffset + x] > BAR_BRIGHT_PIXEL_THRESHOLD) bright++;
        }
        const frac = bright / rowWidth;
        if (frac > bestFrac) bestFrac = frac;
    }
    return bestFrac >= BAR_MIN_FILL_FRAC;
}

module.exports = { computeFrameStats, isNearBlackFrame, hasFilledProgressBar };
