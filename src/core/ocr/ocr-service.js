'use strict';

/**
 * OcrService — PaddleOCR inference for the main process.
 *
 * Runs the PaddleOCR ONNX detection + recognition pipeline with
 * onnxruntime-node, so the detector stays entirely in the backend: no hidden
 * renderer window, no WASM host, no IPC hop. Models come from
 * <userData>/ocr-models via ModelStore, one recognition model per script group
 * (see model-catalog.js), created lazily and cached for the session.
 *
 * Callers pass a PNG buffer plus an optional fractional ROI; the crop, the
 * RGB conversion and the inference all happen here. Images are fed raw —
 * PaddleOCR's own pre-processing beats the blur/threshold chain that was tuned
 * for tesseract, and reading the untouched crop measured both faster and more
 * accurate on the capture fixtures.
 *
 * Usage:
 *   const ocr = new OcrService({ modelsDir });
 *   const { items, text } = await ocr.recognize(pngBuffer, { language: 'eng' });
 *   await ocr.dispose();
 */

const fs = require('fs');
const sharp = require('sharp');
const { ModelStore } = require('./model-store');
const { assetsForRecognitionKey, recognitionModelsFor } = require('./model-catalog');

class OcrService {
    /**
     * @param {object} options
     * @param {string} options.modelsDir directory holding the downloaded models
     * @param {string|(() => string)} [options.language] game language code, used when a call does not pass one
     * @param {(progress: {modelId: string, receivedBytes: number, totalBytes: number}) => void} [options.onDownloadProgress]
     */
    constructor({ modelsDir, language, onDownloadProgress }) {
        this.store = new ModelStore(modelsDir);
        this.language = language || 'all';
        this.onDownloadProgress = onDownloadProgress || null;

        /** The caller picks the language in Settings while the app is running. */
        this._language = () => (typeof this.language === 'function' ? this.language() : this.language);

        /** @type {Map<string, Promise<object>>} recognition key → ready service */
        this._services = new Map();

        /** Serializes inference: one frame at a time per service. */
        this._queue = Promise.resolve();
    }

    /**
     * Makes sure the models for a language are on disk.
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
            this._services.delete(key);
            throw err;
        }
    }

    async _create(key) {
        // Required lazily: both pull in native/ESM code that the rest of the app
        // (and the unit tests) must not pay for at startup.
        const ort = require('onnxruntime-node');
        const { PaddleOcrService } = require('paddleocr');

        const assets = assetsForRecognitionKey(key);
        const loaded = await Promise.all(assets.map(asset => this.store.ensure(asset, this.onDownloadProgress)));
        const [detection, recognition] = loaded;

        const toArrayBuffer = (buffer) => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        const service = await PaddleOcrService.createInstance({
            ort,
            modelPreset: 'PP-OCRv5_mobile',
            detection: { modelBuffer: toArrayBuffer(fs.readFileSync(detection.modelPath)) },
            recognition: {
                modelBuffer: toArrayBuffer(fs.readFileSync(recognition.modelPath)),
                charactersDictionary: recognition.dictionary,
            },
        });
        console.log(`OcrService: recognition model "${key}" ready`);
        return service;
    }

    /**
     * Converts a PNG buffer into the raw RGB pixels the runtime expects.
     * The ROI is fractional; width/height default to "the rest of the frame",
     * so {x: 0.75, y: 0.9} means the bottom-right corner.
     * @param {Buffer} pngBuffer
     * @param {{x: number, y: number, width?: number, height?: number}} [roi]
     */
    async _pixels(pngBuffer, roi) {
        let image = sharp(pngBuffer);
        if (roi) {
            const meta = await image.metadata();
            const frameWidth = meta.width || 0;
            const frameHeight = meta.height || 0;
            const x = Math.min(Math.max(roi.x || 0, 0), 1);
            const y = Math.min(Math.max(roi.y || 0, 0), 1);
            const boxWidth = roi.width ?? (1 - x);
            const boxHeight = roi.height ?? (1 - y);
            image = sharp(pngBuffer).extract({
                left: Math.round(frameWidth * x),
                top: Math.round(frameHeight * y),
                width: Math.max(1, Math.round(frameWidth * Math.min(boxWidth, 1 - x))),
                height: Math.max(1, Math.round(frameHeight * Math.min(boxHeight, 1 - y))),
            });
        }
        const { data, info } = await image
            .toColourspace('srgb')
            .removeAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
        return { width: info.width, height: info.height, data };
    }

    /**
     * Runs OCR on one frame. With no language hint ('all') the script groups are
     * tried in order and the first that reads anything wins, so an unconfigured
     * setup still works — it just costs an extra pass.
     *
     * @param {Buffer} pngBuffer screenshot (PNG)
     * @param {{language?: string, roi?: {x: number, y: number, width: number, height: number}}} [options]
     * @returns {Promise<{items: Array<{text: string, confidence: number, box: object}>, text: string}>}
     */
    async recognize(pngBuffer, { language, roi } = {}) {
        const lang = language || this._language();
        const pixels = await this._pixels(pngBuffer, roi);
        return this._enqueue(async () => {
            let first = null;
            for (const key of recognitionModelsFor(lang)) {
                const service = await this._service(key);
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

    /** Releases the ONNX sessions (called when detection stops). */
    async dispose() {
        const services = [...this._services.values()];
        this._services.clear();
        for (const pending of services) {
            try {
                const service = await pending;
                await service?.dispose?.();
            } catch {
                // a service that never initialized has nothing to release
            }
        }
    }
}

module.exports = { OcrService };
