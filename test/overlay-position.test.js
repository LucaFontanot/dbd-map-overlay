const {test} = require('node:test');
const assert = require('node:assert');
const {computeOverlayPosition, presetToGlide, rotatedSize} = require('../src/core/overlay-position');

const workArea = {x: 0, y: 0, width: 1920, height: 1080};

function pos(overrides = {}) {
    return computeOverlayPosition({
        workArea,
        overlayWidth: 320,
        overlayHeight: 320,
        position: "1",
        glideX: null,
        glideY: null,
        ...overrides
    });
}

test('unset glide follows the corner preset', () => {
    assert.deepStrictEqual(pos({position: "1"}), {x: 0, y: 0});
    assert.deepStrictEqual(pos({position: "2"}), {x: 1600, y: 0});
    assert.deepStrictEqual(pos({position: "3"}), {x: 0, y: 760});
    assert.deepStrictEqual(pos({position: "4"}), {x: 1600, y: 760});
});

test('numeric position preset behaves like its string form', () => {
    assert.deepStrictEqual(pos({position: 4}), pos({position: "4"}));
});

test('glide 0 and 100 land exactly on the work area edges', () => {
    assert.deepStrictEqual(pos({glideX: 0, glideY: 0}), {x: 0, y: 0});
    assert.deepStrictEqual(pos({glideX: 100, glideY: 100}), {x: 1600, y: 760});
});

test('glide positions absolutely across the free space', () => {
    assert.deepStrictEqual(pos({glideX: 50, glideY: 25}), {x: 800, y: 190});
});

test('glide overrides the corner preset entirely', () => {
    assert.deepStrictEqual(pos({position: "4", glideX: 0, glideY: 0}), {x: 0, y: 0});
    assert.deepStrictEqual(pos({position: "4", glideX: 50, glideY: 50}), {x: 800, y: 380});
});

test('per-axis fallback: only the unset axis follows the preset', () => {
    assert.deepStrictEqual(pos({position: "4", glideX: 50, glideY: null}), {x: 800, y: 760});
});

test('work area offsets (secondary monitors, taskbars) are respected', () => {
    const wa = {x: 1920, y: 40, width: 1920, height: 1040};
    const p = computeOverlayPosition({
        workArea: wa, overlayWidth: 320, overlayHeight: 320,
        position: "1", glideX: 100, glideY: 100
    });
    assert.deepStrictEqual(p, {x: 1920 + 1600, y: 40 + 720});
});

test('overlay larger than the work area pins to the work area origin', () => {
    const p = computeOverlayPosition({
        workArea, overlayWidth: 2500, overlayHeight: 1500,
        position: "4", glideX: 100, glideY: 100
    });
    assert.deepStrictEqual(p, {x: 0, y: 0});
});

test('garbage glide values fall back to the preset corner', () => {
    assert.deepStrictEqual(pos({position: "2", glideX: "abc", glideY: undefined}), {x: 1600, y: 0});
    assert.deepStrictEqual(pos({position: "3", glideX: null, glideY: NaN}), {x: 0, y: 760});
});

test('out-of-range glide values are clamped to 0..100', () => {
    assert.deepStrictEqual(pos({glideX: 250, glideY: -250}), {x: 1600, y: 0});
});

test('rotatedSize: 0 and 180 degrees keep dimensions, 90/270 swap them', () => {
    assert.deepStrictEqual(rotatedSize({width: 300, height: 200, rotation: 0}), {width: 300, height: 200});
    assert.deepStrictEqual(rotatedSize({width: 300, height: 200, rotation: 180}), {width: 300, height: 200});
    assert.deepStrictEqual(rotatedSize({width: 300, height: 200, rotation: 90}), {width: 200, height: 300});
    assert.deepStrictEqual(rotatedSize({width: 300, height: 200, rotation: 270}), {width: 200, height: 300});
});

test('rotatedSize: 45 degrees on a square grows to its diagonal', () => {
    const d = rotatedSize({width: 100, height: 100, rotation: 45});
    assert.strictEqual(d.width, Math.round(100 * Math.SQRT2));
    assert.strictEqual(d.height, Math.round(100 * Math.SQRT2));
});

test('rotatedSize: garbage rotation means no rotation', () => {
    assert.deepStrictEqual(rotatedSize({width: 300, height: 200, rotation: null}), {width: 300, height: 200});
    assert.deepStrictEqual(rotatedSize({width: 300, height: 200, rotation: "abc"}), {width: 300, height: 200});
});

test('presetToGlide maps corners and defaults to top-left', () => {
    assert.deepStrictEqual(presetToGlide("2"), {x: 100, y: 0});
    assert.deepStrictEqual(presetToGlide(3), {x: 0, y: 100});
    assert.deepStrictEqual(presetToGlide("bogus"), {x: 0, y: 0});
});
