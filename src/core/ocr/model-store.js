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
// never works. Each source is retried (`source.attempts`, default below) with a
// backoff before moving on to the next one.
const DEFAULT_SOURCE_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 1500;

// Socket idle timeout (axios' Node adapter applies `timeout` to the socket, not
// to the whole transfer): a stalled connection is dropped after 30 s instead of
// 5 minutes, so a dead source falls through to the next one in about a minute.
const IDLE_TIMEOUT_MS = 30000;

// A downloaded or cached `inference.onnx` smaller than this fraction of the
// catalog size is a truncated transfer, not a model.
const MIN_SIZE_RATIO = 0.9;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** 401/403/404 means "not here" (HuggingFace answers 401 for unknown repos), not "try again in a second". */
function isPermanent(err) {
    const status = err?.response?.status;
    return status === 401 || status === 403 || status === 404;
}

async function fetchBuffer(url, onProgress, timeout = IDLE_TIMEOUT_MS) {
    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout,
        maxRedirects: 5,
        onDownloadProgress: onProgress,
    });
    return Buffer.from(response.data);
}

/** @returns {number} smallest acceptable inference.onnx size for an asset (0 when unknown) */
function minimumModelBytes(asset) {
    return asset && asset.bytes ? Math.floor(asset.bytes * MIN_SIZE_RATIO) : 0;
}

/** Recognition models are useless without their dictionary; detection models have none. */
function needsDictionary(asset) {
    return asset && asset.kind === 'recognition';
}

