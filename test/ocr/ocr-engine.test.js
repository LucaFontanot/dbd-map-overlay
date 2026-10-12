const { test } = require('node:test');
const assert = require('node:assert/strict');
const { OcrEngine, ERROR_CODES } = require('../../src/core/ocr/ocr-engine');

const PIXELS = { width: 1, height: 1, data: new Uint8Array(3) };

/** A stand-in PaddleOcrService that records lifecycle calls. */
function fakeService(log, name, { delayMs = 0 } = {}) {
    return {
        destroyed: false,
        async recognize() {
            log.push(`${name}:recognize:start`);
            await new Promise(r => setTimeout(r, delayMs));
            log.push(`${name}:recognize:end`);
            return [{ text: 'x', confidence: 1, box: { x: 0, y: 0, width: 1, height: 1 } }];
        },
        processRecognition(results) { return { text: 'x', lines: [results] }; },
        async destroy() { this.destroyed = true; log.push(`${name}:destroy`); },
    };
}

test('dispose() destroys the sessions (paddleocr names it destroy())', async () => {
    const log = [];
    const services = [];
    const engine = new OcrEngine({
        modelsDir: '/nonexistent',
        createService: async () => { const s = fakeService(log, `s${services.length}`); services.push(s); return s; },
    });
    await engine.recognize(PIXELS, 'eng');
    await engine.dispose();
    await engine.whenIdle();
    assert.equal(services[0].destroyed, true);

    // The next frame creates a fresh session.
    await engine.recognize(PIXELS, 'eng');
    assert.equal(services.length, 2);
    assert.equal(services[1].destroyed, false);
});

test('dispose() waits for the frame being read before destroying its session', async () => {
    const log = [];
    const engine = new OcrEngine({ modelsDir: '/nonexistent', createService: async () => fakeService(log, 's', { delayMs: 50 }) });
    await engine.prepare('eng');
    const inFlight = engine.recognize(PIXELS, 'eng');
    await new Promise(r => setTimeout(r, 10)); // inference started
    await engine.dispose();
    await inFlight;
    await engine.whenIdle();
    assert.deepEqual(log, ['s:recognize:start', 's:recognize:end', 's:destroy']);
});

test('dispose() does not wait for a model still downloading, and frees it once it arrives', async () => {
    let finishLoad;
    const service = fakeService([], 'slow');
    const engine = new OcrEngine({
        modelsDir: '/nonexistent',
        createService: () => new Promise(resolve => { finishLoad = () => resolve(service); }),
    });
    const preparing = engine.prepare('eng').catch(() => {});
    const started = Date.now();
    await engine.dispose();
    assert.ok(Date.now() - started < 50, 'dispose must return without waiting for the download');

    finishLoad();
    await preparing;
    await engine.whenIdle();
    assert.equal(service.destroyed, true, 'the late session must still be released');
});

test('frames queued before dispose() are dropped instead of recreating sessions', async () => {
    const log = [];
    let created = 0;
    const engine = new OcrEngine({ modelsDir: '/nonexistent', createService: async () => { created++; return fakeService(log, 's', { delayMs: 20 }); } });
    await engine.prepare('eng');
    const first = engine.recognize(PIXELS, 'eng');
    const queued = engine.recognize(PIXELS, 'eng');
    await new Promise(r => setTimeout(r, 5)); // first frame in flight, second still queued
    await engine.dispose();
    await first;
    await assert.rejects(queued, err => err.code === ERROR_CODES.DISPOSED);
    await engine.whenIdle();
    assert.equal(created, 1, 'a dropped frame must not load a new session');
});

test('a failed session load is not cached: the next call retries', async () => {
    let calls = 0;
    const engine = new OcrEngine({
        modelsDir: '/nonexistent',
        createService: async () => {
            calls++;
            if (calls === 1) throw Object.assign(new Error('boom'), { code: ERROR_CODES.MODEL_DOWNLOAD_FAILED });
            return fakeService([], 's');
        },
    });
    await assert.rejects(engine.prepare('eng'), err => err.code === ERROR_CODES.MODEL_DOWNLOAD_FAILED);
    await engine.prepare('eng');
    assert.equal(calls, 2);
});
