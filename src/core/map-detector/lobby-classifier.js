'use strict';

// Roster panel region, narrow enough to skip a stray in-scene player nameplate
// that can render further left, tall enough to catch every roster row. The
// roster sits lower when the loadout block above it is fuller (extra currency
// row, more perks) -- observed bottom edge ~0.39, so 0.45 leaves margin for
// UI Scale pushing it further still.
const ROI_X_START_FRAC = 0.85;
const ROI_Y_END_FRAC = 0.45;

const ROI = {
    x: ROI_X_START_FRAC,
    y: 0,
    width: 1 - ROI_X_START_FRAC,
    height: ROI_Y_END_FRAC,
};

// Roster rows are the only letter-rich, name-shaped text in this ROI. What the
// ROI also contains, and why each rule below exists (measured on the capture
// fixtures with PaddleOCR, which reads this panel far more eagerly than
// tesseract did):
//   - the currency row ("165 454")      → no letters at all
//   - "You"                             → under MIN_LINE_LETTERS
//   - gameplay HUD labels ("DISTRACTION",
//     "ASSIST", "BOLD")                 → all-caps, and the short ones anyway
//   - replay/toast sentences ("Started
//     recording in the replay session") → more than MAX_LINE_WORDS words
// Player and bot names are mixed-case and name-shaped ("Anonymous",
// "Dwight Fairfield_01"), so they pass every rule.
const MIN_LINE_LETTERS = 6;
const MAX_LINE_WORDS = 4;
const MIN_CONFIDENCE = 0.9;

// A custom can't start without a killer and at least one survivor, so by the
// time a loading screen can follow, the roster always has 2+ name rows (the
// smallest startable custom, host + one bot, reads exactly two). Public
// screens (lobby, menus, boot, endgame) measure 0-1 name rows here.
const CUSTOM_LOBBY_MIN_LINES = 2;

/** @returns {boolean} whether a recognised line looks like a player/bot name */
function looksLikePlayerName(item) {
    const text = (item.text || '').trim();
    const letters = (text.match(/\p{L}/gu) || []).length;
    if (letters < MIN_LINE_LETTERS) return false;
    if ((item.confidence ?? 0) < MIN_CONFIDENCE) return false;
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length > MAX_LINE_WORDS) return false;
    // DBD renders HUD/perk labels in caps; player names are shown as typed.
    return text !== text.toUpperCase();
}

class LobbyClassifier {
    /** @param {import('../ocr/ocr-service').OcrService} ocr */
    constructor(ocr) {
        this.ocr = ocr;
    }

    /**
     * @param {Buffer} pngBuffer full-frame capture of the lobby screen
     * @returns {Promise<boolean>}
     */
    async isCustomLobby(pngBuffer) {
        const { items } = await this.ocr.recognize(pngBuffer, { roi: ROI });
        const rosterRows = items.filter(looksLikePlayerName);
        return rosterRows.length >= CUSTOM_LOBBY_MIN_LINES;
    }
}

module.exports = { LobbyClassifier, looksLikePlayerName };
