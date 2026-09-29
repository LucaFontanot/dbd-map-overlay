'use strict';

/**
 * MapDetector — periodically screenshots the Dead By Daylight window,
 * runs OCR on the lower-center area where the game displays REALM / MAP text,
 * and fires `show-map-command` when a known realm+map pair is recognised in
 * any supported locale.
 *
 * OCR runs in this process through PaddleOCR (onnxruntime-node, see
 * src/core/ocr/): one shared detection model plus the recognition model for the
 * language the user picked in Settings. Model archives are downloaded once into
 * <userData>/ocr-models (the tessdata cache of the tesseract era). The crop is
 * fed to the engine untouched — PaddleOCR's own pre-processing reads the game's
 * UI text better than the blur/threshold chain that was tuned for tesseract.
 *
 * Detection uses an automatic, always-on DetectionStateMachine
 * (IDLE → HUNTING → MATCH_ACTIVE) that stays cheap while idle and only runs
 * the full OCR pipeline while a match is loading.
 *
 * IPC handles exposed to the renderer:
 *   map-detector-status           → returns Boolean (is the automatic loop running)
 *   map-detector-reload-realms    → re-scans photo dir for new realm names
 *   map-detector-start-automatic  → startAutomatic()
 *   map-detector-stop-automatic   → stopAutomatic()
 */

const { ipcMain, app } = require('electron');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { Window } = require('node-screenshots');
const { OcrMatcher } = require('./map-detector/ocr-matcher');
const { hasFilledProgressBar } = require('./map-detector/screen-state');
const { EndgameDetector, ROI_X_START_FRAC: ENDGAME_ROI_X, ROI_Y_START_FRAC: ENDGAME_ROI_Y } = require('./map-detector/endgame-detector');
const { LobbyClassifier } = require('./map-detector/lobby-classifier');
const { DetectionStateMachine } = require('./map-detector/detection-state-machine');
const { FALLBACK_REALMS } = require('./map-detector/fallback-realms');
const { computeMapNameFolds, isRealRealmFolder } = require('./map-detector/realm-catalog');
const { OcrService } = require('./ocr/ocr-service');

const debug = process.env.DEBUG === 'true';

// Where the game prints the map/realm name, as a fraction of the frame.
// 85% width: a narrower crop clips long titles that wrap onto a second line at
// higher UI Scale settings (e.g. "Raccoon City Police Station" is one line at
// 70% but wraps to two at 100%).
const MAP_NAME_ROI = { x: 0, y: 0.65, width: 0.85, height: 0.30 };

// ─── Class ───────────────────────────────────────────────────────────────────

class MapDetector {
    /**
     * @param {import('./main-window')} mainWindow
     * @param {import('./settings')} settings
     */
    constructor(mainWindow, settings) {
        this.mainWindow = mainWindow;
        this.settings = settings;

        /** Maps every localised string (lowercase) to its English key */
        this.reverseI18n = new Map();

        /** Same map but with special chars stripped — catches OCR apostrophe/accent drops */
        this.normalizedI18n = new Map();

        /** English realm names (lowercase) derived from i18n + photo directory */
        this.realmKeys = new Set();

        /** @type {OcrMatcher|null} built after i18n loads, since it needs reverseI18n/normalizedI18n/realmKeys */
        this.ocrMatcher = null;

        /** Localised "CONTINUE" button texts collected during _loadI18n() */
        this.continueKeywords = new Set();

        /** @type {OcrService} shared by the map-name read, the endgame check and the lobby classifier */
        /** Throttles the model-download progress sent to the settings UI. */
        this._lastModelStatusAt = 0;

        this.ocr = new OcrService({
            // OCR_MODELS_DIR lets the dev CLI and the tests reuse the same models.
            modelsDir: process.env.OCR_MODELS_DIR || path.join(app.getPath('userData'), 'ocr-models'),
            // Read per call: the user can change the game language while the app runs.
            language: () => this._language(),
            onDownloadProgress: ({ modelId, receivedBytes, totalBytes }) => {
                console.log(`MapDetector: downloading OCR model ${modelId} — ${Math.round(receivedBytes / 1e6)}/${Math.round(totalBytes / 1e6)} MB`);
                const now = Date.now();
                if (now - this._lastModelStatusAt < 500) return;
                this._lastModelStatusAt = now;
                this._sendModelStatus({
                    state: 'downloading',
                    modelId,
                    receivedBytes,
                    totalBytes,
                    message: `Downloading the ${modelId} OCR model… ${Math.round((receivedBytes / (totalBytes || 1)) * 100)}%`,
                });
            },
        });

        /** @type {EndgameDetector|null} */
        this._endgameDetector = null;
        /** @type {LobbyClassifier|null} */
        this._lobbyClassifier = null;
        /** @type {DetectionStateMachine|null} */
        this._stateMachine = null;

        this._loadI18n();
        this._setupIPC();
    }

