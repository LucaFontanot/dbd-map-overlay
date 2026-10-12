'use strict';

/**
 * Model catalog for the PaddleOCR engine.
 *
 * Two kinds of assets come from the same source (PaddlePaddle's official
 * inference-model bucket, the same "onnx_infer.tar" archives PaddleX uses):
 *   - detection: language agnostic, shared by every language
 *   - recognition: one model per script group, chosen from the user's game language
 *
 * Every archive holds `inference.onnx` plus an `inference.yml` carrying the
 * recognition dictionary (PaddleX keeps the character list there, not in a
 * separate dict file), so one download provides model and dictionary together.
 */

const BASE_URL = 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0';

/**
 * Optional first-choice mirror of the unpacked model layout:
 *
 *   <MIRROR>/<model-id>/inference.onnx
 *   <MIRROR>/<model-id>/dict.txt
 *
 * i.e. a static copy of a populated `ocr-models` directory, which is also what
 * `scripts/fetch-ocr-models.js` writes — upload that folder and set this to the
 * public URL. The official bucket is a single, slow, China-hosted CDN that
 * regularly times out, so a mirror is the difference between "first run works"
 * and "first run silently loses detection". `OCR_MODEL_MIRROR` overrides it at
 * runtime (also handy for self-hosting without a rebuild).
 *
 * Leave empty to use only the official bucket.
 */
const MIRROR_BASE_URL = '';

/**
 * HuggingFace mirror of the official ONNX exports: same files as the archives
 * (`inference.onnx` + `inference.yml`, dictionary included), served per file.
 * This is the primary source on purpose — the PaddlePaddle bucket below is a
 * single China-hosted CDN whose TLS handshake is silently dropped for Node on
 * some networks (verified: TCP connects, the handshake times out, while curl and
 * every other host work), which would leave detection dead on first run.
 */
const HUGGINGFACE_BASE_URL = 'https://huggingface.co/PaddlePaddle';

/**
 * Ordered list of places a model can be fetched from.
 *
 * `files` sources expose the model and its dictionary as two direct downloads:
 * a self-hosted mirror keeps the app's own layout (`inference.onnx` + a plain
 * `dict.txt`), HuggingFace uses the PaddleX pair (`inference.onnx` +
 * `inference.yml`, dictionary inside the yml). `tar` sources are the official
 * archives, the last resort.
 *
 * @param {{id: string, url: string}} asset
 * @returns {Array<object>}
 */
function sourcesForAsset(asset) {
    const mirror = process.env.OCR_MODEL_MIRROR || MIRROR_BASE_URL;
    const sources = [];
    if (mirror) {
        sources.push({
            kind: 'files',
            label: `mirror ${mirror}`,
            base: `${mirror.replace(/\/+$/, '')}/${asset.id}`,
            onnx: 'inference.onnx',
            dictionary: 'dict.txt',
            dictionaryFormat: 'txt',
            attempts: 2,
        });
    }
    sources.push({
        kind: 'files',
        label: `huggingface ${asset.id}`,
        base: `${HUGGINGFACE_BASE_URL}/${asset.id}_onnx/resolve/main`,
        onnx: 'inference.onnx',
        dictionary: 'inference.yml',
        dictionaryFormat: 'yml',
        // Two tries, not three: with the official bucket still to go, a dead
        // HuggingFace must not hold the first run up for minutes.
        attempts: 2,
    });
    sources.push({ kind: 'tar', label: 'official archive', url: asset.url, attempts: 3 });
    return sources;
}

/** Shared across every language: detecting boxes is script agnostic. */
const DETECTION_MODEL = {
    id: 'PP-OCRv5_mobile_det',
    kind: 'detection',
    url: `${BASE_URL}/PP-OCRv5_mobile_det_onnx_infer.tar`,
    bytes: 4843520,
};

