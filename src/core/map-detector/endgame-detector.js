'use strict';

const sharp = require('sharp');

// Bottom-right corner, where "CONTINUE" renders on every post-match page. Better
// than reading the page title: it's there as soon as the panel shows up (the
// title takes another second or two to animate in), and it's a much smaller
// region to OCR.
const ROI_X_START_FRAC = 0.75;
const ROI_Y_START_FRAC = 0.90;

class EndgameDetector {
    /**
     * @param {import('tesseract.js').Worker} worker already-initialized 'eng' worker
     * @param {string[]} continueKeywords localised "CONTINUE" button texts from i18n
     */
    constructor(worker, continueKeywords) {
        this.worker = worker;
        // Lowercase all keywords so we can do a single .toLowerCase() on the OCR text.
        // Fall back to 'continue' if i18n hasn't loaded yet (shouldn't happen in practice).
        this.continueKeywords = (continueKeywords && continueKeywords.length > 0
            ? continueKeywords
            : ['continue']
        ).map(k => k.toLowerCase().trim());
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
            // Need to binarize before OCR, PSM 11 alone misses the button on some pages.
            .greyscale()
            .threshold(140)
            .png()
            .toBuffer();

        const { data } = await this.worker.recognize(roi, { tessedit_pageseg_mode: '11' });
        const text = (data.text || '').toLowerCase();
        return this.continueKeywords.some(keyword => text.includes(keyword));
    }
}

module.exports = { EndgameDetector, ROI_X_START_FRAC, ROI_Y_START_FRAC };
