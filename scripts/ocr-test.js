#!/usr/bin/env node
'use strict';

/**
 * Dev tool: run the production OCR engine on an image (or a whole folder) and
 * print what it reads, with timings. No Electron needed — it uses the same
 * OcrService the detector uses, with an explicit models directory.
 *
 *   node scripts/ocr-test.js test/fixtures/map-detector/map-name-crop-forgotten-ruins.png
 *   node scripts/ocr-test.js shot.png --lang=rus --roi=0.75,0.9
 *   node scripts/ocr-test.js test/fixtures/map-detector --models-dir=~/.config/dbd-map/ocr-models
 *
 * Options:
 *   --lang=<code>    tesseract language code (eng, deu, rus, kor, jpn, ...) [default: all]
 *   --roi=x,y,w,h    fractional crop of the frame, e.g. 0.85,0,0.15,0.45
 *   --models-dir=DIR where the models live/download to [default: <userData>/ocr-models]
 *   --repeat=N       run each image N times and report the timing spread [default: 1]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { OcrService } = require('../src/core/ocr/ocr-service');
const { defaultModelsDir } = require('../src/core/ocr/model-store');

function parseArgs(argv) {
    const options = { language: 'all', roi: null, modelsDir: defaultModelsDir(), repeat: 1, targets: [] };
    for (const arg of argv) {
        if (arg.startsWith('--lang=')) options.language = arg.slice(7);
        else if (arg.startsWith('--roi=')) {
            const [x, y, width, height] = arg.slice(6).split(',').map(Number);
            options.roi = { x, y, width, height };
        } else if (arg.startsWith('--models-dir=')) {
            options.modelsDir = arg.slice(13).replace(/^~(?=$|\/)/, os.homedir());
        } else if (arg.startsWith('--repeat=')) options.repeat = Math.max(1, Number(arg.slice(9)) || 1);
        else options.targets.push(arg);
    }
    return options;
}

function imagesIn(target) {
    if (!fs.existsSync(target)) throw new Error(`No such file: ${target}`);
    if (fs.statSync(target).isFile()) return [target];
    return fs.readdirSync(target).filter(f => /\.(png|jpe?g|webp)$/i.test(f)).sort()
        .map(f => path.join(target, f));
}

(async () => {
    const options = parseArgs(process.argv.slice(2));
    if (options.targets.length === 0) {
        console.error('Usage: node scripts/ocr-test.js <image-or-folder> [--lang=eng] [--roi=x,y,w,h] [--models-dir=DIR]');
        process.exit(2);
    }

    const ocr = new OcrService({
        modelsDir: options.modelsDir,
        onDownloadProgress: ({ modelId, receivedBytes, totalBytes }) => {
            process.stdout.write(`\r  downloading ${modelId}: ${Math.round(receivedBytes / 1e6)}/${Math.round(totalBytes / 1e6)} MB   `);
        },
    });

    const files = options.targets.flatMap(imagesIn);
    console.log(`OCR test — lang=${options.language} roi=${options.roi ? JSON.stringify(options.roi) : 'full frame'} models=${options.modelsDir}`);
    console.log(`Preparing models for "${options.language}"...`);
    const prepared = Date.now();
    await ocr.prepare(options.language);
    console.log(`Models ready in ${Date.now() - prepared} ms\n`);

    for (const file of files) {
        const buffer = fs.readFileSync(file);
        const times = [];
        let last = null;
        for (let run = 0; run < options.repeat; run++) {
            const started = Date.now();
            last = await ocr.recognize(buffer, { language: options.language, roi: options.roi });
            times.push(Date.now() - started);
        }
        const items = last.items.map(i => `${i.text} (${i.confidence.toFixed(3)})`);
        console.log(`${path.basename(file)}  ${times.join('/')} ms  boxes=${last.items.length}`);
        console.log(items.length ? items.map(t => `    ${t}`).join('\n') : '    <nothing read>');
    }

    await ocr.dispose();
})().catch(err => {
    console.error('OCR test failed:', err && err.stack || err);
    process.exit(1);
});