/**
 * Recognition models, keyed by script group. `bytes` is the official archive
 * size: it drives the download total and, at 90%, the floor below which a
 * downloaded or cached `inference.onnx` counts as truncated (the onnx is ~99%
 * of its archive). `kind: 'recognition'` means the model is unusable without
 * its dictionary. The user only ever needs the detection model plus one of these.
 */
const RECOGNITION_MODELS = {
    // Latin + CJK + Japanese: the v5 mobile rec model covers en/ch/cht/ja in one file.
    default: {
        id: 'PP-OCRv5_mobile_rec',
        kind: 'recognition',
        url: `${BASE_URL}/PP-OCRv5_mobile_rec_onnx_infer.tar`,
        bytes: 16701440,
    },
    latin: {
        id: 'latin_PP-OCRv5_mobile_rec',
        kind: 'recognition',
        url: `${BASE_URL}/latin_PP-OCRv5_mobile_rec_onnx_infer.tar`,
        bytes: 8069120,
    },
    cyrillic: {
        id: 'cyrillic_PP-OCRv5_mobile_rec',
        kind: 'recognition',
        url: `${BASE_URL}/cyrillic_PP-OCRv5_mobile_rec_onnx_infer.tar`,
        bytes: 8079360,
    },
    korean: {
        id: 'korean_PP-OCRv5_mobile_rec',
        kind: 'recognition',
        url: `${BASE_URL}/korean_PP-OCRv5_mobile_rec_onnx_infer.tar`,
        bytes: 13537280,
    },
    thai: {
        id: 'th_PP-OCRv5_mobile_rec',
        kind: 'recognition',
        url: `${BASE_URL}/th_PP-OCRv5_mobile_rec_onnx_infer.tar`,
        bytes: 7915520,
    },
};

/**
 * tesseract language codes (the values already stored in the `ocrLanguage`
 * setting since before the migration, kept as-is so existing settings keep
 * working) mapped to the recognition model that reads that language.
 *
 * Verified per model: the latin model drops Cyrillic/CJK entirely, the cyrillic
 * model still reads Latin names at ~0.99 (needed because ru.json leaves several
 * map names untranslated), and the default model is the only one that reads
 * Japanese and Chinese.
 */
const LANGUAGE_TO_RECOGNITION = {
    eng: 'latin',
    deu: 'latin',
    fra: 'latin',
    spa: 'latin',
    ita: 'latin',
    por: 'latin',
    pol: 'latin',
    tur: 'latin',
    rus: 'cyrillic',
    kor: 'korean',
    tha: 'thai',
    jpn: 'default',
    chi_sim: 'default',
    chi_tra: 'default',
};

/**
 * Order used when no specific language is configured ('all'): the Latin model
 * covers most players' locales, the rest are tried only if it finds nothing.
 */
const FALLBACK_ORDER = ['latin', 'cyrillic', 'korean', 'thai', 'default'];

/**
 * @param {string} language tesseract language code from the ocrLanguage setting
 * @returns {string[]} recognition model keys to try, most likely first
 */
function recognitionModelsFor(language) {
    const key = LANGUAGE_TO_RECOGNITION[(language || '').trim()];
    return key ? [key] : [...FALLBACK_ORDER];
}

/** @returns {boolean} whether a language code is one this build can detect */
function isSupportedLanguage(language) {
    return Object.prototype.hasOwnProperty.call(LANGUAGE_TO_RECOGNITION, (language || '').trim());
}

/**
 * @param {string} key recognition model key
 * @returns {Array<{id: string, url: string, bytes: number}>} assets to have on disk
 */
function assetsForRecognitionKey(key) {
    const rec = RECOGNITION_MODELS[key];
    if (!rec) throw new Error(`Unknown recognition model key: ${key}`);
    return [DETECTION_MODEL, rec];
}

module.exports = {
    DETECTION_MODEL,
    RECOGNITION_MODELS,
    LANGUAGE_TO_RECOGNITION,
    FALLBACK_ORDER,
    MIRROR_BASE_URL,
    sourcesForAsset,
    recognitionModelsFor,
    isSupportedLanguage,
    assetsForRecognitionKey,
};
