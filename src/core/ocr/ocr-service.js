'use strict';

/**
 * OcrService — PaddleOCR inference for the main process.
 *
 * Runs the PaddleOCR ONNX detection + recognition pipeline with
 * onnxruntime-node, so the detector stays entirely in the backend: no hidden
 * renderer window, no WASM host, no IPC hop. Models come from
 * <userData>/ocr-models via ModelStore, one recognition model per script group
 * (see model-catalog.js), created lazily and kept until dispose().
 *
 * Callers pass a frame (encoded image Buffer or raw capture, see frame.js) plus
 * an optional fractional ROI; the crop and the RGB conversion happen here on
 * sharp's thread pool, the inference in OcrEngine inside a worker thread
 * (ocr-worker.js), so the 150-250 ms of CPU per frame never blocks the
 * Electron main event loop. Only the cropped RGB pixels cross the thread
 * boundary, transferred rather than copied. Images are fed raw —
 * PaddleOCR's own pre-processing beats the blur/threshold chain that was tuned
 * for tesseract, and reading the untouched crop measured both faster and more
 * accurate on the capture fixtures.
 *
 * Usage:
 *   const ocr = new OcrService({ modelsDir });
 *   const { items, text } = await ocr.recognize(pngBuffer, { language: 'eng' });
 *   await ocr.dispose();
 */

const path = require('path');
const { Worker } = require('worker_threads');
const { OcrEngine, ERROR_CODES } = require('./ocr-engine');
const { framePixels } = require('./frame');

/** Worker crashed or could not start (distinct from the runtime failing to load inside it). */
const WORKER_FAILED = 'OCR_WORKER_FAILED';

// Resolved from __dirname so it also works from inside app.asar (Electron
// serves asar paths to worker threads; the native libs are asarUnpacked).
const WORKER_SCRIPT = path.join(__dirname, 'ocr-worker.js');

function codedError(message, code) {
    const err = new Error(message);
    if (code) err.code = code;
    return err;
}

class OcrService {
    /**
     * @param {object} options
     * @param {string} options.modelsDir directory holding the downloaded models
     * @param {string|(() => string)} [options.language] game language code, used when a call does not pass one
     * @param {(progress: {modelId: string, receivedBytes: number, totalBytes: number}) => void} [options.onDownloadProgress]
     * @param {boolean} [options.inProcess] run the engine on the calling thread
     *   (no worker); also forced by OCR_IN_PROCESS=1 for debugging
     */
    constructor({ modelsDir, language, onDownloadProgress, inProcess }) {
        this.modelsDir = modelsDir;
        this.language = language || 'all';
        this.onDownloadProgress = onDownloadProgress || null;
        this.inProcess = inProcess ?? process.env.OCR_IN_PROCESS === '1';

        /** The caller picks the language in Settings while the app is running. */
        this._language = () => (typeof this.language === 'function' ? this.language() : this.language);

        /** @type {OcrEngine|null} in-process engine (inProcess mode only) */
        this._engine = null;
        /** @type {Worker|null} */
        this._worker = null;
        /** @type {Map<number, {resolve: Function, reject: Function}>} */
        this._pending = new Map();
        this._nextId = 1;
    }

    /**
     * Makes sure the models for a language are on disk and loaded.
     * @param {string} [language] tesseract language code from the ocrLanguage setting
     */
    async prepare(language) {
        await this._call('prepare', { language: language || this._language() });
    }

    /**
     * Runs OCR on one frame. With no language hint ('all') the script groups are
     * tried in order and the first that reads anything wins.
     *
     * @param {Buffer|{data: Buffer, width: number, height: number, channels?: number}} frame screenshot (encoded image or raw capture)
     * @param {{language?: string, roi?: {x: number, y: number, width?: number, height?: number}}} [options]
     * @returns {Promise<{items: Array<{text: string, confidence: number, box: object}>, text: string}>}
     */
    async recognize(frame, { language, roi } = {}) {
        const lang = language || this._language();
        const pixels = await framePixels(frame, roi);
        if (this.inProcess) return this._local().recognize(pixels, lang);
        // Copy into a buffer we own (sharp's output may not be detachable) and
        // transfer it: the worker gets the bytes without a second copy.
        const data = new Uint8Array(pixels.data.length);
        data.set(pixels.data);
        return this._call('recognize', { language: lang, pixels: { width: pixels.width, height: pixels.height, data } }, [data.buffer]);
    }

    /**
     * Releases the ONNX sessions (detection switched off / language changed).
     * Does not wait for in-flight inference or pending downloads; see
     * OcrEngine.dispose(). The worker thread itself stays up for the next start.
     */
    async dispose() {
        if (this.inProcess) {
            if (this._engine) await this._engine.dispose();
            return;
        }
        if (!this._worker) return; // nothing was ever loaded
        await this._call('dispose', {});
    }

    _local() {
        if (!this._engine) {
            this._engine = new OcrEngine({
                modelsDir: this.modelsDir,
                onDownloadProgress: (progress) => this.onDownloadProgress && this.onDownloadProgress(progress),
            });
        }
        return this._engine;
    }

    _call(type, payload, transfer) {
        if (this.inProcess) {
            const engine = this._local();
            if (type === 'prepare') return engine.prepare(payload.language);
            if (type === 'dispose') return engine.dispose();
            throw new Error(`unsupported in-process call ${type}`);
        }
        let worker;
        try {
            worker = this._ensureWorker();
        } catch (err) {
            return Promise.reject(codedError(`Could not start the OCR worker: ${err.message}`, WORKER_FAILED));
        }
        const id = this._nextId++;
        return new Promise((resolve, reject) => {
            this._pending.set(id, { resolve, reject });
            // Keep the process alive only while a request is outstanding, so a
            // CLI script that is done does not hang on an idle worker.
            worker.ref();
            worker.postMessage({ id, type, ...payload }, transfer || []);
        });
    }

    _ensureWorker() {
        if (this._worker) return this._worker;
        const worker = new Worker(WORKER_SCRIPT, { workerData: { modelsDir: this.modelsDir } });
        worker.unref();
        worker.on('message', (msg) => this._onMessage(msg));
        worker.on('error', (err) => this._onWorkerGone(worker, codedError(`OCR worker crashed: ${err && err.message || err}`, WORKER_FAILED)));
        worker.on('exit', (code) => this._onWorkerGone(worker, codedError(`OCR worker exited (code ${code})`, WORKER_FAILED)));
        this._worker = worker;
        return worker;
    }

    _onMessage(msg) {
        if (msg && msg.type === 'progress') {
            if (this.onDownloadProgress) this.onDownloadProgress(msg.progress);
            return;
        }
        const pending = this._pending.get(msg && msg.id);
        if (!pending) return;
        this._pending.delete(msg.id);
        if (this._pending.size === 0 && this._worker) this._worker.unref();
        if (msg.ok) pending.resolve(msg.result);
        else pending.reject(codedError(msg.error && msg.error.message || 'OCR worker request failed', msg.error && msg.error.code));
    }

    /** A dead worker fails its outstanding calls; the next call starts a new one. */
    _onWorkerGone(worker, err) {
        if (this._worker !== worker) return;
        this._worker = null;
        const pending = [...this._pending.values()];
        this._pending.clear();
        for (const { reject } of pending) reject(err);
    }

    /** Stops the worker thread for good (process shutdown, tests). */
    async close() {
        if (this._engine) await this._engine.dispose();
        const worker = this._worker;
        this._worker = null;
        if (worker) await worker.terminate();
    }
}

module.exports = { OcrService, ERROR_CODES: { ...ERROR_CODES, WORKER_FAILED } };
