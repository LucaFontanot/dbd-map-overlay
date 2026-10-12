'use strict';

/**
 * MapDetector — periodically screenshots the Dead By Daylight window,
 * runs OCR on the lower-center area where the game displays REALM / MAP text,
 * and fires `show-map-command` when a known realm+map pair is recognised in
 * any supported locale.
 *
 * OCR runs in the main process, on a worker thread, through PaddleOCR
 * (onnxruntime-node, see src/core/ocr/): one shared detection model plus the recognition model for the
 * language the user picked in Settings. Model archives are downloaded once into
 * <userData>/ocr-models (the tessdata cache of the tesseract era). The crop is
 * fed to the engine untouched — PaddleOCR's own pre-processing reads the game's
 * UI text better than the blur/threshold chain that was tuned for tesseract.
 *
 * Detection uses an automatic, always-on DetectionStateMachine
 * (IDLE → HUNTING → MATCH_ACTIVE) that stays cheap while idle and only runs
 * the full OCR pipeline while a match is loading.
 * The ONNX sessions stay loaded for as long as detection is on (across matches
 * and manual map changes) and are released only by stopAutomatic().
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
const { Window } = require('node-screenshots');
const { OcrMatcher } = require('./map-detector/ocr-matcher');
const { hasFilledProgressBar } = require('./map-detector/screen-state');
const { EndgameDetector, ROI: ENDGAME_ROI } = require('./map-detector/endgame-detector');
const { LobbyClassifier } = require('./map-detector/lobby-classifier');
const { DetectionStateMachine } = require('./map-detector/detection-state-machine');
const { FALLBACK_REALMS } = require('./map-detector/fallback-realms');
const { computeMapNameFolds, isRealRealmFolder } = require('./map-detector/realm-catalog');
const { MAP_NAME_ROI } = require('./map-detector/rois');
const { OcrService, ERROR_CODES } = require('./ocr/ocr-service');
const { toSharp, frameSize, cropRect } = require('./ocr/frame');
const { foldName } = require('./map-match');

const debug = process.env.DEBUG === 'true';

const isDbdTitle = (title) => {
    const lower = (title || '').toLowerCase();
    return lower.includes('deadbydaylight') || lower.includes('dead by daylight');
};

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

        /**
         * Bumped by startAutomatic()/stopAutomatic(). Callbacks wired into a state
         * machine check it, so an OCR read that completes after detection was
         * switched off (or restarted) cannot put a map up.
         */
        this._generation = 0;

        /** Last model status sent to the UI, so a later recovery can clear a stale error. */
        this._lastModelState = null;

        /** @type {import('node-screenshots').Window|null} the DBD window found last tick */
        this._dbdWindow = null;
        /** Last window-lookup outcome, logged only when it changes. */
        this._captureLog = null;

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
                    // normalized → english  (handles OCR dropping apostrophes/accents);
                    // folded with map-match's foldName, the same one OcrMatcher applies to OCR lines
                    const normLocalized = foldName(localizedValue);
                    const normEnglish = foldName(englishKey);
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
    /** Re-scan the photo dir for realm folders (after a catalog sync). */
    reloadRealms() {
        return this._loadRealmKeys();
    }

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
     *
     * `code` (on errors) tells the causes apart: OCR_NATIVE_LOAD_FAILED (the
     * onnxruntime native library did not load — on Windows usually the missing
     * Microsoft Visual C++ Redistributable; retrying never helps),
     * OCR_MODEL_DOWNLOAD_FAILED, OCR_MODEL_CORRUPT (deleted, re-downloaded on the
     * next try), OCR_WORKER_FAILED (the inference thread died; the next call
     * starts a new one), or OCR_ERROR for anything else.
     * @param {{state: 'downloading'|'ready'|'error', code?: string, modelId?: string, message: string}} status
     */
    _sendModelStatus(status) {
        this._lastModelState = status.state;
        this.mainWindow.send('map-detector-model-status', status);
    }

    /** @param {Error} err */
    _sendModelError(err) {
        const code = err && err.code && Object.values(ERROR_CODES).includes(err.code) ? err.code : 'OCR_ERROR';
        const messages = {
            [ERROR_CODES.NATIVE_LOAD_FAILED]: `The OCR engine could not start on this system (${err.message}). On Windows, install the latest Microsoft Visual C++ Redistributable (x64) and restart the app.`,
            [ERROR_CODES.MODEL_DOWNLOAD_FAILED]: `Could not download the OCR model for your game language (${err.message}). Detection will stay off until the download succeeds — check your connection and toggle auto-detect again.`,
            [ERROR_CODES.WORKER_FAILED]: `The OCR engine stopped unexpectedly (${err.message}). Toggle auto-detect to restart it.`,
            [ERROR_CODES.MODEL_CORRUPT]: `The OCR model on disk was damaged and has been removed (${err.message}). It will be downloaded again — toggle auto-detect to retry.`,
        };
        this._sendModelStatus({
            state: 'error',
            code,
            message: messages[code] || `The OCR engine failed (${err.message}).`,
        });
    }

    /** OCR worked after an earlier failure: clear the stale error in the UI. */
    _noteOcrWorking() {
        if (this._lastModelState === 'error') {
            this._sendModelStatus({ state: 'ready', message: 'OCR models ready.' });
        }
    }

    async _ensureStateMachine() {
        if (this._stateMachine) return this._stateMachine;
        const generation = this._generation;
        const live = () => generation === this._generation;

        this._endgameDetector = new EndgameDetector(this.ocr, [...this.continueKeywords]);
        this._lobbyClassifier = new LobbyClassifier(this.ocr);

        this._stateMachine = new DetectionStateMachine({
            captureFrame: () => this._captureDBD(),
            hasFilledProgressBar,
            isCustomLobby: async (frame) => {
                const custom = await this._lobbyClassifier.isCustomLobby(frame);
                this._noteOcrWorking();
                return custom;
            },
            recognizeMapText: async (frame) => this._recognizeMapText(frame),
            detectEndgame: async (frame) => {
                if (debug) await this._saveDebugCrop(frame, ENDGAME_ROI, 'endgame-crop');
                const endgame = await this._endgameDetector.detectEndgame(frame);
                this._noteOcrWorking();
                return endgame;
            },
            onMapDetected: (detectionKey) => {
                if (!live()) return;
                console.log(`MapDetector: matched -> ${detectionKey}`);
                this.mainWindow.send('show-map-command', detectionKey.replace(/'/g, '').trim());
            },
            onMatchEnded: (reason) => {
                if (!live()) return;
                console.log(`MapDetector: match ended (${reason}), clearing overlay`);
                // The reason lands in the renderer Debug log: it tells a real end
                // screen from a gameplay false positive
                this.mainWindow.send('map-detector-clear', String(reason || ''));
                // The ONNX sessions stay loaded between matches: recreating them on
                // every loading screen cost more than keeping them. They are only
                // released when detection is switched off (stopAutomatic).
            },
            detectInCustoms: () => this.settings.get('detectInCustoms') !== false,
            endgameEnabled: () => this.settings.get('endgameDetection') === true,
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
        // stopAutomatic() bumps the generation, so everything wired up from here
        // on belongs to this run only.
        const generation = this._generation;
        const sm = await this._ensureStateMachine();
        sm.start();
        // Warm the models up in parallel with the loop: a first run downloads them,
        // and the loop's own OCR call would otherwise wait on the same download
        // while holding up the settings UI.
        this.ocr.prepare(this._language()).then(() => {
            if (generation !== this._generation) return;
            this._sendModelStatus({ state: 'ready', message: 'OCR models ready.' });
        }).catch(err => {
            if (generation !== this._generation) return;
            console.error('MapDetector: OCR model preparation failed:', err.message);
            this._sendModelError(err);
        });
    }

    /**
     * Stops the automatic loop and releases the OCR sessions (detection switched
     * off, or the game language changed), so a later startAutomatic() rebuilds
     * everything fresh rather than reusing (or leaking) it. Returns without
     * waiting for an in-flight frame or a model download (see OcrService.dispose).
     */
    async stopAutomatic() {
        this._generation++;
        if (this._stateMachine) this._stateMachine.stop();
        this._stateMachine = null;
        this._endgameDetector = null;
        this._lobbyClassifier = null;
        this._dbdWindow = null;
        await this.ocr.dispose();
    }

    /** Logs a window-lookup outcome only when it differs from the previous tick's. */
    _logCapture(state, message) {
        if (this._captureLog === state) return;
        this._captureLog = state;
        console.log(`MapDetector: ${message}`);
    }

    /** @returns {import('node-screenshots').Window|null} the DBD window, from the cache when still valid */
    _findDbdWindow() {
        if (this._dbdWindow) {
            try {
                if (isDbdTitle(this._dbdWindow.title())) return this._dbdWindow;
            } catch {
                // the window is gone: fall through to a fresh enumeration
            }
            this._dbdWindow = null;
        }
        const windows = Window.all();
        const window = windows.find(w => {
            try { return isDbdTitle(w.title()); } catch { return false; }
        }) || null;
        if (!window) {
            this._logCapture('missing', `DBD window not found among ${windows.length} window(s): ${windows.map(w => { try { return w.title() || '[untitled]'; } catch { return '[unknown]'; } }).join(', ')}`);
            return null;
        }
        this._dbdWindow = window;
        return window;
    }

    /**
     * Captures the DeadByDaylight window as a raw RGBA frame
     * ({data, width, height, channels}): no PNG encode here and decode in every
     * consumer, sharp reads the pixels directly (see ocr/frame.js).
     * @returns {Promise<{data: Buffer, width: number, height: number, channels: number}|null>}
     */
    async _captureDBD() {
        const start = performance.now();
        const window = this._findDbdWindow();
        if (!window) return null;

        let image;
        try {
            image = await window.captureImage();
        } catch (err) {
            // A stale handle (window closed/recreated between ticks): look it up again next tick.
            this._dbdWindow = null;
            this._logCapture('error', `DBD window capture failed (${err.message})`);
            return null;
        }
        const data = await image.toRaw();
        const frame = { data, width: image.width, height: image.height, channels: 4 };
        this._logCapture(`ok:${frame.width}x${frame.height}`, `capturing DBD window "${window.title()}" (${frame.width}x${frame.height}), first capture took ${Math.round(performance.now() - start)} ms`);
        debug && console.log(`MapDetector: window capture took ${Math.round(performance.now() - start)} ms`);
        return frame;
    }

    /**
     * @param {Buffer|object} frame encoded image or raw capture (see ocr/frame.js)
     * @returns {Promise<{realm: string|null, map: string}|null>}
     */
    async _recognizeMapText(frame) {
        if (debug) await this._saveDebugCrop(frame, MAP_NAME_ROI, 'crop');

        const started = performance.now();
        const { items } = await this.ocr.recognize(frame, { roi: MAP_NAME_ROI });
        this._noteOcrWorking();
        const lines = items.map(i => i.text.trim()).filter(text => text.length > 3);
        console.log(`MapDetector: OCR in ${Math.round(performance.now() - started)} ms, lines: ${lines.length ? lines.join(' | ') : '<none>'}`);
        if (!lines.length) return null;

        return this.ocrMatcher.matchLines(lines);
    }

    /** Opt-in only (DEBUG=true). Writes the OCR'd region to userData, never process.cwd(). */
    async _saveDebugCrop(frame, roi, suffix) {
        try {
            const { width, height } = await frameSize(frame);
            const debugDir = path.join(app.getPath('userData'), 'debug-crops');
            fs.mkdirSync(debugDir, { recursive: true });
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const file = `${stamp}-${suffix}.png`;
            await toSharp(frame).extract(cropRect(width, height, roi)).png().toFile(path.join(debugDir, file));
            console.log(`MapDetector: [DEBUG] saved ${suffix} image to ${debugDir} (${file})`);
        } catch (err) {
            console.warn(`MapDetector: [DEBUG] failed to save ${suffix} image:`, err.message);
        }
    }

    // ── Public ────────────────────────────────────────────────────────────────

    /**
     * Called on every manual map change: the running state machine learns that
     * the overlay now shows the user's own pick and must survive the match
     * ending. Detection keeps running and the OCR sessions stay loaded.
     */
    async stop() {
        if (this._stateMachine) this._stateMachine.releaseOverlay();
    }
}

module.exports = MapDetector;
