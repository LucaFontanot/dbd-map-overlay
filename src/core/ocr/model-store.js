'use strict';

/**
 * Downloads and unpacks PaddleOCR model archives into <userData>/ocr-models,
 * one directory per model, and reads their recognition dictionaries.
 *
 * Layout produced per model id:
 *   ocr-models/<model-id>/inference.onnx
 *   ocr-models/<model-id>/dict.txt
 *
 * The official archives are uncompressed ustar tars holding `inference.onnx`
 * and `inference.yml`; the dictionary lives inside the yml, so it is extracted
 * once (with js-yaml) and written next to the model as a plain newline-separated
 * dict.txt — the format the inference runtime wants.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const yaml = require('js-yaml');
const { sourcesForAsset } = require('./model-catalog');

const debug = process.env.DEBUG === 'true';

/**
 * Where models live when the caller does not say: the Electron userData dir,
 * resolved without Electron so the CLI tool and the tests can use it too.
 * OCR_MODELS_DIR overrides it.
 * @returns {string}
 */
function defaultModelsDir() {
    if (process.env.OCR_MODELS_DIR) return process.env.OCR_MODELS_DIR;
    const home = os.homedir();
    if (process.platform === 'win32') {
        return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'dbd-map', 'ocr-models');
    }
    return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'dbd-map', 'ocr-models');
}

// ── Minimal ustar reader ─────────────────────────────────────────────────────
// No `tar` dependency: the archives are plain uncompressed tars, so the two
// headers we need (name + size) are enough.

function readString(bytes, start, length) {
    let out = '';
    for (let i = start; i < start + length; i++) {
        if (bytes[i] === 0) break;
        out += String.fromCharCode(bytes[i]);
    }
    return out.replace(/\0.*$/, '').trim();
}

/** @returns {Map<string, Buffer>} archive entries by path (metadata files skipped) */
function extractTarEntries(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const entries = new Map();
    let offset = 0;
    while (offset + 512 <= bytes.length) {
        let empty = true;
        for (let i = offset; i < offset + 512; i++) {
            if (bytes[i] !== 0) { empty = false; break; }
        }
        if (empty) break; // end-of-archive marker

        const name = readString(bytes, offset, 100).replace(/^\.?\//, '');
        const size = parseInt(readString(bytes, offset + 124, 12), 8) || 0;
        const type = bytes[offset + 156];
        const dataStart = offset + 512;
        const isFile = type === 0 || type === 48 /* '0' */;
        if (isFile && name && !name.includes('PaxHeader') && !name.includes('__MACOSX') && !path.basename(name).startsWith('._')) {
            entries.set(name, Buffer.from(bytes.slice(dataStart, dataStart + size)));
        }
        offset = dataStart + Math.ceil(size / 512) * 512;
    }
    return entries;
}

function pickEntry(entries, basename) {
    for (const [name, data] of entries) {
        if (path.basename(name) === basename) return data;
    }
    throw new Error(`Entry "${basename}" not found in the model archive`);
}

/**
 * Reads the CTC dictionary out of a PaddleX `inference.yml`.
 * The yml omits the trailing space class every CTC model is trained with
 * (v5 rec: 18383 listed vs 18385 output classes), so it is appended here —
 * without it the runtime rejects the dictionary as too short.
 *
 * Detection models carry no dictionary; that is not an error, they just get
 * `null` so callers can tell "no dictionary in this archive" from "malformed".
 *
 * @param {Buffer} ymlBuffer
 * @returns {string[]|null}
 */
function readDictionary(ymlBuffer) {
    const parsed = yaml.load(ymlBuffer.toString('utf-8'));
    const dict = parsed?.PostProcess?.character_dict;
    if (dict === undefined) return null;
    if (!Array.isArray(dict)) {
        throw new Error('inference.yml has a malformed PostProcess.character_dict');
    }
    return dict.map(String).concat([' ']);
}

// ── Store ────────────────────────────────────────────────────────────────────

// The official model host is a single, slow, China-hosted CDN: a first run that
// gives up after one dropped connection means a user whose detection silently
// never works. Retry each source a few times with a backoff before moving on.
const SOURCE_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 1500;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** 404/403 means "not here", not "try again in a second": skip that source. */
function isPermanent(err) {
    const status = err?.response?.status;
    return status === 403 || status === 404;
}

async function fetchBuffer(url, onProgress, timeout = 300000) {
    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout,
        maxRedirects: 5,
        onDownloadProgress: onProgress,
    });
    return Buffer.from(response.data);
}

