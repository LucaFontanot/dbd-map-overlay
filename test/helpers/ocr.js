'use strict';

/**
 * Shared setup for the tests that need real OCR.
 *
 * Those tests run the production engine, so they need the model files: either
 * already in the user's <userData>/ocr-models (a normal app run puts them
 * there) or in the directory OCR_MODELS_DIR points at. Without them the tests
 * skip with an actionable message instead of failing — CI has no models.
 */

const path = require('path');
const { OcrService } = require('../../src/core/ocr/ocr-service');
const { ModelStore, defaultModelsDir } = require('../../src/core/ocr/model-store');
const { assetsForRecognitionKey, recognitionModelsFor } = require('../../src/core/ocr/model-catalog');

/** Every fixture is an English client capture. */
const FIXTURE_LANGUAGE = 'eng';

const MODELS_DIR = defaultModelsDir();

/** @returns {string|null} the reason models are missing, or null when they are ready */
function missingModelsReason(language = FIXTURE_LANGUAGE) {
    const store = new ModelStore(MODELS_DIR);
    for (const key of recognitionModelsFor(language)) {
        const missing = assetsForRecognitionKey(key).filter(asset => !store.has(asset));
        if (missing.length > 0) {
            return `OCR models missing from ${MODELS_DIR} (${missing.map(a => a.id).join(', ')}); run "node scripts/ocr-test.js test/fixtures/map-detector/map-name-crop-forgotten-ruins.png" once to download them`;
        }
    }
    return null;
}

/**
 * Creates an OcrService for a test run.
 * @returns {import('../../src/core/ocr/ocr-service').OcrService}
 */
function createOcrService() {
    return new OcrService({ modelsDir: MODELS_DIR, language: FIXTURE_LANGUAGE });
}

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'map-detector');

/** @param {string} name fixture file name */
function loadFixture(name) {
    return require('fs').readFileSync(path.join(FIXTURES, name));
}

module.exports = { MODELS_DIR, FIXTURE_LANGUAGE, missingModelsReason, createOcrService, loadFixture };
