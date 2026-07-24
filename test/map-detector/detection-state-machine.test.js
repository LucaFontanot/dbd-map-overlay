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

test('MATCH_ACTIVE detects a fresh loading screen (missed endgame screen) and transitions straight to HUNTING via onMatchEnded', async () => {
    // computeFrameStats sequencing:
    //   tick 1        -> near-black + filled bar: enters HUNTING from IDLE.
    //   ticks 2-3      -> bright: MATCH_ACTIVE steady state, no loading screen yet.
    //   tick 4 onward -> near-black + filled bar again: the NEXT match's loading
    //                    screen has appeared, even though isEndgameScreen (below)
    //                    never fires -- this is the independent escape path.
    let statsTick = 0;
    // recognizeMapText: first two calls agree (confirms the initial map, entering
    // MATCH_ACTIVE); after that, return null so the second HUNTING pass (entered
    // via the escape path) never reconfirms a map and flips back to MATCH_ACTIVE
    // before we get a chance to observe the HUNTING state.
    let mapTick = 0;
    const { deps, calls } = buildDeps({
        computeFrameStats: async () => {
            statsTick++;
            if (statsTick === 1 || statsTick >= 4) return { mean: 2, darkFrac: 0.95 };
            return { mean: 100, darkFrac: 0 };
        },
        hasFilledProgressBar: async () => true,
        recognizeMapText: async () => {
            mapTick++;
            return mapTick <= 2 ? { realm: null, map: 'Blood Lodge' } : null;
        },
        isEndgameScreen: async () => false,
        huntTimeoutMs: 500,
        huntPollMs: 10,
        matchPollMs: 10,
    });
    const sm = new DetectionStateMachine(deps);
    sm.start();
    await sleep(150);
    assert.equal(sm.state, 'HUNTING');
    assert.equal(calls.onMatchEnded.length, 1);
    sm.stop();
});

test('_run() survives an uncaught throw from a dependency on one tick and keeps operating afterward', async () => {
    let captureCalls = 0;
    const { deps } = buildDeps({
        captureFrame: async () => {
            captureCalls++;
            if (captureCalls === 1) throw new Error('boom: transient capture failure');
            return Buffer.from('frame');
        },
        computeFrameStats: async () => ({ mean: 2, darkFrac: 0.95 }),
        hasFilledProgressBar: async () => true,
        recognizeMapText: async () => ({ realm: null, map: 'Blood Lodge' }),
        idlePollMs: 10,
        huntPollMs: 10,
        matchPollMs: 10,
    });
    const sm = new DetectionStateMachine(deps);
    sm.start();
    await sleep(150);
    // If the throw killed the loop, state would be frozen at 'IDLE' and _running false.
    assert.equal(sm.state, 'MATCH_ACTIVE');
    assert.equal(sm._running, true);
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
