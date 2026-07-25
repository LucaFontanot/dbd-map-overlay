'use strict';

const sharp = require('sharp');

// Bottom-right corner, where "CONTINUE" renders on every post-match page. Better
// than reading the page title: it's there as soon as the panel shows up (the
// title takes another second or two to animate in), and it's a much smaller
// region to OCR.
const ROI_X_START_FRAC = 0.75;
const ROI_Y_START_FRAC = 0.90;

// The real button OCRs at ~95-96 on every fixture; the gameplay noise that
// occasionally spells out stray words lands far lower. At or above this, one
// read is trustworthy on its own; below it, the caller should confirm.
const CONFIDENT_MIN = 85;

// Keeps a button glyph fused onto the word ("continue|") from breaking the
// match, while "continued" still fails: only letters take part in the
// comparison, but extra letters do.
const stripNonLetters = s => s.toLowerCase().replace(/[^\p{L}]/gu, '');

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
        // Letters-only forms for the word-level comparison.
        this.keywordTargets = new Set(this.continueKeywords.map(stripNonLetters).filter(Boolean));
        // Whole-token only: a plain substring test would also fire on e.g.
        // "continued" in stray in-game text that drifts into the ROI.
        this.keywordRes = this.continueKeywords.map(k =>
            new RegExp(`(^|[^\\p{L}])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'u')
        );
    }

    /**
     * @param {Buffer} pngBuffer full-frame capture
     * @returns {Promise<{seen: boolean, confident: boolean}>}
     */
    async detectEndgame(pngBuffer) {
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

        // Word-level detail only comes through blocks, and only when asked for
        // via the third recognize() arg.
        const { data } = await this.worker.recognize(
            roi,
            { tessedit_pageseg_mode: '11' },
            { text: true, blocks: true }
        );
        const words = (data.blocks ?? []).flatMap(block =>
            (block.paragraphs ?? []).flatMap(paragraph =>
                (paragraph.lines ?? []).flatMap(line => line.words ?? [])
            )
        );
        const matches = words.filter(w => this.keywordTargets.has(stripNonLetters(w.text || '')));
        const text = (data.text || '').toLowerCase();
        const seen = matches.length > 0 || this.keywordRes.some(re => re.test(text));
        const confident = matches.some(w => w.confidence >= CONFIDENT_MIN);
        return { seen, confident };
    }
}

module.exports = { EndgameDetector, ROI_X_START_FRAC, ROI_Y_START_FRAC, CONFIDENT_MIN };
