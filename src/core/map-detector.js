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
 * IPC handles exposed to the renderer:
 *   map-detector-start          → start() — creates workers + begins polling
 *   map-detector-stop           → stop()
 *   map-detector-status         → returns Boolean (running)
 *   map-detector-reload-realms  → re-scans photo dir for new realm names
 */

const { desktopCapturer, ipcMain, app, screen } = require('electron');
const { createWorker } = require('tesseract.js');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { Window, Monitor } = require('node-screenshots');

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
        this.timer = null;
        this.running = false;
        this.intervalMs = 1000;

        /** Maps every localised string (lowercase) to its English key */
        this.reverseI18n = new Map();

        /** Same map but with special chars stripped — catches OCR apostrophe/accent drops */
        this.normalizedI18n = new Map();

        /** English realm names (lowercase) derived from i18n + photo directory */
        this.realmKeys = new Set();

        /** Last matched "realm/map" key — suppresses duplicate events */
        this.lastDetected = null;

        /** Raw PNG of the last crop — skips preprocess+OCR when screen is unchanged */
        this.lastCropBuffer = null;

        /** Prevents concurrent _detect() calls from overlapping */
        this._detecting = false;

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
        ipcMain.handle('map-detector-stop',          () => this.stop());
        ipcMain.handle('map-detector-status',        () => this.running);
        ipcMain.handle('map-detector-reload-realms', () => this._loadRealmKeys());
    }

    /**
     * Returns the lang group strings to use based on the ocrLanguage setting.
     * 'all' → both groups; specific lang → single-language worker in the right group.
     */
    _resolveOcrGroups() {
        const lang = (this.settings.get('ocrLanguage') || 'all').trim();
        if (lang === 'all') return LANG_GROUPS;
        const groupIndex = LANG_GROUPS.findIndex(g => g.split('+').includes(lang));
        return [groupIndex !== -1 ? lang : lang]; // single worker, single language
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

    /**
     * Captures a thumbnail of the DeadByDaylight window.
     * @returns {Electron.NativeImage | null}
     */
    async _captureDBD() {
        const start = performance.now();

        const monitors = Monitor.all();
        const monitorIndex = parseInt(this.settings.get('monitor')) || 0;
        const monitor = monitors[monitorIndex];

        if (!monitor) {
            console.log('MapDetector: no monitor found');
            return null;
        }

        // Capture full screen (fast native DXGI/XCap path)
        const image = await monitor.captureImage();

        const buffer = await image.toPng();

        console.log(`MapDetector: monitor capture took ${performance.now() - start} ms`);
        
        await sharp(buffer).toFile('debug_raw.png');

        return buffer;
    }

    /**
     * Crops the image to the lower-left region where DBD shows
     * the REALM / MAP text on the loading screen.
     *   x: 0 %–45 %   (left side)
     *   y: 65 %–95 %  (lower portion)
     *
     * @param {Electron.NativeImage} img
     * @returns {Electron.NativeImage}
     */
    _cropForText(img) {
        const { width, height } = img.getSize();
        if (width === 0 || height === 0) return img;
        const crop = {
            x:      0,
            y:      Math.floor(height * 0.65),
            width:  Math.floor(width  * 0.45),
            height: Math.floor(height * 0.30),
        };
        console.log(`MapDetector: crop region x=${crop.x} y=${crop.y} w=${crop.width} h=${crop.height} (from ${width}x${height})`);
        return img.crop(crop);
    }

    /**
     * Preprocesses the cropped PNG for Tesseract:
     *   1. 2× upscale  — improves OCR accuracy on small text
     *   2. Greyscale   — removes colour noise
     *   3. Normalise   — stretches contrast across full range
     *   4. Blur      — smooth anti-aliased edges before binarisation — prevents single-word splits
     *   5. Threshold   — hard binarise, drops background gradients
     *
     * @param {Buffer} pngBuffer
     * @returns {Promise<Buffer>}
     */
    async _preprocessImage(pngBuffer, width, height) {
        return sharp(pngBuffer)
            .resize(width * 2, height * 2, { kernel: sharp.kernel.lanczos3 })
            .greyscale()
            .normalize()
            .blur(0.5)
            .threshold(128)
            .png()
            .toBuffer();
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

    /**
     * Scans OCR lines for consecutive REALM → MAP pairs (in that order,
     * as the game renders them).  Falls back to MAP → REALM order if the
     * image is rotated or the crop is slightly off.
     *
     * @param {string[]} lines
     * @returns {{ realm: string, map: string } | null}
     */
    _levenshtein(a, b) {
        const m = a.length, n = b.length;
        const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
        for (let j = 0; j <= n; j++) dp[0][j] = j;
        for (let i = 1; i <= m; i++)
            for (let j = 1; j <= n; j++)
                dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1]
                    : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
        return dp[m][n];
    }

    _fuzzyMatchRealmKey(raw) {
        // Scale tolerance with length: ~18 % of chars, min 2 (handles single misreads and short names)
        const MAX_DIST = Math.max(2, Math.floor(raw.length * 0.18));
        let best = null, bestDist = MAX_DIST + 1;
        for (const realmKey of this.realmKeys) {
            const dist = this._levenshtein(raw, realmKey);
            if (dist < bestDist) { bestDist = dist; best = realmKey; }
        }
        return bestDist <= MAX_DIST ? best : null;
    }

    /** Fuzzy search across all normalizedI18n keys — catches map names with OCR typos */
    _fuzzyMatchI18n(raw) {
        const MAX_DIST = Math.max(2, Math.floor(raw.length * 0.18));
        let best = null, bestDist = MAX_DIST + 1;
        for (const [key, value] of this.normalizedI18n) {
            if (Math.abs(key.length - raw.length) > MAX_DIST) continue;
            const dist = this._levenshtein(raw, key);
            if (dist < bestDist) { bestDist = dist; best = value; }
        }
        return bestDist <= MAX_DIST ? best : null;
    }

    /**
     * Tries every lookup strategy (exact → normalized → substring → fuzzy) for a single candidate string.
     * @param {string} candidate  Already lowercased+trimmed
     * @returns {string|null}     English map/realm key, or null
     */
    _tryMatch(candidate) {
        const raw = candidate.toLowerCase().trim();

        const exact = this.reverseI18n.get(raw);
        if (exact) return exact;

        const normRaw = raw.replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
        if (normRaw.length > 2) {
            const normKey = this.normalizedI18n.get(normRaw);
            if (normKey) return normKey;
        }

        // Substring: OCR captured only a suffix/prefix of the true label
        // (e.g. "enville square" is the last 14 chars of "greenville square")
        if (normRaw.length >= 5) {
            for (const [key, value] of this.normalizedI18n) {
                if (key.endsWith(normRaw) || key.startsWith(normRaw) || key.includes(normRaw)) return value;
            }
        }

        if (raw.length >= 4) {
            const fuzzy = this._fuzzyMatchRealmKey(raw);
            if (fuzzy) return this.reverseI18n.get(fuzzy) ?? fuzzy;

            // Broad fuzzy over all map/realm names — require ≥6 chars to avoid short garbage matching
            if (raw.length >= 6) {
                const fuzzyI18n = this._fuzzyMatchI18n(normRaw.length > 2 ? normRaw : raw);
                if (fuzzyI18n) return fuzzyI18n;
            }
        }

        return null;
    }

    _matchLines(lines) {
        console.log(`MapDetector: matching ${lines.length} line(s) against i18n tables`);

        // Pass 1: each line individually
        for (let i = 0; i < lines.length; i++) {
            const raw = lines[i].toLowerCase().trim();
            const result = this._tryMatch(raw);
            console.log(`MapDetector: line [${i}] "${raw}" → ${result ?? 'NO MATCH'}`);
            if (result) {
                console.log(`MapDetector: matched map="${result}"`);
                return { realm: null, map: result };
            }
        }

        // Pass 2: join consecutive lines — catches OCR word-splits like "GRE"+"ENVILLE SQUARE"→"GREENVILLE SQUARE"
        for (let i = 0; i < lines.length - 1; i++) {
            for (let len = 2; len <= Math.min(3, lines.length - i); len++) {
                const chunk = lines.slice(i, i + len).map(l => l.toLowerCase().trim());

                // No separator first: reconstructs a single fragmented word
                const noSep = chunk.join('');
                const r1 = this._tryMatch(noSep);
                if (r1) {
                    console.log(`MapDetector: lines [${i}..${i+len-1}] concat="" → "${r1}"`);
                    return { realm: null, map: r1 };
                }

                // Space separator: catches multi-word labels split across lines
                const withSep = chunk.join(' ');
                const r2 = this._tryMatch(withSep);
                if (r2) {
                    console.log(`MapDetector: lines [${i}..${i+len-1}] concat=" " → "${r2}"`);
                    return { realm: null, map: r2 };
                }
            }
        }

        console.log('MapDetector: no map found in lines');
        return null;
    }

    /** One detection tick: capture → crop → OCR → match → emit */
    async _detect() {
        // Guard: do not start a new tick if the detector was stopped or one is already running
        if (!this.running) return;
        
        if (this._detecting) {
            console.log('MapDetector: detection already in progress, skipping tick');
            return;
        }

        this._detecting = true;
        console.log('MapDetector: --- detection tick start ---');

        try {
            let time = Date.now();

            // capture
            const thumbnail = await this._captureDBD();

            // Re-check after every async suspension so that a stop() call in the meantime
            // prevents the rest of the pipeline from firing show-map-command.
            if (!this.running) return;

            if (!thumbnail || thumbnail.length === 0) {
                console.log('MapDetector: empty capture, skipping tick');
                return;
            }

            console.log(`MapDetector: capture took ${Date.now() - time} ms`);
            time = Date.now();

            // get dimensions for cropping
            const meta = await sharp(thumbnail).metadata();
            const width = meta.width;
            const height = meta.height;

            if (!width || !height) {
                console.log('MapDetector: invalid image metadata');
                return;
            }

            // crop region
            const croppedBuffer = await sharp(thumbnail)
                .extract({
                    left: 0,
                    top: Math.floor(height * 0.65),
                    width: Math.floor(width * 0.45),
                    height: Math.floor(height * 0.30),
                })
                .png()
                .toBuffer();

            if (this.lastCropBuffer?.equals(croppedBuffer)) {
                console.log('MapDetector: crop unchanged, skipping OCR');
                return;
            }

            this.lastCropBuffer = croppedBuffer;
            

            console.log(`MapDetector: crop + extract took ${Date.now() - time} ms`);
            time = Date.now();

            await sharp(croppedBuffer).toFile('debug_crop.png');

            // preprocess
            const imgBuffer = await this._preprocessImage(
                croppedBuffer,
                Math.floor(width * 0.45),
                Math.floor(height * 0.30)
            );
            if (!this.running) return;

            console.log(`MapDetector: preprocess took ${Date.now() - time} ms`);
            time = Date.now();

            await sharp(imgBuffer).toFile('debug_preprocessed.png');

            // ocr
            const lines = await this._ocr(imgBuffer);
            if (!this.running) return;

            console.log(`MapDetector: OCR took ${Date.now() - time} ms`);

            if (!lines.length) {
                console.log('MapDetector: OCR returned no lines, skipping tick');
                return;
            }

            const match = this._matchLines(lines);
            if (!match) return;

            const detectionKey = match.realm
                ? `${match.realm}/${match.map}`
                : match.map;

            if (detectionKey === this.lastDetected) {
                console.log(`MapDetector: duplicate detection "${detectionKey}", suppressed`);
                return;
            }

            this.lastDetected = detectionKey;

            console.log(`MapDetector: matched → ${detectionKey}`);
            this.mainWindow.send(
                'show-map-command',
                detectionKey.replace(/'/g, '').trim()
            );

        } catch (err) {
            console.error('MapDetector::_detect:', err);
        } finally {
            this._detecting = false;
        }
    }

    // ── Public ────────────────────────────────────────────────────────────────

    /**
     * Initialises tesseract workers and begins periodic detection.
     * Safe to call multiple times; subsequent calls are no-ops.
     */
    async start() {
        if (this.running) return;
        this.running = true;
        console.log('MapDetector: starting');
        await this._createWorkers();
        this._loop();
    }

    async _loop() {
        try {
            while (this.running) {
                await this._detect();
                await new Promise(r => setTimeout(r, this.intervalMs));
            }
        } catch (err) {
            console.error('MapDetector loop crashed:', err);
            this.running = false;
        }
    }

    /**
     * Stops the detection loop and releases tesseract workers.
     */
    async stop() {
        if (!this.running) return;
        this.running = false;
        console.log('MapDetector: stopping');

        clearInterval(this.timer);
        this.timer = null;
        this.lastDetected = null;
        this.lastCropBuffer = null;
        this._detecting = false;

        await this._destroyWorkers();
    }
}

module.exports = MapDetector;