    // ── Private ───────────────────────────────────────────────────────────────

    /** Builds reverseI18n from all JSON files in src/i18n/ */
    _loadI18n() {
        const i18nDir = path.join(global.dirname, 'src', 'i18n');
        console.log(`MapDetector: loading i18n from ${i18nDir}`);
        let files;
        try {
            files = fs.readdirSync(i18nDir).filter(f => f.endsWith('.json'));
            console.log(`MapDetector: found ${files.length} i18n file(s): ${files.join(', ')}`);
        } catch {
            console.error('MapDetector: cannot read i18n directory');
            return;
        }

        // Every English realm/map key, used to tell genuine realm folder names
        // from map names some creators reuse as folders (see realm-catalog.js).
        this.englishKeys = new Set();
        for (const file of files) {
            try {
                const data = JSON.parse(
                    fs.readFileSync(path.join(i18nDir, file), 'utf-8')
                );
                const entries = Object.entries(data);
                for (const [englishKey, localizedValue] of entries) {
                    this.englishKeys.add(englishKey);
                    // Collect BUTTON_Continue translations for endgame detection
                    if (englishKey === 'BUTTON_Continue') {
                        this.continueKeywords.add(localizedValue.toLowerCase().trim());
                        continue;
                    }
                    // localised → english  (the primary lookup direction)
                    this.reverseI18n.set(localizedValue.toLowerCase().trim(), englishKey);
                    // english → english    (handles EN players with no translation)
                    this.reverseI18n.set(englishKey.toLowerCase().trim(), englishKey);
                    // normalized → english  (handles OCR dropping apostrophes/accents)
                    const normLocalized = localizedValue.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
                    const normEnglish = englishKey.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
                    if (normLocalized.length > 2 && !this.normalizedI18n.has(normLocalized)) this.normalizedI18n.set(normLocalized, englishKey);
                    if (normEnglish.length > 2 && !this.normalizedI18n.has(normEnglish)) this.normalizedI18n.set(normEnglish, englishKey);
                }
                console.log(`MapDetector: [i18n] ${file} → ${entries.length} entries`);
            } catch {
                console.error(`MapDetector: failed to parse ${file}`);
            }
        }
        console.log(`MapDetector: reverseI18n total size: ${this.reverseI18n.size}`);

        this._loadRealmKeys();

        this.ocrMatcher = new OcrMatcher({
            reverseI18n: this.reverseI18n,
            normalizedI18n: this.normalizedI18n,
            realmKeys: this.realmKeys,
        });
    }

    /**
     * Populates realmKeys starting from the hard-coded fallback set,
     * then augmenting from the actual photo directory structure so future
     * DLC realms are picked up automatically once images are downloaded.
     */
    _loadRealmKeys() {
        for (const r of FALLBACK_REALMS) this.realmKeys.add(r);
        console.log(`MapDetector: loaded ${FALLBACK_REALMS.size} fallback realm(s)`);

        // Skip folder names that collide with a shipped MAP name. Some creators
        // (KaiserAleex, SamoelColt) store the Crotus Prenn Asylum maps under a
        // folder literally called "Disturbed Ward" — that is a map, and letting
        // it into realmKeys makes OcrMatcher classify the map line as a realm,
        // silently killing detection of that map (see realm-catalog.js).
        const mapNameFolds = computeMapNameFolds(this.englishKeys || [], FALLBACK_REALMS);

        const photoDir = path.join(app.getPath('userData'), 'photo');
        console.log(`MapDetector: scanning photo dir for realms: ${photoDir}`);
        try {
            if (!fs.existsSync(photoDir)) {
                console.log('MapDetector: photo dir not found, using fallback realms only');
                return;
            }
            let added = 0;
            for (const creator of fs.readdirSync(photoDir)) {
                const creatorPath = path.join(photoDir, creator);
                if (!fs.statSync(creatorPath).isDirectory()) continue;
                for (const realm of fs.readdirSync(creatorPath)) {
                    if (fs.statSync(path.join(creatorPath, realm)).isDirectory()) {
                        if (!isRealRealmFolder(realm, mapNameFolds)) {
                            console.log(`MapDetector: ignoring realm folder "${realm}" (name is a map, not a realm)`);
                            continue;
                        }
                        this.realmKeys.add(realm.toLowerCase());
                        added++;
                    }
                }
            }
            console.log(`MapDetector: found ${added} realm(s) from photo dir, total: ${this.realmKeys.size}`);
        } catch (err) {
            // non-fatal — fallback list covers the base game
            console.warn(`MapDetector: photo dir scan failed (${err.message}), using fallback realms only`);
        }
    }

