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

/** Serves fixed responses by path; counts requests. */
async function serve(routes) {
    const server = http.createServer((req, res) => {
        server.requests.push(req.url);
        const body = routes[req.url];
        if (body === undefined) {
            res.writeHead(404);
            res.end();
            return;
        }
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        res.end(body);
    });
    server.requests = [];
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    server.base = `http://127.0.0.1:${server.address().port}`;
    return server;
}

function tempModelsDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-models-test-'));
}

/** Only the given sources: keeps the tests off the network (no HuggingFace probe). */
const onlyTar = (asset) => [{ kind: 'tar', label: 'local archive', url: asset.url, attempts: 1 }];

test('ensure() downloads, unpacks and caches a model, and reuses the cache afterwards', async () => {
    const archive = buildArchive();
    const server = await serve({ '/tiny_rec.tar': archive });
    const modelsDir = tempModelsDir();
    const store = new ModelStore(modelsDir, { sourcesFor: onlyTar });
    const asset = { id: 'tiny_rec', kind: 'recognition', url: `${server.base}/tiny_rec.tar`, bytes: ONNX_BYTES.length };

    try {
        assert.equal(store.has(asset), false);
        const progress = [];
        const loaded = await store.ensure(asset, (p) => progress.push(p));

        assert.equal(store.has(asset), true);
        assert.equal(fs.readFileSync(loaded.modelPath).length, ONNX_BYTES.length);
        assert.deepEqual(loaded.dictionary, ['a', 'b', 'c', ' ']);
        assert.equal(loaded.modelPath, path.join(modelsDir, 'tiny_rec', 'inference.onnx'));
        assert.ok(progress.length > 0, 'download progress should be reported');
        assert.equal(progress.at(-1).modelId, 'tiny_rec');
        assert.ok(!fs.existsSync(path.join(modelsDir, 'tiny_rec', 'inference.onnx.tmp')), 'the temporary model file must be renamed into place');

        await store.ensure(asset);
        assert.equal(server.requests.length, 1, 'the second call must come from the cache, not the network');
    } finally {
        server.close();
        fs.rmSync(modelsDir, { recursive: true, force: true });
    }
});

test('a truncated download is rejected and the next source is tried', async () => {
    const server = await serve({
        '/short/inference.onnx': ONNX_BYTES.subarray(0, 5),
        '/short/inference.yml': YML,
        '/tiny_rec.tar': buildArchive(),
    });
    const modelsDir = tempModelsDir();
    const store = new ModelStore(modelsDir, {
        sourcesFor: (asset) => [
            { kind: 'files', label: 'short mirror', base: `${server.base}/short`, onnx: 'inference.onnx', dictionary: 'inference.yml', dictionaryFormat: 'yml', attempts: 1 },
            ...onlyTar(asset),
        ],
    });
    const asset = { id: 'tiny_rec', kind: 'recognition', url: `${server.base}/tiny_rec.tar`, bytes: ONNX_BYTES.length };
    try {
        const loaded = await store.ensure(asset);
        assert.equal(fs.readFileSync(loaded.modelPath).length, ONNX_BYTES.length);
        assert.ok(server.requests.includes('/tiny_rec.tar'), 'the truncated source must fall through to the archive');
    } finally {
        server.close();
        fs.rmSync(modelsDir, { recursive: true, force: true });
    }
});

test('a recognition model without its dictionary is a failed source, not a usable model', async () => {
    const server = await serve({ '/nodict/inference.onnx': ONNX_BYTES });
    const modelsDir = tempModelsDir();
    const store = new ModelStore(modelsDir, {
        sourcesFor: () => [
            { kind: 'files', label: 'no-dict mirror', base: `${server.base}/nodict`, onnx: 'inference.onnx', dictionary: 'dict.txt', dictionaryFormat: 'txt', attempts: 1 },
        ],
    });
    const asset = { id: 'tiny_rec', kind: 'recognition', url: `${server.base}/missing.tar`, bytes: ONNX_BYTES.length };
    try {
        await assert.rejects(store.ensure(asset), (err) => err.code === 'OCR_MODEL_DOWNLOAD_FAILED' && /without its dictionary/.test(err.message));
        assert.equal(store.has(asset), false, 'nothing usable may be left on disk');
        assert.ok(!fs.existsSync(path.join(modelsDir, 'tiny_rec', 'inference.onnx')));
    } finally {
        server.close();
        fs.rmSync(modelsDir, { recursive: true, force: true });
    }
});

test('a detection model needs no dictionary', async () => {
    const server = await serve({ '/det/inference.onnx': ONNX_BYTES });
    const modelsDir = tempModelsDir();
    const store = new ModelStore(modelsDir, {
        sourcesFor: () => [
            { kind: 'files', label: 'det mirror', base: `${server.base}/det`, onnx: 'inference.onnx', dictionary: 'dict.txt', dictionaryFormat: 'txt', attempts: 1 },
        ],
    });
    const asset = { id: 'tiny_det', kind: 'detection', url: '', bytes: ONNX_BYTES.length };
    try {
        const loaded = await store.ensure(asset);
        assert.equal(loaded.dictionary, null);
        assert.equal(store.has(asset), true);
    } finally {
        server.close();
        fs.rmSync(modelsDir, { recursive: true, force: true });
    }
});

test('a mirror dict.txt with Windows line endings is split cleanly', async () => {
    const server = await serve({
        '/m/inference.onnx': ONNX_BYTES,
        '/m/dict.txt': 'a\r\nb\r\nc\r\n ',
    });
    const modelsDir = tempModelsDir();
    const store = new ModelStore(modelsDir, {
        sourcesFor: () => [
            { kind: 'files', label: 'mirror', base: `${server.base}/m`, onnx: 'inference.onnx', dictionary: 'dict.txt', dictionaryFormat: 'txt', attempts: 1 },
        ],
    });
    const asset = { id: 'tiny_rec', kind: 'recognition', url: '', bytes: ONNX_BYTES.length };
    try {
        const loaded = await store.ensure(asset);
        assert.deepEqual(loaded.dictionary, ['a', 'b', 'c', ' ']);
    } finally {
        server.close();
        fs.rmSync(modelsDir, { recursive: true, force: true });
    }
});

test('a truncated or dictionary-less model already on disk counts as missing', () => {
    const modelsDir = tempModelsDir();
    const store = new ModelStore(modelsDir);
    const asset = { id: 'tiny_rec', kind: 'recognition', bytes: 1000 };
    try {
        fs.mkdirSync(store.dirFor('tiny_rec'), { recursive: true });
        fs.writeFileSync(path.join(store.dirFor('tiny_rec'), 'inference.onnx'), Buffer.alloc(500));
        fs.writeFileSync(path.join(store.dirFor('tiny_rec'), 'dict.txt'), 'a');
        assert.equal(store.has(asset), false, 'half the expected size is a partial download');

        fs.writeFileSync(path.join(store.dirFor('tiny_rec'), 'inference.onnx'), Buffer.alloc(1000));
        assert.equal(store.has(asset), true);

        fs.rmSync(path.join(store.dirFor('tiny_rec'), 'dict.txt'));
        assert.equal(store.has(asset), false, 'a recognition model without dict.txt is unusable');

        store.remove('tiny_rec');
        assert.ok(!fs.existsSync(store.dirFor('tiny_rec')));
    } finally {
        fs.rmSync(modelsDir, { recursive: true, force: true });
    }
});
