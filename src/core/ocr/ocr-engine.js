'use strict';

/**
 * OcrEngine — the PaddleOCR sessions themselves.
 *
 * Holds one PaddleOcrService (detection + recognition ONNX sessions) per
 * recognition model key, creates them lazily from <userData>/ocr-models via
 * ModelStore and runs inference on raw RGB pixels, one frame at a time.
 *
 * It is plain Node: OcrService runs it inside a worker thread (ocr-worker.js)
 * so inference never blocks the Electron main event loop, and the tests can
 * also drive it in-process. It never touches Electron or encoded images; the
 * crop/RGB conversion happens before the pixels get here (frame.js).
 */

const fs = require('fs');
const { ModelStore } = require('./model-store');
const { assetsForRecognitionKey, recognitionModelsFor } = require('./model-catalog');

/** Error codes the UI can tell apart (see MapDetector._sendModelStatus). */
const ERROR_CODES = {
    /** onnxruntime-node/paddleocr could not be loaded (e.g. missing VC++ runtime on Windows). */
    NATIVE_LOAD_FAILED: 'OCR_NATIVE_LOAD_FAILED',
    /** Every download source failed (set by ModelStore). */
    MODEL_DOWNLOAD_FAILED: 'OCR_MODEL_DOWNLOAD_FAILED',
    /** The runtime rejected the model files on disk; they were deleted so the next try downloads them again. */
    MODEL_CORRUPT: 'OCR_MODEL_CORRUPT',
    /** The call was queued before dispose(): its sessions are gone. */
    DISPOSED: 'OCR_DISPOSED',
};

function codedError(message, code, cause) {
    const err = new Error(message);
    err.code = code;
    if (cause) err.cause = cause;
    return err;
}

let runtime = null;

/**
 * Loads the native runtime once. Required lazily: both packages pull in
 * native/ESM code that the rest of the app (and the unit tests) must not pay
 * for at startup, and a load failure must surface as a distinct error.
 */
function loadRuntime() {
    if (runtime) return runtime;
    try {
        const ort = require('onnxruntime-node');
        // Before the first session: ort reads the level once, at init. 'warning'
        // (the default) prints a "Removing initializer ..." line per unused
        // initializer of every model on every session creation.
        ort.env.logLevel = 'error';
        const { PaddleOcrService } = require('paddleocr');
        runtime = { ort, PaddleOcrService };
        return runtime;
    } catch (err) {
        throw codedError(`Could not load the OCR runtime (onnxruntime-node): ${err.message}`, ERROR_CODES.NATIVE_LOAD_FAILED, err);
    }
}

class OcrEngine {
    /**
     * @param {object} options
     * @param {string} options.modelsDir directory holding the downloaded models
     * @param {(progress: {modelId: string, receivedBytes: number, totalBytes: number}) => void} [options.onDownloadProgress]
     * @param {ModelStore} [options.store] injected store (tests)
     * @param {(key: string) => Promise<object>} [options.createService] injected session factory (tests)
     */
    constructor({ modelsDir, onDownloadProgress, store, createService }) {
        this.store = store || new ModelStore(modelsDir);
        this.onDownloadProgress = onDownloadProgress || null;
        if (createService) this._create = createService;

        /** @type {Map<string, Promise<object>>} recognition key → ready service */
        this._services = new Map();

        /** Serializes inference: one frame at a time. */
        this._queue = Promise.resolve();

        /** Bumped by dispose(); work queued under an older epoch is dropped. */
        this._epoch = 0;
    }

    /**
     * Makes sure the models for a language are on disk and loaded.
     * @param {string} language tesseract language code from the ocrLanguage setting
     */
    async prepare(language) {
        for (const key of recognitionModelsFor(language)) {
            await this._service(key);
        }
    }

    /** @param {string} key recognition model key */
    async _service(key) {
        if (this._services.has(key)) return this._services.get(key);
        const created = this._create(key);
        this._services.set(key, created);
        try {
            return await created;
        } catch (err) {
            if (this._services.get(key) === created) this._services.delete(key);
            throw err;
        }
    }

