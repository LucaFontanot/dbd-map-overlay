const { test } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { cropRect, framePixels } = require('../../src/core/ocr/frame');
const { MAP_NAME_ROI } = require('../../src/core/map-detector/rois');
const { ROI: ENDGAME_ROI } = require('../../src/core/map-detector/endgame-detector');
const { ROI: LOBBY_ROI } = require('../../src/core/map-detector/lobby-classifier');

// Window sizes that broke the old Math.round(left)+Math.round(width) crop (widths
// ≡ 2 mod 4 with x = 0.75 overshoot by one pixel) plus odd windowed sizes.
const SIZES = [[1366, 768], [1366, 705], [1858, 1046], [1002, 601], [1920, 1080], [3840, 2160], [7, 5]];
const ROIS = {
    'map name': MAP_NAME_ROI,
    endgame: ENDGAME_ROI,
    'endgame (implicit size)': { x: ENDGAME_ROI.x, y: ENDGAME_ROI.y },
    lobby: LOBBY_ROI,
};

test('crop rectangles always lie inside the frame, for every ROI the detector uses', () => {
    for (const [width, height] of SIZES) {
        for (const [name, roi] of Object.entries(ROIS)) {
            const rect = cropRect(width, height, roi);
            const label = `${name} @ ${width}x${height}: ${JSON.stringify(rect)}`;
            assert.ok(rect.left >= 0 && rect.top >= 0, label);
            assert.ok(rect.width >= 1 && rect.height >= 1, label);
            assert.ok(rect.left + rect.width <= width, `${label} overflows horizontally`);
            assert.ok(rect.top + rect.height <= height, `${label} overflows vertically`);
        }
    }
});

test('1366x768 endgame corner: the case that threw "bad extract area"', () => {
    assert.deepEqual(cropRect(1366, 768, ENDGAME_ROI), { left: 1024, top: 691, width: 342, height: 77 });
});

test('sharp accepts every crop, from encoded and raw frames alike', async () => {
    for (const [width, height] of SIZES) {
        const raw = { data: Buffer.alloc(width * height * 4, 128), width, height, channels: 4 };
        const png = await sharp(raw.data, { raw: { width, height, channels: 4 } }).png().toBuffer();
        for (const [name, roi] of Object.entries(ROIS)) {
            const expected = cropRect(width, height, roi);
            for (const [kind, frame] of [['png', png], ['raw', raw]]) {
                const pixels = await framePixels(frame, roi);
                assert.equal(pixels.width, expected.width, `${name} @ ${width}x${height} (${kind})`);
                assert.equal(pixels.height, expected.height, `${name} @ ${width}x${height} (${kind})`);
                assert.equal(pixels.data.length, expected.width * expected.height * 3, 'RGB, alpha removed');
            }
        }
    }
});
