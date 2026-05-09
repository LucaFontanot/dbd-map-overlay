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

const { desktopCapturer, ipcMain, app } = require('electron');
const { createWorker } = require('tesseract.js');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

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
        this.intervalMs = 10_000;

        /** Maps every localised string (lowercase) to its English key */
        this.reverseI18n = new Map();

        /** English realm names (lowercase) derived from i18n + photo directory */
        this.realmKeys = new Set();

        /** Last matched "realm/map" key — suppresses duplicate events */
        this.lastDetected = null;

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

    /** Creates two tesseract.js workers (one per script group) in parallel */
    async _createWorkers() {
        const cachePath = path.join(app.getPath('userData'), 'tessdata');
        fs.mkdirSync(cachePath, { recursive: true });

        // require.resolve finds the actual installed path in both dev and packaged
        // builds (Electron resolves asarUnpack modules to the real filesystem path).
        const workerPath = path.join(path.dirname(require.resolve('tesseract.js/package.json')), 'src', 'worker-script', 'node', 'index.js');
        const corePath   = path.join(path.dirname(require.resolve('tesseract.js-core/package.json')), 'tesseract-core-simd-lstm.wasm.js');

        console.log(`MapDetector: workerPath: ${workerPath}`);
        console.log(`MapDetector: corePath:   ${corePath}`);
        console.log(`MapDetector: creating ${LANG_GROUPS.length} OCR worker(s), tessdata cache: ${cachePath}`);
        LANG_GROUPS.forEach((langs, i) => console.log(`MapDetector: worker[${i}] langs: ${langs}`));

        // OEM 1 = LSTM-only (fastest accurate model)
        this.workers = await Promise.all(
            LANG_GROUPS.map(langs => createWorker(langs, 1, { cachePath, workerPath, corePath }))
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
        const sources = await desktopCapturer.getSources({
            types: ['window'],
            thumbnailSize: { width: 1920, height: 1080 },
        });
        console.log(`MapDetector: found ${sources.length} window source(s): ${sources.map(s => s.name).join(', ')}`);
        const source = sources.find(s => {
            const name = s.name.toLowerCase();
            return name.includes('deadbydaylight') || name.includes('dead by daylight');
        });
        if (!source) {
            console.log('MapDetector: DBD window not found');
        } else {
            const size = source.thumbnail.getSize();
            console.log(`MapDetector: captured DBD window "${source.name}" (${size.width}x${size.height})`);
        }
        return source ? source.thumbnail : null;
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
     *   4. Negate      — turns white-on-dark into black-on-white (Tesseract default)
     *   5. Threshold   — hard binarise, drops background gradients
     *
     * @param {Buffer} pngBuffer
     * @returns {Promise<Buffer>}
     */
    async _preprocessImage(pngBuffer) {
        const { width, height } = await sharp(pngBuffer).metadata();
        return sharp(pngBuffer)
            .resize(width * 2, height * 2, { kernel: sharp.kernel.lanczos3 })
            .greyscale()
            .normalize()
            .negate()
            .threshold(128)
            .png()
            .toBuffer();
    }

    /**
     * Runs OCR using both worker groups in parallel and merges the
     * resulting text lines.
     *
     * @param {Buffer} imageBuffer  PNG buffer from NativeImage.toPNG()
     * @returns {Promise<string[]>}  Non-empty text lines from all passes
     */
    async _ocr(imageBuffer) {
        console.log(`MapDetector: running OCR on ${imageBuffer.length} byte image with ${this.workers.length} worker(s)`);
        // PSM 11 = sparse text — best for isolated game UI labels on complex backgrounds
        const results = await Promise.allSettled(
            this.workers.map(w => w.recognize(imageBuffer, { tessedit_pageseg_mode: '11' }))
        );
        const seen = new Set();
        const lines = [];
        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            if (result.status !== 'fulfilled') {
                console.warn(`MapDetector: worker[${i}] OCR failed: ${result.reason}`);
                continue;
            }
            const data = result.value.data;
            // Prefer structured lines; fall back to splitting the raw text string
            const workerLines = (data.lines ?? []).length > 0
                ? data.lines.map(l => l.text.trim())
                : (data.text ?? '').split('\n').map(t => t.trim());
            const kept = workerLines.filter(t => t.length > 1);
            console.log(`MapDetector: worker[${i}] raw lines: ${workerLines.length}, kept: ${kept.length}${kept.length ? ' → ' + kept.join(' | ') : ''}`);
            for (const line of kept) {
                const key = line.toLowerCase().trim();
                if (!seen.has(key)) { seen.add(key); lines.push(line); }
            }
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
    _matchLines(lines) {
        console.log(`MapDetector: matching ${lines.length} line(s) against i18n tables`);
        for (let i = 0; i < lines.length; i++) {
            const raw = lines[i].toLowerCase().trim();
            const key = this.reverseI18n.get(raw);
            console.log(`MapDetector: line [${i}] "${raw}" → ${key ?? 'NO MATCH'}`);
            if (key) {
                console.log(`MapDetector: matched map="${key}"`);
                return { realm: null, map: key };
            }
        }
        console.log('MapDetector: no map found in lines');
        return null;
    }

    /** One detection tick: capture → crop → OCR → match → emit */
    async _detect() {
        console.log('MapDetector: --- detection tick start ---');
        try {
            let time = new Date().getTime();
            const thumbnail = await this._captureDBD();
            if (!thumbnail || thumbnail.isEmpty()) {
                console.log('MapDetector: no DBD thumbnail, skipping tick');
                return;
            }
            console.log(`MapDetector: capture took ${new Date().getTime() - time} ms`);
            time = new Date().getTime();
            const cropped    = this._cropForText(thumbnail);
            const imgBuffer  = await this._preprocessImage(cropped.toPNG());
            const lines      = await this._ocr(imgBuffer);
            console.log(`MapDetector: OCR took ${new Date().getTime() - time} ms`);
            if (lines.length === 0) {
                console.log('MapDetector: OCR returned no lines, skipping tick');
                return;
            }

            const match = this._matchLines(lines);
            if (!match) return;

            // "realm/map" gives findClosestMapMatch() in images.js enough
            // specificity to locate the correct file without ambiguity.
            const detectionKey = match.realm ? `${match.realm}/${match.map}` : match.map;
            if (detectionKey === this.lastDetected) {
                console.log(`MapDetector: duplicate detection "${detectionKey}", suppressed`);
                return;
            }
            this.lastDetected = detectionKey;

            console.log(`MapDetector: matched → ${detectionKey}`);
            this.mainWindow.send('show-map-command', detectionKey);
        } catch (err) {
            console.error('MapDetector::_detect:', err.message);
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

        this._detect(); // immediate first scan
        this.timer = setInterval(() => this._detect(), this.intervalMs);
    }

    /**
     * Stops the detection loop and releases tesseract workers.
     */
    stop() {
        if (!this.running) return;
        this.running = false;
        console.log('MapDetector: stopping');

        clearInterval(this.timer);
        this.timer = null;
        this.lastDetected = null;

        this._destroyWorkers();
    }
}

module.exports = MapDetector;
