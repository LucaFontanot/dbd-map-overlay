'use strict';

const sharp = require('sharp');

// Bottom-right corner, where the "CONTINUE" button renders on every post-match
// page (scoreboard/bloodpoints/grade/level, public and custom alike). Chosen
// over the page title (top-left, e.g. "SCOREBOARD"/"BLOODPOINTS EARNED") for
// two reasons found during live testing: (1) the title text animates in over
// ~1-2s after the panel itself appears, while CONTINUE is already static and
// present as soon as the panel renders -- detects meaningfully earlier; (2) a
// small fixed-position ROI is far cheaper to OCR (tens of ms) than the large
// top-left title region (~800-900ms), directly cutting perceived latency
// between the match actually ending and the overlay clearing.
const ROI_X_START_FRAC = 0.75;
const ROI_Y_START_FRAC = 0.90;

const ENDGAME_KEYWORD = 'continue';

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
        const left = Math.floor(meta.width * ROI_X_START_FRAC);
        const top = Math.floor(meta.height * ROI_Y_START_FRAC);
        const roi = await sharp(pngBuffer)
            .extract({
                left,
                top,
                width: meta.width - left,
                height: meta.height - top,
            })
            // Plain greyscale + hard threshold, not the green-channel/CLAHE combo
            // this file used to have -- that was tuned for the (now-unused) title
            // ROI's red-on-smoke text problem, which doesn't apply to this white-
            // on-dark button. PSM 11 alone missed the button on some pages (one
            // returned no text at all); threshold-binarizing first fixed it across
            // every page tested, including the two that PSM 11 alone missed.
            .greyscale()
            .threshold(140)
            .png()
            .toBuffer();

        const { data } = await this.worker.recognize(roi, { tessedit_pageseg_mode: '11' });
        const text = (data.text || '').toLowerCase();
        return text.includes(ENDGAME_KEYWORD);
    }
}

module.exports = { EndgameDetector };
