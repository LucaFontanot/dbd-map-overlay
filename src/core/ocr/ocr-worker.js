'use strict';

/**
 * Worker-thread host for OcrEngine (spawned by OcrService).
 *
 * Inference costs 150-250 ms of pure CPU per frame. Run on the Electron main
 * thread, that froze IPC, overlay moves and hotkeys for the whole call; here it
 * runs on its own thread, still plain Node with onnxruntime-node (never a
 * renderer). Model downloads happen here too.
 *
 * Protocol (all messages are plain objects):
 *   in:  {id, type: 'prepare', language}
 *        {id, type: 'recognize', language, pixels: {width, height, data: Uint8Array}}
 *        {id, type: 'dispose'}
 *   out: {id, ok: true, result} | {id, ok: false, error: {message, code}}
 *        {type: 'progress', progress}   (model download progress)
 */

const { parentPort, workerData } = require('worker_threads');
const { OcrEngine } = require('./ocr-engine');

const engine = new OcrEngine({
    modelsDir: workerData.modelsDir,
    onDownloadProgress: (progress) => parentPort.postMessage({ type: 'progress', progress }),
});

const handlers = {
    prepare: (msg) => engine.prepare(msg.language),
    recognize: (msg) => engine.recognize(msg.pixels, msg.language),
    dispose: () => engine.dispose(),
};

parentPort.on('message', async (msg) => {
    const handler = handlers[msg && msg.type];
    if (!handler) {
        parentPort.postMessage({ id: msg && msg.id, ok: false, error: { message: `Unknown OCR worker request: ${msg && msg.type}` } });
        return;
    }
    try {
        const result = await handler(msg);
        parentPort.postMessage({ id: msg.id, ok: true, result: result === undefined ? null : result });
    } catch (err) {
        parentPort.postMessage({ id: msg.id, ok: false, error: { message: err && err.message || String(err), code: err && err.code } });
    }
});
