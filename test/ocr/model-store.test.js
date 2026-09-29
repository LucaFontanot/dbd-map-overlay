const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const yaml = require('js-yaml');
const { ModelStore, extractTarEntries, readDictionary, defaultModelsDir } = require('../../src/core/ocr/model-store');

// ── Synthetic ustar archive ─────────────────────────────────────────────────
// Built by hand so the store's tar reader is exercised without downloading 8 MB.

function tarEntry(name, content, type = '0') {
    const data = Buffer.from(content);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, 'utf8');
    header.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 'utf8');
    header.write(type, 156, 'utf8');
    const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
    return Buffer.concat([header, data, padding]);
}

const ONNX_BYTES = Buffer.from('not really onnx, just bytes for the extractor');
const YML = yaml.dump({ Global: { model_name: 'tiny_rec' }, PostProcess: { name: 'CTCLabelDecode', character_dict: ['a', 'b', 'c'] } });

function buildArchive() {
    return Buffer.concat([
        tarEntry('tiny_rec/inference.onnx', ONNX_BYTES),
        tarEntry('tiny_rec/inference.yml', YML),
        tarEntry('tiny_rec/PaxHeader/ignored', 'ignored', 'x'),
        Buffer.alloc(1024), // end-of-archive marker
    ]);
}

test('extracts the inference files and skips tar metadata entries', () => {
    const entries = extractTarEntries(buildArchive());
    assert.deepEqual([...entries.keys()].sort(), ['tiny_rec/inference.onnx', 'tiny_rec/inference.yml']);
    assert.equal(entries.get('tiny_rec/inference.onnx').length, ONNX_BYTES.length);
});

test('reads the CTC dictionary out of inference.yml and appends the trailing space class', () => {
    // PaddleX lists the dictionary without the space class the model is trained
    // with; without it the runtime rejects the dictionary as too short.
    assert.deepEqual(readDictionary(Buffer.from(YML)), ['a', 'b', 'c', ' ']);
});

test('detection archives carry no dictionary and that is not an error', () => {
    const detYml = yaml.dump({ Global: { model_name: 'det' }, PreProcess: {} });
    assert.equal(readDictionary(Buffer.from(detYml)), null);
});

test('rejects a malformed dictionary instead of silently using it', () => {
    const broken = yaml.dump({ PostProcess: { character_dict: { a: 'b' } } });
    assert.throws(() => readDictionary(Buffer.from(broken)), /malformed PostProcess.character_dict/);
});

test('defaultModelsDir honours OCR_MODELS_DIR', () => {
    const previous = process.env.OCR_MODELS_DIR;
    process.env.OCR_MODELS_DIR = '/tmp/some-models';
    try {
        assert.equal(defaultModelsDir(), '/tmp/some-models');
    } finally {
        if (previous === undefined) delete process.env.OCR_MODELS_DIR; else process.env.OCR_MODELS_DIR = previous;
    }
});

test('ensure() downloads, unpacks and caches a model, and reuses the cache afterwards', async () => {
    const archive = buildArchive();
    let requests = 0;
    const server = http.createServer((req, res) => {
        requests++;
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        res.end(archive);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-models-test-'));
    const store = new ModelStore(modelsDir);
    const asset = { id: 'tiny_rec', url: `http://127.0.0.1:${port}/tiny_rec.tar`, bytes: archive.length };

    try {
        assert.equal(store.has('tiny_rec'), false);
        const progress = [];
        const loaded = await store.ensure(asset, (p) => progress.push(p));

        assert.equal(store.has('tiny_rec'), true);
        assert.equal(fs.readFileSync(loaded.modelPath).length, ONNX_BYTES.length);
        assert.deepEqual(loaded.dictionary, ['a', 'b', 'c', ' ']);
        assert.equal(loaded.modelPath, path.join(modelsDir, 'tiny_rec', 'inference.onnx'));
        assert.ok(progress.length > 0, 'download progress should be reported');
        assert.equal(progress.at(-1).modelId, 'tiny_rec');
        assert.ok(!fs.existsSync(path.join(modelsDir, 'tiny_rec.tar.part')), 'the partial download must be cleaned up');

        await store.ensure(asset);
        assert.equal(requests, 1, 'the second call must come from the cache, not the network');
    } finally {
        server.close();
        fs.rmSync(modelsDir, { recursive: true, force: true });
    }
});
