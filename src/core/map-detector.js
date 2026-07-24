'use strict';

/**
 * MapDetector — periodically screenshots the Dead By Daylight window,
 * runs multi-language OCR on the lower-center area where the game
 * displays REALM / MAP text, and fires `show-map-command` when a
 * known realm+map pair is recognised in any supported locale.
 *
 * OCR is split into two parallel tesseract.js workers:
 *   Group A — Latin + Cyrillic  (en, de, es, fr, it, pt, ru, pl, tr)
 *   Group B — CJK + Thai        (ja, ko, zh-Hans, zh-Hant, th)
 *
 * Language packs (~45 MB total, "fast" LSTM model) are downloaded once
 * and stored in <userData>/tessdata.
 *
 * Detection has two independent paths:
 *   - Manual/hotkey: start()/detectOnce()/stop() manage a worker pool used for a
 *     single on-demand recognition pass (see index.html's hotkey trigger).
 *   - Automatic: startAutomatic()/stopAutomatic() manage an internal, always-on
 *     DetectionStateMachine (IDLE → HUNTING → MATCH_ACTIVE) that stays cheap while
 *     idle and only runs the full OCR pipeline while a match is loading.
 *
 * IPC handles exposed to the renderer:
 *   map-detector-start            → start() — creates the manual worker pool
 *   map-detector-oneshot          → detectOnce() — one recognition pass
 *   map-detector-stop             → stop()
 *   map-detector-status           → returns Boolean (is the automatic loop running)
 *   map-detector-reload-realms    → re-scans photo dir for new realm names
 *   map-detector-start-automatic  → startAutomatic()
 *   map-detector-stop-automatic   → stopAutomatic()
 */

const { ipcMain, app } = require('electron');
const { createWorker } = require('tesseract.js');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { Window } = require('node-screenshots');
const { OcrMatcher } = require('./map-detector/ocr-matcher');
const { computeFrameStats, isNearBlackFrame, hasFilledProgressBar } = require('./map-detector/screen-state');
const { EndgameDetector } = require('./map-detector/endgame-detector');
const { LobbyClassifier } = require('./map-detector/lobby-classifier');
const { DetectionStateMachine } = require('./map-detector/detection-state-machine');
const { preprocessMapCrop } = require('./map-detector/preprocess-map-crop');

const debug = process.env.DEBUG === 'true';

// ─── Language groups by writing system ───────────────────────────────────────
// Covering all 15 localisation files bundled in src/i18n/
const LANG_GROUPS = [
    'eng+deu+fra+spa+ita+por+rus+pol+tur', // Group A – Latin + Cyrillic
    'jpn+kor+chi_sim+chi_tra+tha',          // Group B – CJK + Thai
];

// Hard-coded realm names (English, lowercase) — used before/if the photo
// directory cannot be scanned. Add new DLC realms here as they ship.
const FALLBACK_REALMS = new Set([
    'autohaven wreckers',
    'backwater swamp',
    'coldwind farm',
    'disturbed ward',
    'dvarka deepwood',
    'forsaken boneyard',
    'gideon meat plant',
    'grave of glenvale',
    'haddonfield',
    'hawkins national laboratory',
    "léry's memorial institute",
    "lery's memorial institute",
    'ormond',
    'raccoon city',
    'red forest',
    'silent hill',
    'springwood',
    'the decimated borgo',
    'the macmillan estate',
    'withered isle',
    'yamaoka estate',
]);

// ─── Class ───────────────────────────────────────────────────────────────────