/**
 * Downloads an asset from one source into the model directory.
 *
 * `files` sources hand over the model and its dictionary as two direct
 * downloads (a self-hosted mirror or the HuggingFace export); `tar` sources are
 * the official archives carrying both inside one file.
 *
 * @returns {Promise<{onnx: Buffer, dictionary: string[]|null}>}
 */
async function fetchFromSource(asset, source, onProgress) {
    const progress = onProgress
        ? (event) => onProgress({
            modelId: asset.id,
            receivedBytes: event.loaded,
            totalBytes: event.total || asset.bytes,
        })
        : undefined;

    if (source.kind === 'files') {
        const onnx = await fetchBuffer(`${source.base}/${source.onnx}`, progress);
        let dictionary = null;
        try {
            const raw = await fetchBuffer(`${source.base}/${source.dictionary}`, undefined, 60000);
            dictionary = source.dictionaryFormat === 'yml'
                ? readDictionary(raw)
                : raw.toString('utf-8').split('\n');
        } catch (err) {
            // Detection models have no dictionary; only a hard 404 counts as "none".
            if (!isPermanent(err)) throw err;
        }
        return { onnx, dictionary };
    }

    const archive = await fetchBuffer(source.url, progress);
    const entries = extractTarEntries(archive);
    return {
        onnx: pickEntry(entries, 'inference.onnx'),
        dictionary: readDictionary(pickEntry(entries, 'inference.yml')),
    };
}

class ModelStore {
    /** @param {string} modelsDir directory holding one folder per model id */
    constructor(modelsDir) {
        this.modelsDir = modelsDir;
    }

    /** @returns {string} */
    dirFor(modelId) {
        return path.join(this.modelsDir, modelId);
    }

    /** @returns {boolean} a model is usable once its .onnx is there (detection models have no dictionary) */
    has(modelId) {
        return fs.existsSync(path.join(this.dirFor(modelId), 'inference.onnx'));
    }

    /** @returns {{modelPath: string, dictionary: string[]|null}|null} null when the model is not on disk yet */
    load(modelId) {
        if (!this.has(modelId)) return null;
        const dir = this.dirFor(modelId);
        const dictFile = path.join(dir, 'dict.txt');
        return {
            modelPath: path.join(dir, 'inference.onnx'),
            dictionary: fs.existsSync(dictFile) ? fs.readFileSync(dictFile, 'utf-8').split('\n') : null,
        };
    }

    /**
     * Ensures one model is on disk, trying every configured source in order
     * (mirror first, then the official bucket) before giving up.
     * @param {{id: string, url: string, bytes: number}} asset
     * @param {(progress: {modelId: string, receivedBytes: number, totalBytes: number}) => void} [onProgress]
     * @returns {Promise<{modelPath: string, dictionary: string[]|null}>}
     */
    async ensure(asset, onProgress) {
        const cached = this.load(asset.id);
        if (cached) {
            debug && console.log(`ModelStore: ${asset.id} already on disk`);
            return cached;
        }

        const sources = sourcesForAsset(asset);
        const failures = [];
        for (const source of sources) {
            const label = source.label;
            for (let attempt = 1; attempt <= SOURCE_ATTEMPTS; attempt++) {
                try {
                    console.log(`ModelStore: fetching ${asset.id} from ${label} (attempt ${attempt}/${SOURCE_ATTEMPTS})`);
                    const started = Date.now();
                    const { onnx, dictionary } = await fetchFromSource(asset, source, onProgress);

                    const dir = this.dirFor(asset.id);
                    fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(path.join(dir, 'inference.onnx'), onnx);
                    // Write the dictionary last: `has()` keys off inference.onnx, but a
                    // model without its dictionary is useless to the runtime, so keep
                    // the pair atomic-ish by writing the model first and the dict after.
                    if (dictionary) fs.writeFileSync(path.join(dir, 'dict.txt'), dictionary.join('\n'));
                    console.log(`ModelStore: ${asset.id} ready from ${label} in ${Date.now() - started} ms${dictionary ? ` (${dictionary.length} dictionary entries)` : ''}`);

                    return this.load(asset.id);
                } catch (err) {
                    failures.push(`${label}: ${err.message}`);
                    console.warn(`ModelStore: ${asset.id} from ${label} failed (attempt ${attempt}/${SOURCE_ATTEMPTS}): ${err.message}`);
                    if (isPermanent(err)) break; // no point retrying a 404
                    if (attempt < SOURCE_ATTEMPTS) await sleep(RETRY_BACKOFF_MS * attempt);
                }
            }
        }

        throw new Error(`Could not download OCR model ${asset.id}. Tried ${failures.length} attempt(s): ${failures.join(' | ')}`);
    }
}

module.exports = { ModelStore, extractTarEntries, readDictionary, defaultModelsDir };
