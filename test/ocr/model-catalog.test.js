const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    DETECTION_MODEL,
    RECOGNITION_MODELS,
    recognitionModelsFor,
    isSupportedLanguage,
    assetsForRecognitionKey,
    sourcesForAsset,
    FALLBACK_ORDER,
} = require('../../src/core/ocr/model-catalog');

test('maps the tesseract language codes still stored in settings to a script group', () => {
    assert.deepEqual(recognitionModelsFor('eng'), ['latin']);
    assert.deepEqual(recognitionModelsFor('por'), ['latin']);
    assert.deepEqual(recognitionModelsFor('rus'), ['cyrillic']);
    assert.deepEqual(recognitionModelsFor('kor'), ['korean']);
    assert.deepEqual(recognitionModelsFor('tha'), ['thai']);
    // Japanese and both Chinese variants are served by the same multi-script model.
    assert.deepEqual(recognitionModelsFor('jpn'), ['default']);
    assert.deepEqual(recognitionModelsFor('chi_tra'), ['default']);
});

test('falls back to every script group when the language is unset or unknown', () => {
    assert.deepEqual(recognitionModelsFor('all'), FALLBACK_ORDER);
    assert.deepEqual(recognitionModelsFor(''), FALLBACK_ORDER);
    assert.deepEqual(recognitionModelsFor('klingon'), FALLBACK_ORDER);
    assert.equal(FALLBACK_ORDER[0], 'latin', 'the most common script group must be tried first');
});

test('reports which languages this build can auto-detect', () => {
    for (const language of ['eng', 'deu', 'fra', 'spa', 'ita', 'por', 'pol', 'tur', 'rus', 'kor', 'tha', 'jpn', 'chi_sim', 'chi_tra']) {
        assert.ok(isSupportedLanguage(language), `${language} should be supported`);
    }
    assert.ok(!isSupportedLanguage('all'));
});

test('every script group resolves to the shared detection model plus its own recognition model', () => {
    for (const key of Object.keys(RECOGNITION_MODELS)) {
        const assets = assetsForRecognitionKey(key);
        assert.deepEqual(assets[0], DETECTION_MODEL, `${key} must reuse the shared detection model`);
        assert.equal(assets[1], RECOGNITION_MODELS[key]);
        assert.ok(assets[1].url.endsWith('.tar'), `${key} must be downloaded as a tar archive`);
    }
});

test('rejects an unknown script group instead of guessing a model', () => {
    assert.throws(() => assetsForRecognitionKey('martian'), /Unknown recognition model key/);
});

test('tries HuggingFace before the official archive, which Node cannot reach on some networks', () => {
    // Regression guard: the PaddlePaddle bucket is a China-hosted CDN whose TLS
    // handshake is dropped for Node on some networks, so putting it first means a
    // first run that never downloads anything. HuggingFace hosts the same official
    // ONNX exports and is reachable.
    const asset = assetsForRecognitionKey('latin')[1];
    const sources = sourcesForAsset(asset);

    assert.equal(sources[0].kind, 'files');
    assert.match(sources[0].base, /^https:\/\/huggingface\.co\/PaddlePaddle\/latin_PP-OCRv5_mobile_rec_onnx\/resolve\/main$/);
    assert.equal(sources[0].dictionaryFormat, 'yml', 'HuggingFace keeps the dictionary inside inference.yml');
    assert.equal(sources[sources.length - 1].kind, 'tar');
    assert.equal(sources[sources.length - 1].url, asset.url);
});

test('a configured mirror is tried before any remote source', () => {
    const asset = assetsForRecognitionKey('latin')[1];
    const previous = process.env.OCR_MODEL_MIRROR;
    process.env.OCR_MODEL_MIRROR = 'https://example.test/ocr-models/';
    try {
        const sources = sourcesForAsset(asset);
        assert.equal(sources[0].base, 'https://example.test/ocr-models/latin_PP-OCRv5_mobile_rec');
        assert.equal(sources[0].dictionaryFormat, 'txt', 'self-hosted mirrors keep the app layout (dict.txt)');
        assert.equal(sources[1].kind, 'files');
        assert.match(sources[1].base, /huggingface\.co/);
    } finally {
        if (previous === undefined) delete process.env.OCR_MODEL_MIRROR; else process.env.OCR_MODEL_MIRROR = previous;
    }
});