    async _create(key) {
        const { ort, PaddleOcrService } = loadRuntime();

        const assets = assetsForRecognitionKey(key);
        const loaded = await Promise.all(assets.map(asset => this.store.ensure(asset, this.onDownloadProgress)));
        const [detection, recognition] = loaded;

        const toArrayBuffer = (buffer) => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        let service;
        try {
            service = await PaddleOcrService.createInstance({
                ort,
                modelPreset: 'PP-OCRv5_mobile',
                detection: { modelBuffer: toArrayBuffer(fs.readFileSync(detection.modelPath)) },
                recognition: {
                    modelBuffer: toArrayBuffer(fs.readFileSync(recognition.modelPath)),
                    charactersDictionary: recognition.dictionary,
                },
            });
        } catch (err) {
            // The runtime loaded but rejected the files: a corrupt or partial model
            // (older builds wrote the onnx in place). Drop them so the next attempt
            // downloads clean copies instead of failing forever.
            for (const asset of assets) {
                try { this.store.remove(asset.id); } catch { /* best effort */ }
            }
            throw codedError(`OCR model "${key}" could not be loaded and was removed for re-download: ${err.message}`, ERROR_CODES.MODEL_CORRUPT, err);
        }
        console.log(`OcrEngine: recognition model "${key}" ready`);
        return service;
    }

    /**
     * Runs OCR on raw RGB pixels. With no language hint ('all') the script groups
     * are tried in order and the first that reads anything wins, so an
     * unconfigured setup still works — it just costs an extra pass.
     *
     * @param {{width: number, height: number, data: Uint8Array}} pixels
     * @param {string} language
     * @returns {Promise<{items: Array<{text: string, confidence: number, box: object}>, text: string}>}
     */
    recognize(pixels, language) {
        const epoch = this._epoch;
        const stale = () => {
            if (epoch !== this._epoch) throw codedError('OCR engine was disposed while this frame was queued', ERROR_CODES.DISPOSED);
        };
        return this._enqueue(async () => {
            stale();
            let first = null;
            for (const key of recognitionModelsFor(language)) {
                const service = await this._service(key);
                stale();
                const results = await service.recognize(pixels);
                const parsed = service.processRecognition(results);
                const items = (parsed.lines || []).flat();
                if (!first) first = { items, text: parsed.text || '' };
                if (items.length > 0) return { items, text: parsed.text || '' };
            }
            return first || { items: [], text: '' };
        });
    }

    /** Runs one operation at a time: inference is CPU bound and frames arrive on a poll. */
    _enqueue(task) {
        const run = this._queue.then(task, task);
        this._queue = run.catch(() => {});
        return run;
    }

    /**
     * Releases the ONNX sessions (called when detection is switched off or the
     * game language changes). Returns without waiting for anything slow:
     *  - ready sessions are destroyed through the inference queue, i.e. only
     *    after the frame currently being read is done with them;
     *  - sessions still loading (possibly mid-download) are destroyed whenever
     *    they finish, instead of holding the caller up for the download.
     * Work queued before the call is dropped (OCR_DISPOSED); the next recognize()
     * or prepare() creates fresh sessions.
     */
    async dispose() {
        const pending = [...this._services.values()];
        this._services.clear();
        this._epoch++;
        for (const loading of pending) {
            loading.then(
                service => this._enqueue(() => this._destroy(service)),
                () => { /* never initialized: nothing to release */ },
            );
        }
    }

    async _destroy(service) {
        try {
            // paddleocr 1.2 names it destroy(); it releases both ONNX sessions.
            if (typeof service?.destroy === 'function') await service.destroy();
            else if (typeof service?.dispose === 'function') await service.dispose();
        } catch (err) {
            console.warn(`OcrEngine: failed to release an OCR session: ${err.message}`);
        }
    }

    /** @returns {Promise<void>} resolves once everything queued so far has run (tests, shutdown). */
    whenIdle() {
        return this._queue.then(() => new Promise(resolve => setImmediate(resolve))).then(() => this._queue);
    }
}

module.exports = { OcrEngine, ERROR_CODES, loadRuntime };
