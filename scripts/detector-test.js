#!/usr/bin/env electron
'use strict';

/**
 * End-to-end check of the detector wiring, run under Electron:
 *
 *   npm run detector-test
 *
 * Real MapDetector (real i18n, real OCR engine, real state machine) driven by
 * scripted frames instead of a live game window. The frames are real captures:
 * a 4K loading screen (which has a filled progress bar, so the state machine
 * enters HUNTING), then the same screen with the bar blanked and the map-name
 * crop composited into the area the detector reads (the game prints the title
 * in the intro after loading, and the hunt skips OCR while the bar is up),
 * followed by a real endgame scoreboard.
 *
 * Requires the OCR models; set OCR_MODELS_DIR to reuse the ones the dev CLI
 * already downloaded, otherwise they are fetched into <userData>/ocr-models.
 */

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { app } = require('electron');

global.dirname = path.join(__dirname, '..');
// Use the same userData directory as `yarn start` (Electron would otherwise pick
// its own name and download a second copy of the models into ~/.config/Electron).
app.setName(require(path.join(global.dirname, 'package.json')).name);

const FIXTURES = path.join(global.dirname, 'test', 'fixtures', 'map-detector');

/** Raw RGBA, the shape MapDetector._captureDBD hands over from a live window. */
async function rawFrame(image) {
    const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, channels: info.channels };
}

/**
 * Intro frame: a real map title painted where the game prints it, and no
 * loading bar (the bottom quarter, where the bar detector scans, is blanked).
 * Only the title band of the capture is pasted (left side, above the bar band).
 */
async function mapIntroFrame() {
    const base = path.join(FIXTURES, 'loading-screen-100.png');
    const source = path.join(FIXTURES, 'map-name-crop-forgotten-ruins.png');
    const meta = await sharp(base).metadata();
    const sourceMeta = await sharp(source).metadata();

    const band = {
        left: Math.round(sourceMeta.width * 0.04),
        top: Math.round(sourceMeta.height * 0.50),
        width: Math.round(sourceMeta.width * 0.65),
        height: Math.round(sourceMeta.height * 0.24),
    };
    const target = {
        left: Math.round(meta.width * 0.03),
        top: Math.round(meta.height * 0.665),
        width: Math.round(meta.width * 0.45),
        height: Math.round(meta.height * 0.065),
    };

    const title = await sharp(source).extract(band).resize(target.width, target.height, { fit: 'fill' }).png().toBuffer();
    const barBandTop = Math.floor(meta.height * 0.75);
    const blank = await sharp({ create: { width: meta.width, height: meta.height - barBandTop, channels: 3, background: 'black' } }).png().toBuffer();
    return rawFrame(sharp(base).composite([
        { input: title, left: target.left, top: target.top },
        { input: blank, left: 0, top: barBandTop },
    ]));
}

(async () => {
    const MapDetector = require(path.join(global.dirname, 'src', 'core', 'map-detector'));

    const settings = {
        values: { ocrLanguage: 'eng', detectInCustoms: true, mapDetection: true, endgameDetection: true },
        get(key) { return this.values[key] ?? null; },
        set(key, value) { this.values[key] = value; },
    };

    const events = [];
    const mainWindow = { send: (event, ...data) => { events.push([event, ...data]); console.log(`detector-test: ${event} ${JSON.stringify(data)}`); } };

    const detector = new MapDetector(mainWindow, settings);

    // The endgame frame stays a PNG, so both frame shapes are exercised.
    const loadingFrame = await rawFrame(sharp(path.join(FIXTURES, 'loading-screen-100.png')));
    const introFrame = await mapIntroFrame();
    const endgameFrame = fs.readFileSync(path.join(FIXTURES, 'endgame-public-scoreboard.png'));
    const frames = [loadingFrame, loadingFrame, loadingFrame, introFrame, introFrame, introFrame, endgameFrame, endgameFrame];
    let captures = 0;
    detector._captureDBD = async () => frames[Math.min(captures++, frames.length - 1)];

    console.log('detector-test: starting automatic detection (scripted frames)');
    await detector.startAutomatic();
    await detector.ocr.prepare('eng');

    const deadline = Date.now() + 60000;
    let detected = null;
    let cleared = false;
    let lastState = null;
    while (Date.now() < deadline && !cleared) {
        const state = detector._stateMachine?.state;
        if (state !== lastState) {
            console.log(`detector-test: state -> ${state}`);
            lastState = state;
        }
        if (!detected && events.some(([event]) => event === 'show-map-command')) {
            detected = events.find(([event]) => event === 'show-map-command')[1];
        }
        cleared = events.some(([event]) => event === 'map-detector-clear');
        await new Promise(r => setTimeout(r, 200));
    }

    await detector.stopAutomatic();

    console.log('\n=== detector-test results ===');
    console.log(`frames captured: ${captures}`);
    console.log(`map detected:    ${detected ?? '(none)'}`);
    console.log(`overlay cleared: ${cleared}`);
    // The synthesized frame carries the map title only (the realm line sits above
    // it in the real reveal), so the key is the bare map name in this run.
    const modelStatus = events.filter(([event]) => event === 'map-detector-model-status').map(([, status]) => status.state);
    console.log(`model status:    ${modelStatus.join(', ') || '(none)'}`);

    const ok = detected === 'Forgotten Ruins' && cleared && modelStatus.includes('ready');
    console.log(ok ? 'OK' : 'FAILED');
    app.exit(ok ? 0 : 1);
})().catch(err => {
    console.error('detector-test failed:', err && err.stack || err);
    app.exit(1);
});

app.commandLine.appendSwitch('no-sandbox');
