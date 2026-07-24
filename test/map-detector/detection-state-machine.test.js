const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DetectionStateMachine } = require('../../src/core/map-detector/detection-state-machine');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function buildDeps(overrides = {}) {
    const calls = { onMapDetected: [], onMatchEnded: [] };
    const deps = {
        captureFrame: async () => Buffer.from('frame'),
        computeFrameStats: async () => ({ mean: 100, darkFrac: 0 }),
        isNearBlackFrame: (stats) => stats.mean < 15,
        hasFilledProgressBar: async () => false,
        isCustomLobby: async () => false,
        recognizeMapText: async () => null,
        isEndgameScreen: async () => false,
        onMapDetected: (key) => calls.onMapDetected.push(key),
        onMatchEnded: () => calls.onMatchEnded.push(true),
        detectInCustoms: () => true,
        idlePollMs: 10,
        huntPollMs: 10,
        huntTimeoutMs: 100,
        matchPollMs: 10,
        ...overrides,
    };
    return { deps, calls };
}

test('stays IDLE while frames are bright (no near-black frame seen)', async () => {
    const { deps } = buildDeps();
    const sm = new DetectionStateMachine(deps);
    sm.start();
    await sleep(50);
    assert.equal(sm.state, 'IDLE');
    sm.stop();
});

test('near-black frame WITHOUT a filled bar (boot splash) does not enter HUNTING', async () => {
    const { deps } = buildDeps({
        computeFrameStats: async () => ({ mean: 2, darkFrac: 0.95 }),
        hasFilledProgressBar: async () => false,
    });
    const sm = new DetectionStateMachine(deps);
    sm.start();
    await sleep(50);
    assert.equal(sm.state, 'IDLE');
    sm.stop();
});

test('near-black frame WITH a filled bar enters HUNTING, and a confirmed map fires onMapDetected then moves to MATCH_ACTIVE', async () => {
    let tick = 0;
    const { deps, calls } = buildDeps({
        computeFrameStats: async () => ({ mean: 2, darkFrac: 0.95 }),
        hasFilledProgressBar: async () => true,
        recognizeMapText: async () => {
            tick++;
            // first two HUNTING ticks agree -> should be enough to confirm
            return { realm: 'Autohaven Wreckers', map: 'Blood Lodge' };
        },
    });
    const sm = new DetectionStateMachine(deps);
    sm.start();
    await sleep(80);
    assert.equal(sm.state, 'MATCH_ACTIVE');
    assert.deepEqual(calls.onMapDetected, ['Autohaven Wreckers/Blood Lodge']);
    assert.ok(tick >= 2, 'expected at least 2 consecutive OCR reads before confirming');
    sm.stop();
});

test('a single-tick OCR misread does not fire onMapDetected (requires 2 consecutive identical reads)', async () => {
    let tick = 0;
    const results = [
        { realm: null, map: 'Wrong Map' },
        { realm: 'Autohaven Wreckers', map: 'Blood Lodge' },
        { realm: 'Autohaven Wreckers', map: 'Blood Lodge' },
    ];
    const { deps, calls } = buildDeps({
        computeFrameStats: async () => ({ mean: 2, darkFrac: 0.95 }),
        hasFilledProgressBar: async () => true,
        recognizeMapText: async () => results[Math.min(tick++, results.length - 1)],
    });
    const sm = new DetectionStateMachine(deps);
    sm.start();
    await sleep(80);
    assert.deepEqual(calls.onMapDetected, ['Autohaven Wreckers/Blood Lodge']);
    sm.stop();
});

test('HUNTING with no confirmed map eventually times out into MATCH_ACTIVE without firing onMapDetected', async () => {
    const { deps, calls } = buildDeps({
        computeFrameStats: async () => ({ mean: 2, darkFrac: 0.95 }),
        hasFilledProgressBar: async () => true,
        recognizeMapText: async () => null,
        huntTimeoutMs: 30,
        huntPollMs: 10,
    });
    const sm = new DetectionStateMachine(deps);
    sm.start();
    await sleep(80);
    assert.equal(sm.state, 'MATCH_ACTIVE');
    assert.deepEqual(calls.onMapDetected, []);
    sm.stop();
});

test('MATCH_ACTIVE polls for the endgame screen and returns to IDLE, firing onMatchEnded', async () => {
    // computeFrameStats is only consulted from the IDLE tick, so it only needs to be
    // near-black ONCE (to enter HUNTING the first time) -- if it stayed near-black on
    // every call, the machine would keep re-entering HUNTING/MATCH_ACTIVE forever and
    // there would be no reliable moment to observe it "settled" in IDLE.
    let idleTicks = 0;
    const { deps, calls } = buildDeps({
        computeFrameStats: async () => (idleTicks++ === 0 ? { mean: 2, darkFrac: 0.95 } : { mean: 100, darkFrac: 0 }),
        hasFilledProgressBar: async () => true,
        recognizeMapText: async () => ({ realm: null, map: 'Blood Lodge' }),
        isEndgameScreen: async () => true,
        matchPollMs: 10,
    });
    const sm = new DetectionStateMachine(deps);
    sm.start();
    await sleep(100);
    assert.equal(sm.state, 'IDLE');
    assert.equal(calls.onMatchEnded.length, 1);
    sm.stop();
});

test('detectInCustoms=false skips a custom lobby entirely: HUNTING still runs but onMapDetected never fires and endgame handling is skipped', async () => {
    // First IDLE tick must see a BRIGHT frame so isCustomLobby() actually gets checked
    // and cached (the real _tickIdle only calls isCustomLobby on the non-near-black
    // branch) -- every tick after that simulates the loading screen appearing.
    let tick = 0;
    const { deps, calls } = buildDeps({
        computeFrameStats: async () => (tick++ === 0 ? { mean: 100, darkFrac: 0 } : { mean: 2, darkFrac: 0.95 }),
        hasFilledProgressBar: async () => true,
        isCustomLobby: async () => true,
        detectInCustoms: () => false,
        recognizeMapText: async () => ({ realm: null, map: 'Blood Lodge' }),
        isEndgameScreen: async () => true,
    });
    const sm = new DetectionStateMachine(deps);
    sm.start();
    await sleep(80);
    assert.deepEqual(calls.onMapDetected, []);
    assert.deepEqual(calls.onMatchEnded, []);
    sm.stop();
});
