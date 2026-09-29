'use strict';

// Bottom-right corner, where "CONTINUE" renders on every post-match page. Better
// than reading the page title: it's there as soon as the panel shows up (the
// title takes another second or two to animate in), and it's a much smaller
// region to OCR.
const ROI_X_START_FRAC = 0.75;
const ROI_Y_START_FRAC = 0.90;

const ROI = {
    x: ROI_X_START_FRAC,
    y: ROI_Y_START_FRAC,
    width: 1 - ROI_X_START_FRAC,
    height: 1 - ROI_Y_START_FRAC,
};

// PaddleOCR confidence for the real button measured 0.97-1.00 on every endgame
// fixture (the tesseract-era 0-100 scale lined up at 95-96); gameplay pixels that
// spell out stray words land far below this.
const CONFIDENT_MIN = 0.85;

// Keeps a button glyph fused onto the word ("continue|") from breaking the
// match, while "continued" still fails: only letters take part in the
// comparison, but extra letters do.
const stripNonLetters = s => s.toLowerCase().replace(/[^\p{L}]/gu, '');

class EndgameDetector {
    /**
     * @param {import('../ocr/ocr-service').OcrService} ocr
     * @param {string[]} continueKeywords localised "CONTINUE" button texts from i18n
     */
    constructor(ocr, continueKeywords) {
        this.ocr = ocr;
        // Lowercase all keywords so we can do a single .toLowerCase() on the OCR text.
        // Fall back to 'continue' if i18n hasn't loaded yet (shouldn't happen in practice).
        this.continueKeywords = (continueKeywords && continueKeywords.length > 0
            ? continueKeywords
            : ['continue']
        ).map(k => k.toLowerCase().trim());
        // Letters-only forms for the word-level comparison.
        this.keywordTargets = new Set(this.continueKeywords.map(stripNonLetters).filter(Boolean));
    }

    /**
     * @param {Buffer} pngBuffer full-frame capture
     * @returns {Promise<{seen: boolean, confident: boolean}>}
     */
    async detectEndgame(pngBuffer) {
        const { items } = await this.ocr.recognize(pngBuffer, { roi: ROI });
        // Whole-token only: a substring test would also fire on e.g. "continued"
        // in stray in-game text that drifts into the ROI.
        const matches = items.filter(item => this.keywordTargets.has(stripNonLetters(item.text || '')));
        return {
            seen: matches.length > 0,
            confident: matches.some(item => item.confidence >= CONFIDENT_MIN),
        };
    }
}

module.exports = { EndgameDetector, ROI_X_START_FRAC, ROI_Y_START_FRAC, CONFIDENT_MIN };
