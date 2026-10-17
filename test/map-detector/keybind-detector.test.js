const { test } = require('node:test');
const assert = require('node:assert/strict');
const { KeybindDetector } = require('../../src/core/map-detector/keybind-detector');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitFor(cond, timeoutMs = 500) {
    const deadline = Date.now() + timeoutMs;
    while (!cond() && Date.now() < deadline) await sleep(2);
    return cond();
}

/** The fake game shows `world.screen`; only 'intro' carries the map title. */
function buildDeps(overrides = {}) {
    const world = { screen: 'gameplay' };
    const calls = { onMapDetected: [], status: [], recognize: 0 };
    const deps = {
        captureFrame: async () => world.screen,
        recognizeMapText: async (frame) => {
            calls.recognize++;
            return frame === 'intro' ? { realm: 'MacMillan Estate', map: 'Coal Tower' } : null;
        },
        onMapDetected: (key) => calls.onMapDetected.push(key),
        onStatus: (status) => calls.status.push(status.state),
        pollMs: 5,
        burstMs: 60,
        ...overrides,
    };
    return { deps, calls, world };
}

function startDetector(t, deps) {
    const kd = new KeybindDetector(deps);
    t.after(() => kd.stop());
    kd.start();
    return kd;
}

test('does nothing until the key is pressed', async (t) => {
    const { deps, calls } = buildDeps();
    startDetector(t, deps);
    await sleep(30);
    assert.equal(calls.recognize, 0);
});

test('a press reads until the title shows and reports the first match', async (t) => {
    const { deps, calls, world } = buildDeps({ burstMs: 1000 });
    const kd = startDetector(t, deps);
    kd.trigger();
    await waitFor(() => calls.recognize >= 2);
    world.screen = 'intro';
    assert.ok(await waitFor(() => calls.onMapDetected.length === 1));
    assert.deepEqual(calls.onMapDetected, ['MacMillan Estate/Coal Tower']);
    assert.deepEqual(calls.status, ['scanning', 'matched']);
    const reads = calls.recognize;
    await sleep(30);
    assert.equal(calls.recognize, reads, 'the burst stops after a match');
    assert.equal(kd.scanning, false);
});

test('a burst with no title times out', async (t) => {
    const { deps, calls } = buildDeps();
    const kd = startDetector(t, deps);
    kd.trigger();
    assert.ok(await waitFor(() => calls.status.includes('not-found')));
    assert.deepEqual(calls.onMapDetected, []);
    assert.equal(kd.scanning, false);
    const reads = calls.recognize;
    await sleep(30);
    assert.equal(calls.recognize, reads, 'no reads after the burst ends');
});

test('a press during a burst extends it instead of starting a second loop', async (t) => {
    let inFlight = 0;
    let maxInFlight = 0;
    const { deps, calls } = buildDeps({
        burstMs: 50,
        recognizeMapText: async () => {
            calls.recognize++;
            maxInFlight = Math.max(maxInFlight, ++inFlight);
            await sleep(1);
            inFlight--;
            return null;
        },
    });
    const kd = startDetector(t, deps);
    const startedAt = Date.now();
    kd.trigger();
    await sleep(35);
    kd.trigger();
    assert.ok(await waitFor(() => calls.status.includes('not-found'), 1000));
    assert.ok(Date.now() - startedAt >= 80, 'the second press pushed the deadline out');
    assert.equal(maxInFlight, 1);
    assert.equal(calls.status.filter(s => s === 'scanning').length, 1);
});

test('stop() during an in-flight read reports nothing', async (t) => {
    let release;
    const { deps, calls } = buildDeps({
        recognizeMapText: () => new Promise(resolve => { release = () => resolve({ realm: null, map: 'Coal Tower' }); }),
    });
    const kd = startDetector(t, deps);
    kd.trigger();
    assert.ok(await waitFor(() => !!release));
    kd.stop();
    release();
    await sleep(20);
    assert.deepEqual(calls.onMapDetected, []);
    assert.deepEqual(calls.status, ['scanning']);
});

test('a press while stopped is ignored', async () => {
    const { deps, calls } = buildDeps();
    const kd = new KeybindDetector(deps);
    kd.trigger();
    await sleep(20);
    assert.equal(calls.recognize, 0);
});

test('a missing game window is reported, not retried forever', async (t) => {
    const { deps, calls } = buildDeps({ captureFrame: async () => null });
    const kd = startDetector(t, deps);
    kd.trigger();
    assert.ok(await waitFor(() => calls.status.includes('not-found')));
    assert.equal(calls.recognize, 0);
    assert.equal(kd.scanning, false);
});

test('a failing read does not end the burst', async (t) => {
    let n = 0;
    const errors = [];
    const { deps, calls } = buildDeps({
        burstMs: 1000,
        recognizeMapText: async () => {
            if (++n === 1) throw new Error('worker hiccup');
            return { realm: null, map: 'Coal Tower' };
        },
        onError: (err) => errors.push(err.message),
    });
    startDetector(t, deps).trigger();
    assert.ok(await waitFor(() => calls.onMapDetected.length === 1));
    assert.deepEqual(errors, ['worker hiccup']);
});
