'use strict';

const sharp = require('sharp');

// Roster panel region, narrow enough to skip a stray in-scene player nameplate
// that can render further left, tall enough to catch every roster row.
const ROI_X_START_FRAC = 0.85;
const ROI_Y_END_FRAC = 0.32;

// PSM 11 throws a bunch of spurious 1-3 char "lines" out of icons/glow in this
// ROI, so a plain non-empty-line count can't tell public and custom apart. Real
// name fragments run 7+ chars (Tesseract likes splitting one name across
// multiple lines), so 6 gives a bit of margin without catching the glyph noise.
const MIN_LINE_TEXT_LENGTH = 6;

// Public lobbies land around 0-1 qualifying lines (just your currency row),
// custom lobbies around 7 (host + bots, often split by OCR). Split the difference.
const CUSTOM_LOBBY_MIN_LINES = 4;

class LobbyClassifier {
    /** @param {import('tesseract.js').Worker} worker already-initialized 'eng' worker */
    constructor(worker) {
        this.worker = worker;
    }

    /**
     * @param {Buffer} pngBuffer full-frame capture of the lobby screen
     * @returns {Promise<boolean>}
     */
    async isCustomLobby(pngBuffer) {
        const meta = await sharp(pngBuffer).metadata();
        const left = Math.floor(meta.width * ROI_X_START_FRAC);
        const roi = await sharp(pngBuffer)
            .extract({
                left,
                top: 0,
                width: meta.width - left,
                height: Math.floor(meta.height * ROI_Y_END_FRAC),
            })
            .greyscale()
            .normalize()
            .png()
            .toBuffer();

        // line-level detail only comes through blocks -> paragraphs -> lines,
        // and only if you ask for it via the third recognize() arg
        const { data } = await this.worker.recognize(
            roi,
            { tessedit_pageseg_mode: '11' },
            { text: true, blocks: true }
        );
        const lines = (data.blocks ?? []).flatMap(block =>
            (block.paragraphs ?? []).flatMap(paragraph => paragraph.lines ?? [])
        );
        const qualifyingLines = lines.filter(l => l.text.trim().length >= MIN_LINE_TEXT_LENGTH);
        return qualifyingLines.length >= CUSTOM_LOBBY_MIN_LINES;
    }
}

module.exports = { LobbyClassifier };
