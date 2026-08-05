'use strict';

const sharp = require('sharp');

// Roster panel region, narrow enough to skip a stray in-scene player nameplate
// that can render further left, tall enough to catch every roster row. The
// roster sits lower when the loadout block above it is fuller (extra currency
// row, more perks) -- observed bottom edge ~0.39, so 0.45 leaves margin for
// UI Scale pushing it further still.
const ROI_X_START_FRAC = 0.85;
const ROI_Y_END_FRAC = 0.45;

// Roster rows are the only letter-rich text in this ROI: the currency row is
// all digits, and the glyph/glow noise PSM 11 invents tops out around 4-5
// letters spread over punctuation. Counting letters (not raw length) is what
// keeps "5 13 895" and "ide? :" out while name fragments stay in.
const MIN_LINE_LETTERS = 6;

// A custom can't start without a killer and at least one survivor, so by the
// time a loading screen can follow, the roster always has 2+ name rows. Public
// screens (lobby, menus, boot, endgame) measure 0-1 letter-rich lines here.
const CUSTOM_LOBBY_MIN_LINES = 2;

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
        const qualifyingLines = lines.filter(l => (l.text.match(/[a-z]/gi) ?? []).length >= MIN_LINE_LETTERS);
        return qualifyingLines.length >= CUSTOM_LOBBY_MIN_LINES;
    }
}

module.exports = { LobbyClassifier };
