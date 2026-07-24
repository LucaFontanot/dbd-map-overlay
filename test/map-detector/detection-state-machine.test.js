const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DetectionStateMachine } = require('../../src/core/map-detector/detection-state-machine');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function buildDeps(overrides = {}) {
    const calls = { onMapDetected: [], onMatchEnded: [] };
    const deps = {
        captureFrame: async () => Buffer.from('frame'),
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

test('stays IDLE while no loading bar is detected', async () => {
    const { deps } = buildDeps();
    const sm = new DetectionStateMachine(deps);
    sm.start();
    await sleep(50);
    assert.equal(sm.state, 'IDLE');
    sm.stop();
});

test('a filled bar enters HUNTING, and a confirmed map fires onMapDetected then moves to MATCH_ACTIVE', async () => {
    let tick = 0;
    const { deps, calls } = buildDeps({
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
    // isEndgameScreen fires first in MATCH_ACTIVE and returns before hasFilledProgressBar
    // is ever consulted there, so this only needs to report a bar ONCE (to enter HUNTING
    // the first time) -- if it kept reporting one, the machine would keep re-entering
    // HUNTING/MATCH_ACTIVE forever and there'd be no reliable moment to observe it
    // "settled" in IDLE.
    let calls_ = 0;
    const { deps, calls } = buildDeps({
        hasFilledProgressBar: async () => calls_++ === 0,
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
    // hasFilledProgressBar sequencing:
    //   tick 1        -> true: enters HUNTING from IDLE.
    //   ticks 2-3     -> false: MATCH_ACTIVE steady state, no loading screen yet
    //                    (this is what sets _matchSeenBright).
    //   tick 4 onward -> true again: the NEXT match's loading screen has appeared,
    //                    even though isEndgameScreen (below) never fires -- this
    //                    is the independent escape path.
    let barTick = 0;
    // recognizeMapText: first two calls agree (confirms the initial map, entering
    // MATCH_ACTIVE); after that, return null so the second HUNTING pass (entered
    // via the escape path) never reconfirms a map and flips back to MATCH_ACTIVE
    // before we get a chance to observe the HUNTING state.
    let mapTick = 0;
    const { deps, calls } = buildDeps({
        hasFilledProgressBar: async () => {
            barTick++;
            return barTick === 1 || barTick >= 4;
        },
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
    // First IDLE tick must report NO bar so isCustomLobby() actually gets checked and
    // cached (the real _tickIdle only calls isCustomLobby when no bar is seen) -- every
    // tick after that simulates the loading screen appearing.
    let tick = 0;
    const { deps, calls } = buildDeps({
        hasFilledProgressBar: async () => tick++ !== 0,
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
