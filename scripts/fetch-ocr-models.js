#!/usr/bin/env node
'use strict';

/**
 * Downloads OCR models into the exact layout the app loads them from, so they
 * can be (a) pre-seeded on a machine with a flaky connection or (b) uploaded
 * as a mirror (`OCR_MODEL_MIRROR` / `MIRROR_BASE_URL` in model-catalog.js).
 *
 *   node scripts/fetch-ocr-models.js                 # the models for one language (default eng) into <userData>/ocr-models
 *   node scripts/fetch-ocr-models.js --lang=all      # every recognition model (~55 MB)
 *   node scripts/fetch-ocr-models.js --out=./ocr-mirror --lang=all
 *   node scripts/fetch-ocr-models.js --out=./ocr-mirror   # then upload the folder as-is
 *
 * The resulting directory is a valid mirror: <out>/<model-id>/inference.onnx + dict.txt.
 */

const fs = require('fs');
const path = require('path');
const {
    DETECTION_MODEL,
    RECOGNITION_MODELS,
    recognitionModelsFor,
    assetsForRecognitionKey,
} = require('../src/core/ocr/model-catalog');
const { ModelStore, defaultModelsDir } = require('../src/core/ocr/model-store');

function parseArgs(argv) {
    const options = { language: 'eng', out: defaultModelsDir() };
    for (const arg of argv) {
        if (arg.startsWith('--lang=')) options.language = arg.slice(7);
        else if (arg.startsWith('--out=')) options.out = path.resolve(arg.slice(6));
    }
    return options;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));

    // 'all' pulls every recognition model; otherwise just the one for the language.
    const keys = options.language === 'all'
        ? Object.keys(RECOGNITION_MODELS)
        : recognitionModelsFor(options.language);

    const assets = new Map();
    for (const key of keys) {
        for (const asset of assetsForRecognitionKey(key)) assets.set(asset.id, asset);
    }

    console.log(`Fetching ${assets.size} model(s) for "${options.language}" into ${options.out}`);
    console.log(`(mirror layout: <out>/<model-id>/{inference.onnx,dict.txt})\n`);

    const store = new ModelStore(options.out);
    let failed = 0;
    for (const asset of assets.values()) {
        try {
            const loaded = await store.ensure(asset, ({ receivedBytes, totalBytes }) => {
                process.stdout.write(`\r  ${asset.id}: ${Math.round(receivedBytes / 1e6)}/${Math.round(totalBytes / 1e6)} MB      `);
            });
            const size = Math.round(fs.statSync(loaded.modelPath).size / 1e6 * 10) / 10;
            process.stdout.write(`\r  ${asset.id}: ready (${size} MB)${' '.repeat(20)}\n`);
        } catch (err) {
            failed++;
            process.stdout.write(`\r  ${asset.id}: FAILED — ${err.message}\n`);
        }
    }

    const totalBytes = fs.readdirSync(options.out).reduce((sum, entry) => {
        const model = path.join(options.out, entry, 'inference.onnx');
        return fs.existsSync(model) ? sum + fs.statSync(model).size : sum;
    }, 0);
    console.log(`\nModels on disk: ${Math.round(totalBytes / 1e6)} MB in ${options.out}`);
    console.log('To host them: upload this directory and set MIRROR_BASE_URL in src/core/ocr/model-catalog.js');
    console.log('(or the OCR_MODEL_MIRROR environment variable) to the public URL of its parent folder.');
    if (failed) {
        // The official CDN is flaky; the models already written stay cached, so a
        // second run only fetches what is still missing.
        console.log(`\n${failed} model(s) failed — run this again to retry only the missing ones.`);
        process.exit(1);
    }
}

main().catch(err => {
    console.error('fetch-ocr-models failed:', err && err.stack || err);
    process.exit(1);
});