    _setupIPC() {
        ipcMain.handle('map-detector-status', () => !!this._stateMachine);
        ipcMain.handle('map-detector-reload-realms', () => this._loadRealmKeys());
        ipcMain.handle('map-detector-start-automatic', () => this.startAutomatic());
        ipcMain.handle('map-detector-stop-automatic', () => this.stopAutomatic());
    }

    /** @returns {string} the configured game language code, or 'all' when unset */
    _language() {
        return (this.settings.get('ocrLanguage') || 'all').trim();
    }

    /**
     * Tells the settings UI what the engine is doing. A first run has to fetch a
     * model before detection works at all, and a failed download used to be
     * visible only in the console — indistinguishable from "detection is broken".
     * @param {{state: 'downloading'|'ready'|'error', modelId?: string, message: string}} status
     */
    _sendModelStatus(status) {
        this.mainWindow.send('map-detector-model-status', status);
    }

    async _ensureStateMachine() {
        if (this._stateMachine) return this._stateMachine;

        this._endgameDetector = new EndgameDetector(this.ocr, [...this.continueKeywords]);
        this._lobbyClassifier = new LobbyClassifier(this.ocr);

        this._stateMachine = new DetectionStateMachine({
            captureFrame: () => this._captureDBD(),
            hasFilledProgressBar,
            isCustomLobby: (frame) => this._lobbyClassifier.isCustomLobby(frame),
            recognizeMapText: async (frame) => this._recognizeMapText(frame),
            detectEndgame: async (frame) => {
                if (debug) await this._saveDebugEndgameCrop(frame);
                return this._endgameDetector.detectEndgame(frame);
            },
            onMapDetected: (detectionKey) => {
                console.log(`MapDetector: matched -> ${detectionKey}`);
                this.mainWindow.send('show-map-command', detectionKey.replace(/'/g, '').trim());
            },
            onMatchEnded: () => {
                console.log('MapDetector: endgame screen detected, clearing overlay');
                this.mainWindow.send('map-detector-clear');
                // Free the ONNX sessions between matches; they reload from disk in
                // a few hundred ms at the next loading screen.
                this.ocr.dispose();
            },
            detectInCustoms: () => this.settings.get('detectInCustoms') !== false,
            idlePollMs: 1500,
            huntPollMs: 350,
            // Public-match loading screens wait for every player (including the killer) to
            // finish loading, so they can run well past a solo/custom-match's load time.
            huntTimeoutMs: 45000,
            matchPollMs: 2500,
        });
        return this._stateMachine;
    }

    /** Starts the always-on, low-cost automatic detection loop. Safe to call multiple times. */
    async startAutomatic() {
        const sm = await this._ensureStateMachine();
        sm.start();
        // Warm the models up in parallel with the loop: a first run downloads them,
        // and the loop's own OCR call would otherwise wait on the same download
        // while holding up the settings UI.
        this.ocr.prepare(this._language()).then(() => {
            this._sendModelStatus({ state: 'ready', message: 'OCR models ready.' });
        }).catch(err => {
            console.error('MapDetector: OCR model preparation failed:', err.message);
            this._sendModelStatus({
                state: 'error',
                message: `Could not download the OCR model for your game language (${err.message}). Detection will stay off until the download succeeds — check your connection and toggle auto-detect again.`,
            });
        });
    }

    /**
     * Stops the automatic loop and releases the OCR sessions, so a later
     * startAutomatic() rebuilds everything fresh rather than reusing (or leaking) it.
     */
    async stopAutomatic() {
        if (this._stateMachine) this._stateMachine.stop();
        this._stateMachine = null;
        this._endgameDetector = null;
        this._lobbyClassifier = null;
        await this.ocr.dispose();
    }

    /**
     * Captures a thumbnail of the DeadByDaylight window.
     * @returns {Electron.NativeImage | null}
     */
    async _captureDBD() {
        const start = performance.now();

        const windows = Window.all();

        console.log(
            `MapDetector: found ${windows.length} window(s): ${
                windows.map(w => w.title?.() || '[unknown]').join(', ')
            }`
        );

        const window = windows.find(w => {
            const title = (w.title?.() || '').toLowerCase();

            return (
                title.includes('deadbydaylight') ||
                title.includes('dead by daylight')
            );
        });

        if (!window) {
            console.log('MapDetector: DBD window not found');
            return null;
        }

        console.log(
            `MapDetector: capturing DBD window "${window.title?.()}" (${window.width()}x${window.height()})`
        );

        const image = await window.captureImage();
        const buffer = await image.toPng();

        console.log(`MapDetector: window capture took ${performance.now() - start} ms`);

        return buffer;
    }

    /**
     * @param {Buffer} fullFrameBuffer
     * @returns {Promise<{realm: string|null, map: string}|null>}
     */
    async _recognizeMapText(fullFrameBuffer) {
        if (debug) await this._saveDebugCrop(fullFrameBuffer);

        const started = performance.now();
        const { items } = await this.ocr.recognize(fullFrameBuffer, { roi: MAP_NAME_ROI });
        const lines = items.map(i => i.text.trim()).filter(text => text.length > 3);
        console.log(`MapDetector: OCR in ${Math.round(performance.now() - started)} ms, lines: ${lines.length ? lines.join(' | ') : '<none>'}`);
        if (!lines.length) return null;

        return this.ocrMatcher.matchLines(lines);
    }

    /** Opt-in only (DEBUG=true). Writes to userData, never process.cwd(). */
    async _saveDebugCrop(fullFrameBuffer) {
        try {
            const meta = await sharp(fullFrameBuffer).metadata();
            const debugDir = path.join(app.getPath('userData'), 'debug-crops');
            fs.mkdirSync(debugDir, { recursive: true });
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            await sharp(fullFrameBuffer)
                .extract({
                    left: 0,
                    top: Math.floor(meta.height * MAP_NAME_ROI.y),
                    width: Math.floor(meta.width * MAP_NAME_ROI.width),
                    height: Math.floor(meta.height * MAP_NAME_ROI.height),
                })
                .toFile(path.join(debugDir, `${stamp}-crop.png`));
            console.log(`MapDetector: [DEBUG] saved crop image to ${debugDir} (${stamp}-crop.png)`);
        } catch (err) {
            console.warn('MapDetector: [DEBUG] failed to save debug crop:', err.message);
        }
    }

    /** Opt-in only (DEBUG=true). Same as _saveDebugCrop, for the endgame-check ROI. */
    async _saveDebugEndgameCrop(fullFrameBuffer) {
        try {
            const meta = await sharp(fullFrameBuffer).metadata();
            const left = Math.floor(meta.width * ENDGAME_ROI_X);
            const top = Math.floor(meta.height * ENDGAME_ROI_Y);
            const debugDir = path.join(app.getPath('userData'), 'debug-crops');
            fs.mkdirSync(debugDir, { recursive: true });
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            await sharp(fullFrameBuffer)
                .extract({left, top, width: meta.width - left, height: meta.height - top})
                .toFile(path.join(debugDir, `${stamp}-endgame-crop.png`));
            console.log(`MapDetector: [DEBUG] saved endgame-check crop to ${debugDir} (${stamp}-endgame-crop.png)`);
        } catch (err) {
            console.warn('MapDetector: [DEBUG] failed to save endgame crop:', err.message);
        }
    }

    // ── Public ────────────────────────────────────────────────────────────────

    /**
     * Ensures the OCR models for the configured language are on disk (downloading
     * them on first use). Safe to call multiple times.
     */
    async start() {
        await this.ocr.prepare(this._language());
    }

    /**
     * Releases the OCR sessions. Called on every manual map change, so this is
     * also where the running state machine learns that the overlay now shows the
     * user's own pick and must survive the match ending.
     */
    async stop() {
        if (this._stateMachine) this._stateMachine.releaseOverlay();
        await this.ocr.dispose();
    }
}

module.exports = MapDetector;
