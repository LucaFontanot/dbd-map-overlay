'use strict';

const sharp = require('sharp');

const ROI_X_FRAC = 0.45;
const ROI_Y_FRAC = 0.35;

// English-only for v1 -- see "Global Constraints" in the plan for why.
const ENDGAME_KEYWORDS = ['scoreboard', 'bloodpoints earned', 'survivor grade', 'killer grade', 'level'];

class EndgameDetector {
    /** @param {import('tesseract.js').Worker} worker already-initialized 'eng' worker */
    constructor(worker) {
        this.worker = worker;
    }

    /**
     * @param {Buffer} pngBuffer full-frame capture
     * @returns {Promise<boolean>}
     */
    async isEndgameScreen(pngBuffer) {
        const meta = await sharp(pngBuffer).metadata();
        const roi = await sharp(pngBuffer)
            .extract({
                left: 0,
                top: 0,
                width: Math.floor(meta.width * ROI_X_FRAC),
                height: Math.floor(meta.height * ROI_Y_FRAC),
            })
            // Use the green channel rather than luminance greyscale: DBD's endgame
            // titles are sometimes red-on-smoke (e.g. "BLOODPOINTS EARNED"), which
            // collapses to near-background grey under a standard luminance
            // greyscale conversion. Red text has a low green component, so the
            // green channel alone keeps it dark against the lighter smoke backdrop.
            .extractChannel('green')
            // The ROI spans a large, unevenly-lit smoke/cloud backdrop; a single
            // global normalize() washes out text in the darker/brighter corners.
            // CLAHE (tiled local contrast) keeps text legible across the whole tile.
            .clahe({ width: 32, height: 32 })
            .png()
            .toBuffer();

        const { data } = await this.worker.recognize(roi, { tessedit_pageseg_mode: '6' });
        const text = (data.text || '').toLowerCase();
        return ENDGAME_KEYWORDS.some(keyword => text.includes(keyword));
    }
}

module.exports = { EndgameDetector };