class MapDetector {
    /**
     * @param {import('./main-window')} mainWindow
     * @param {import('./settings')} settings  (unused today, reserved for future per-user config)
     */
    constructor(mainWindow, settings) {
        this.mainWindow = mainWindow;
        this.settings = settings;

        /** @type {import('tesseract.js').Worker[]} */
        this.workers = [];

        /** Maps every localised string (lowercase) to its English key */
        this.reverseI18n = new Map();

        /** Same map but with special chars stripped — catches OCR apostrophe/accent drops */
        this.normalizedI18n = new Map();

        /** English realm names (lowercase) derived from i18n + photo directory */
        this.realmKeys = new Set();

        /** @type {OcrMatcher|null} built after i18n loads, since it needs reverseI18n/normalizedI18n/realmKeys */
        this.ocrMatcher = null;

        /** @type {import('tesseract.js').Worker|null} lightweight, always-'eng', used only by the state machine's cheap classifiers */
        this._classifierWorker = null;
        this._endgameDetector = null;
        this._lobbyClassifier = null;
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

        for (const file of files) {
            try {
                const data = JSON.parse(
                    fs.readFileSync(path.join(i18nDir, file), 'utf-8')
                );
                const entries = Object.entries(data);
                for (const [englishKey, localizedValue] of entries) {
                    // localised → english  (the primary lookup direction)
                    this.reverseI18n.set(localizedValue.toLowerCase().trim(), englishKey);
                    // english → english    (handles EN players with no translation)
                    this.reverseI18n.set(englishKey.toLowerCase().trim(), englishKey);
                    // normalized → english  (handles OCR dropping apostrophes/accents)
                    const normLocalized = localizedValue.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
                    const normEnglish   = englishKey.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
                    if (normLocalized.length > 2 && !this.normalizedI18n.has(normLocalized)) this.normalizedI18n.set(normLocalized, englishKey);
                    if (normEnglish.length > 2   && !this.normalizedI18n.has(normEnglish))   this.normalizedI18n.set(normEnglish, englishKey);
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
        ipcMain.handle('map-detector-start',         () => this.start());
        ipcMain.handle('map-detector-oneshot',       () => this.detectOnce());
        ipcMain.handle('map-detector-stop',          () => this.stop());
        // Reflects whether the automatic (always-on) DetectionStateMachine loop is
        // active -- not the manual/hotkey worker pool managed by start()/stop().
        ipcMain.handle('map-detector-status',        () => !!this._stateMachine);
        ipcMain.handle('map-detector-reload-realms', () => this._loadRealmKeys());
        ipcMain.handle('map-detector-start-automatic', () => this.startAutomatic());
        ipcMain.handle('map-detector-stop-automatic',  () => this.stopAutomatic());
    }

    /**
     * Returns the lang group strings to use based on the ocrLanguage setting.
     * 'all' → both groups; specific lang → single-language worker in the right group.
     */
    _resolveOcrGroups() {
        const lang = (this.settings.get('ocrLanguage') || 'all').trim();
        if (lang === 'all') return LANG_GROUPS;
        const isKnownLanguage = LANG_GROUPS.some(g => g.split('+').includes(lang));
        if (!isKnownLanguage) {
            console.warn(`MapDetector: unknown ocrLanguage "${lang}", falling back to all languages`);
            return LANG_GROUPS;
        }
        return [lang];
    }

    /** Creates tesseract.js workers (one per script group, or one if a specific language is set) */
    async _createWorkers() {
        const cachePath = path.join(app.getPath('userData'), 'tessdata');
        fs.mkdirSync(cachePath, { recursive: true });

        // require.resolve finds the actual installed path in both dev and packaged
        // builds (Electron resolves asarUnpack modules to the real filesystem path).
        const workerPath = path.join(path.dirname(require.resolve('tesseract.js/package.json')), 'src', 'worker-script', 'node', 'index.js');
        const corePath   = path.join(path.dirname(require.resolve('tesseract.js-core/package.json')), 'tesseract-core-simd-lstm.wasm.js');

        const groups = this._resolveOcrGroups();
        console.log(`MapDetector: workerPath: ${workerPath}`);
        console.log(`MapDetector: corePath:   ${corePath}`);
        console.log(`MapDetector: creating ${groups.length} OCR worker(s), tessdata cache: ${cachePath}`);
        groups.forEach((langs, i) => console.log(`MapDetector: worker[${i}] langs: ${langs}`));

        // OEM 1 = LSTM-only (fastest accurate model)
        this.workers = await Promise.all(
            groups.map(langs => createWorker(langs, 1, { cachePath, workerPath, corePath }))
        );
        console.log('MapDetector: all OCR workers ready');
    }

    async _destroyWorkers() {
        await Promise.all(this.workers.map(w => w.terminate().catch(() => {})));
        this.workers = [];
    }

    async _ensureStateMachine() {
        if (this._stateMachine) return this._stateMachine;

        const cachePath = path.join(app.getPath('userData'), 'tessdata');
        fs.mkdirSync(cachePath, { recursive: true });
        const workerPath = path.join(path.dirname(require.resolve('tesseract.js/package.json')), 'src', 'worker-script', 'node', 'index.js');
        const corePath = path.join(path.dirname(require.resolve('tesseract.js-core/package.json')), 'tesseract-core-simd-lstm.wasm.js');
        this._classifierWorker = await createWorker('eng', 1, { cachePath, workerPath, corePath });
        this._endgameDetector = new EndgameDetector(this._classifierWorker);
        this._lobbyClassifier = new LobbyClassifier(this._classifierWorker);

        this._stateMachine = new DetectionStateMachine({
            captureFrame: () => this._captureDBD(),
            computeFrameStats,
            isNearBlackFrame,
            hasFilledProgressBar,
            isCustomLobby: (frame) => this._lobbyClassifier.isCustomLobby(frame),
            recognizeMapText: async (frame) => {
                if (this.workers.length === 0) await this._createWorkers();
                return this._recognizeMapText(frame);
            },
            isEndgameScreen: (frame) => this._endgameDetector.isEndgameScreen(frame),
            onMapDetected: (detectionKey) => {
                console.log(`MapDetector: matched -> ${detectionKey}`);
                this.mainWindow.send('show-map-command', detectionKey.replace(/'/g, '').trim());
            },
            onMatchEnded: () => {
                console.log('MapDetector: endgame screen detected, clearing overlay');
                this.mainWindow.send('map-detector-clear');
                this._destroyWorkers();
            },
            detectInCustoms: () => this.settings.get('detectInCustoms') !== false,
            idlePollMs: 1500,
            huntPollMs: 350,
            // Public-match loading screens wait for every player (including the killer) to
            // finish loading, so they can run well past what a solo/custom-match test shows --
            // live testing hit a real match still on the tip-text screen at 20s, then never
            // got a chance to read the map/realm title once the reveal transition started
            // right around 21-22s. Widened with real margin rather than the bare minimum
            // observed, since a slower lobby is not unusual and the cost of a longer hunt is
            // just a few more (already cheap relative to always-on OCR) recognition passes.
            huntTimeoutMs: 45000,
            matchPollMs: 2500,
        });
        return this._stateMachine;
    }

    /** Starts the always-on, low-cost automatic detection loop. Safe to call multiple times. */
    async startAutomatic() {
        const sm = await this._ensureStateMachine();
        sm.start();
    }

    /**
     * Stops the automatic loop AND tears down the classifier worker, so a later
     * startAutomatic() rebuilds everything fresh rather than reusing (or leaking)
     * a stale worker -- this mirrors the memoization guard at the top of
     * _ensureStateMachine(), which only skips rebuilding while _stateMachine is non-null.
     */
    async stopAutomatic() {
        if (this._stateMachine) this._stateMachine.stop();
        this._stateMachine = null;
        this._endgameDetector = null;
        this._lobbyClassifier = null;
        if (this._classifierWorker) {
            await this._classifierWorker.terminate().catch(() => {});
            this._classifierWorker = null;
        }
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
        const meta = await sharp(fullFrameBuffer).metadata();
        const { width, height } = meta;
        if (!width || !height) return null;

        const croppedBuffer = await sharp(fullFrameBuffer)
            .extract({
                left: 0,
                top: Math.floor(height * 0.65),
                width: Math.floor(width * 0.45),
                height: Math.floor(height * 0.30),
            })
            .png()
            .toBuffer();

        const imgBuffer = await preprocessMapCrop(
            croppedBuffer,
            Math.floor(width * 0.45),
            Math.floor(height * 0.30)
        );

        if (debug) await this._saveDebugCrop(croppedBuffer, imgBuffer);

        const lines = await this._ocr(imgBuffer);
        if (!lines.length) return null;

        return this.ocrMatcher.matchLines(lines);
    }

    /**
     * Opt-in only (DEBUG=true), writes to userData -- never process.cwd() -- so this
     * can't reintroduce the unconditional-debug-write bug that used to live here.
     * Lets you visually confirm exactly what the map/realm-name crop actually
     * contains on your screen, e.g. whether the title text is even inside the box.
     */
    async _saveDebugCrop(croppedBuffer, preprocessedBuffer) {
        try {
            const debugDir = path.join(app.getPath('userData'), 'debug-crops');
            fs.mkdirSync(debugDir, { recursive: true });
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            await sharp(croppedBuffer).toFile(path.join(debugDir, `${stamp}-crop.png`));
            await sharp(preprocessedBuffer).toFile(path.join(debugDir, `${stamp}-preprocessed.png`));
            console.log(`MapDetector: [DEBUG] saved crop images to ${debugDir} (${stamp}-*.png)`);
        } catch (err) {
            console.warn('MapDetector: [DEBUG] failed to save debug crop:', err.message);
        }
    }

    /**
     * Runs OCR using worker groups sequentially with early exit:
     * Group A (Latin+Cyrillic) runs first; Group B (CJK+Thai) only runs
     * if Group A yields no lines — skips the expensive CJK pass for most users.
     *
     * @param {Buffer} imageBuffer  PNG buffer from NativeImage.toPNG()
     * @returns {Promise<string[]>}  Non-empty text lines from all passes
     */
    async _ocr(imageBuffer) {
        console.log(`MapDetector: running OCR on ${imageBuffer.length} byte image with ${this.workers.length} worker(s)`);
        // PSM 11 = sparse text — best for isolated game UI labels on complex backgrounds
        const seen = new Set();
        const lines = [];

        for (let i = 0; i < this.workers.length; i++) {
            let data;
            try {
                ({ data } = await this.workers[i].recognize(imageBuffer, { tessedit_pageseg_mode: '11' }));
            } catch (err) {
                console.warn(`MapDetector: worker[${i}] OCR failed: ${err}`);
                continue;
            }
            // Prefer structured lines; fall back to splitting the raw text string
            const workerLines = (data.lines ?? []).length > 0
                ? data.lines.map(l => l.text.trim())
                : (data.text ?? '').split('\n').map(t => t.trim());
            const kept = workerLines.filter(t => t.length > 3);
            console.log(`MapDetector: worker[${i}] raw lines: ${workerLines.length}, kept: ${kept.length}${kept.length ? ' → ' + kept.join(' | ') : ''}`);
            for (const line of kept) {
                const key = line.toLowerCase().trim();
                if (!seen.has(key)) { seen.add(key); lines.push(line); }
            }
            if (lines.length > 0) break; // Group A matched — skip Group B
        }
        return lines;
    }

    // ── Public ────────────────────────────────────────────────────────────────

    /**
     * Ensures the manual/hotkey OCR worker pool exists. Safe to call multiple times.
     */
    async start() {
        if (this.workers.length === 0) await this._createWorkers();
    }

    /**
     * Runs a single capture → crop → OCR → match → emit pass, for the hotkey/manual-trigger path.
     */
    async detectOnce() {
        if (this.workers.length === 0) await this._createWorkers();
        const frame = await this._captureDBD();
        if (!frame) return;
        const result = await this._recognizeMapText(frame);
        if (!result) return;
        const detectionKey = result.realm ? `${result.realm}/${result.map}` : result.map;
        console.log(`MapDetector: matched -> ${detectionKey}`);
        this.mainWindow.send('show-map-command', detectionKey.replace(/'/g, '').trim());
    }

    /**
     * Releases the manual/hotkey tesseract workers.
     */
    async stop() {
        await this._destroyWorkers();
    }
}

module.exports = MapDetector;