/**
 * Downloads an asset from one source.
 *
 * `files` sources hand over the model and its dictionary as two direct
 * downloads (a self-hosted mirror or the HuggingFace export); `tar` sources are
 * the official archives carrying both inside one file.
 *
 * Throws (so the caller retries or moves to the next source) when the model is
 * truncated or a recognition model comes without its dictionary.
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

    let result;
    if (source.kind === 'files') {
        const onnx = await fetchBuffer(`${source.base}/${source.onnx}`, progress);
        let dictionary = null;
        try {
            const raw = await fetchBuffer(`${source.base}/${source.dictionary}`);
            dictionary = source.dictionaryFormat === 'yml'
                ? readDictionary(raw)
                : raw.toString('utf-8').split(/\r?\n/);
        } catch (err) {
            // Detection models have no dictionary; only a hard 404 counts as "none".
            if (!isPermanent(err)) throw err;
        }
        result = { onnx, dictionary };
    } else {
        const archive = await fetchBuffer(source.url, progress);
        const entries = extractTarEntries(archive);
        result = {
            onnx: pickEntry(entries, 'inference.onnx'),
            dictionary: readDictionary(pickEntry(entries, 'inference.yml')),
        };
    }

    const minimum = minimumModelBytes(asset);
    if (result.onnx.length < minimum) {
        throw new Error(`truncated model: got ${result.onnx.length} bytes, expected at least ${minimum}`);
    }
    if (needsDictionary(asset) && !(result.dictionary && result.dictionary.length > 0)) {
        throw new Error('recognition model came without its dictionary');
    }
    return result;
}

class ModelStore {
    /**
     * @param {string} modelsDir directory holding one folder per model id
     * @param {{sourcesFor?: (asset: object) => Array<object>}} [options]
     *   sourcesFor overrides the catalog's source list (tests serve a local archive)
     */
    constructor(modelsDir, { sourcesFor } = {}) {
        this.modelsDir = modelsDir;
        this.sourcesFor = sourcesFor || sourcesForAsset;
    }

    /** @returns {string} */
    dirFor(modelId) {
        return path.join(this.modelsDir, modelId);
    }

    /**
     * Whether a model is on disk and complete.
     *
     * Given only an id this checks that `inference.onnx` exists. Given the
     * catalog asset it also rejects a truncated onnx (a download interrupted by
     * an older build that wrote the model in place) and a recognition model
     * missing its dictionary, so either gets downloaded again.
     *
     * @param {string|{id: string, bytes?: number, kind?: string}} assetOrId
     * @returns {boolean}
     */
    has(assetOrId) {
        const asset = typeof assetOrId === 'string' ? { id: assetOrId } : assetOrId;
        const dir = this.dirFor(asset.id);
        const onnxPath = path.join(dir, 'inference.onnx');
        let size;
        try {
            size = fs.statSync(onnxPath).size;
        } catch {
            return false;
        }
        if (size < minimumModelBytes(asset)) return false;
        if (needsDictionary(asset) && !fs.existsSync(path.join(dir, 'dict.txt'))) return false;
        return true;
    }

    /**
     * @param {string|{id: string, bytes?: number, kind?: string}} assetOrId
     * @returns {{modelPath: string, dictionary: string[]|null}|null} null when the model is not (completely) on disk
     */
    load(assetOrId) {
        if (!this.has(assetOrId)) return null;
        const dir = this.dirFor(typeof assetOrId === 'string' ? assetOrId : assetOrId.id);
        const dictFile = path.join(dir, 'dict.txt');
        return {
            modelPath: path.join(dir, 'inference.onnx'),
            dictionary: fs.existsSync(dictFile) ? fs.readFileSync(dictFile, 'utf-8').split(/\r?\n/) : null,
        };
    }

    /**
     * Deletes a model folder, so the next ensure() downloads it again. Used when
     * the runtime cannot create a session from what is on disk (corrupt file).
     * @param {string} modelId
     */
    remove(modelId) {
        fs.rmSync(this.dirFor(modelId), { recursive: true, force: true });
    }

    /**
     * Writes a fetched model. The dictionary goes first and the onnx is renamed
     * into place last: `has()` keys off inference.onnx, so an interruption at any
     * point leaves either no model or a complete one, never a half-written file
     * that looks finished.
     */
    _write(asset, { onnx, dictionary }) {
        const dir = this.dirFor(asset.id);
        fs.mkdirSync(dir, { recursive: true });
        const onnxPath = path.join(dir, 'inference.onnx');
        fs.rmSync(onnxPath, { force: true });
        if (dictionary) fs.writeFileSync(path.join(dir, 'dict.txt'), dictionary.join('\n'));
        const tmp = `${onnxPath}.tmp`;
        fs.writeFileSync(tmp, onnx);
        fs.renameSync(tmp, onnxPath);
    }

    /**
     * Ensures one model is on disk, trying every configured source in order
     * (mirror, HuggingFace, then the official bucket) before giving up.
     * @param {{id: string, url: string, bytes: number, kind?: string}} asset
     * @param {(progress: {modelId: string, receivedBytes: number, totalBytes: number}) => void} [onProgress]
     * @returns {Promise<{modelPath: string, dictionary: string[]|null}>}
     */
    async ensure(asset, onProgress) {
        const cached = this.load(asset);
        if (cached) {
            debug && console.log(`ModelStore: ${asset.id} already on disk`);
            return cached;
        }

        const sources = this.sourcesFor(asset);
        const failures = [];
        for (const source of sources) {
            const label = source.label;
            const attempts = source.attempts || DEFAULT_SOURCE_ATTEMPTS;
            for (let attempt = 1; attempt <= attempts; attempt++) {
                try {
                    console.log(`ModelStore: fetching ${asset.id} from ${label} (attempt ${attempt}/${attempts})`);
                    const started = Date.now();
                    const fetched = await fetchFromSource(asset, source, onProgress);
                    this._write(asset, fetched);
                    const { dictionary } = fetched;
                    console.log(`ModelStore: ${asset.id} ready from ${label} in ${Date.now() - started} ms${dictionary ? ` (${dictionary.length} dictionary entries)` : ''}`);

                    const loaded = this.load(asset);
                    if (!loaded) throw new Error('model written but not readable back');
                    return loaded;
                } catch (err) {
                    failures.push(`${label}: ${err.message}`);
                    console.warn(`ModelStore: ${asset.id} from ${label} failed (attempt ${attempt}/${attempts}): ${err.message}`);
                    if (isPermanent(err)) break; // no point retrying a 404
                    if (attempt < attempts) await sleep(RETRY_BACKOFF_MS * attempt);
                }
            }
        }

        const error = new Error(`Could not download OCR model ${asset.id}. Tried ${failures.length} attempt(s): ${failures.join(' | ')}`);
        error.code = 'OCR_MODEL_DOWNLOAD_FAILED';
        throw error;
    }
}

module.exports = { ModelStore, extractTarEntries, readDictionary, defaultModelsDir };
