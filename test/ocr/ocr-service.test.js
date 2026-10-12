const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { OcrService } = require('../../src/core/ocr/ocr-service');
const { missingModelsReason, loadFixture, FIXTURE_LANGUAGE } = require('../helpers/ocr');

const SKIP = missingModelsReason();

let ocr;

before(() => {
    ocr = new OcrService({ modelsDir: require('../helpers/ocr').MODELS_DIR, language: FIXTURE_LANGUAGE });
});

after(async () => {
    await ocr.close();
});

test('reads a map-name crop into text items with confidences', async (t) => {
    if (SKIP) return t.skip(SKIP);
    const { items, text } = await ocr.recognize(loadFixture('map-name-crop-forgotten-ruins.png'));
    assert.ok(items.length >= 2, `expected the map and realm lines, got ${JSON.stringify(items)}`);
    assert.match(text, /FORGOTTEN\s*RUINS/i);
    for (const item of items) {
        assert.equal(typeof item.text, 'string');
        assert.ok(item.confidence > 0.5 && item.confidence <= 1, `unexpected confidence ${item.confidence}`);
    }
});

test('crops a fractional ROI before recognising (endgame corner of a 4K frame)', async (t) => {
    if (SKIP) return t.skip(SKIP);
    // Bottom-right corner of the frame: the CONTINUE button, nothing else.
    const { items } = await ocr.recognize(loadFixture('endgame-public-scoreboard.png'), {
        roi: { x: 0.75, y: 0.9 },
    });
    assert.deepEqual(items.map(i => i.text.trim().toUpperCase()), ['CONTINUE']);

    // The same frame read in full must not report the button as a map-name line
    // (it is outside the map-name area the detector reads).
    const full = await ocr.recognize(loadFixture('map-name-crop-forgotten-ruins.png'), {
        roi: { x: 0, y: 0, width: 0.1, height: 0.2 },
    });
    assert.equal(full.items.length, 0);
});

test('keeps working after dispose(): the sessions are reloaded on the next frame', async (t) => {
    if (SKIP) return t.skip(SKIP);
    // The detector disposes the engine when detection is switched off or the game
    // language changes; switching it back on must work without restarting the app.
    const first = await ocr.recognize(loadFixture('map-name-crop-freddy-fazbears-pizza.png'));
    assert.ok(first.items.length > 0);

    await ocr.dispose();

    const second = await ocr.recognize(loadFixture('map-name-crop-freddy-fazbears-pizza.png'));
    assert.ok(second.items.length > 0, 'OCR must come back after dispose()');
    assert.match(second.text, /FREDDY\s*FAZBEAR/i);
});

test('serves concurrent calls without interleaving (one inference at a time)', async (t) => {
    if (SKIP) return t.skip(SKIP);
    const frames = [
        'map-name-crop-forgotten-ruins.png',
        'map-name-crop-freddy-fazbears-pizza.png',
        'map-name-crop-forgotten-ruins.png',
    ];
    const results = await Promise.all(frames.map(f => ocr.recognize(loadFixture(f))));
    assert.match(results[0].text, /FORGOTTEN\s*RUINS/i);
    assert.match(results[1].text, /FREDDY\s*FAZBEAR/i);
    assert.match(results[2].text, /FORGOTTEN\s*RUINS/i);
});

test('runs inference off the calling thread and matches the in-process engine', async (t) => {
    if (SKIP) return t.skip(SKIP);
    const local = new OcrService({ modelsDir: require('../helpers/ocr').MODELS_DIR, language: FIXTURE_LANGUAGE, inProcess: true });
    try {
        const frame = loadFixture('map-name-crop-forgotten-ruins.png');
        const [inWorker, inProcess] = [await ocr.recognize(frame), await local.recognize(frame)];
        assert.ok(ocr._worker, 'the default service must use a worker thread');
        assert.equal(local._worker, null);
        assert.equal(inWorker.text, inProcess.text);
        assert.deepEqual(inWorker.items.map(i => i.text), inProcess.items.map(i => i.text));
    } finally {
        await local.close();
    }
});

test('a crashed worker fails its pending call with OCR_WORKER_FAILED and the next call starts a new one', async (t) => {
    if (SKIP) return t.skip(SKIP);
    const frame = loadFixture('map-name-crop-forgotten-ruins.png');
    await ocr.recognize(frame);
    const pending = ocr.recognize(frame);
    // Let the crop finish and the request reach the worker, then kill it.
    while (ocr._pending.size === 0) await new Promise(r => setImmediate(r));
    await ocr._worker.terminate();
    await assert.rejects(pending, err => err.code === 'OCR_WORKER_FAILED');
    const again = await ocr.recognize(frame);
    assert.match(again.text, /FORGOTTEN\s*RUINS/i);
});
