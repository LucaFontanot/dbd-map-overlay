const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DetectionStateMachine } = require('../../src/core/map-detector/detection-state-machine');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Polls `cond` until it holds or `timeoutMs` passes; returns its last value. */
async function waitFor(cond, timeoutMs = 500) {
    const deadline = Date.now() + timeoutMs;
    while (!cond() && Date.now() < deadline) await sleep(2);
    return cond();
}

/**
 * The fake game shows one screen at a time and the test switches it:
 *   'lobby' / 'gameplay' -> no loading bar, no title
 *   'loading'            -> loading bar (the map title is never printed here)
 *   'intro'              -> the map title, no bar
 *   'end'                -> end screen
 * Each dependency answers from the frame it is handed, so the result does not
 * depend on how many times the state machine happens to call it.
 */
function buildDeps(overrides = {}) {
    const world = { screen: 'lobby' };
    const calls = { onMapDetected: [], onMatchEnded: [], recognize: 0 };
    const deps = {
        captureFrame: async () => world.screen,
        hasFilledProgressBar: async (frame) => frame === 'loading',
        isCustomLobby: async () => false,
        recognizeMapText: async (frame) => {
            calls.recognize++;
            return frame === 'intro' ? { realm: null, map: 'Blood Lodge' } : null;
        },
        detectEndgame: async (frame) => (frame === 'end' ? { seen: true, confident: true, text: '"CONTINUE" (0.99)' } : { seen: false, confident: false }),
        onMapDetected: (key) => calls.onMapDetected.push(key),
        onMatchEnded: (reason) => calls.onMatchEnded.push(reason),
        detectInCustoms: () => true,
        idlePollMs: 5,
        huntPollMs: 5,
        huntTimeoutMs: 5000,
        huntOcrWindowMs: 40,
        matchPollMs: 5,
        ...overrides,
    };
    return { deps, calls, world };
}

/** Starts the machine and stops it when the test ends, even on a failed assertion. */
function startMachine(t, deps) {
    const sm = new DetectionStateMachine(deps);
    t.after(() => sm.stop());
    sm.start();
    return sm;
}

/** Loading screen, then the intro title: the detector confirms 'Blood Lodge'. */
async function playIntro(sm, world) {
    world.screen = 'loading';
    assert.ok(await waitFor(() => sm.state === 'HUNTING'), 'the loading screen should start a hunt');
    world.screen = 'intro';
    assert.ok(await waitFor(() => sm.state === 'MATCH_ACTIVE'), 'the intro title should confirm the map');
    world.screen = 'gameplay';
    await sleep(30);
}

test('stays IDLE while no loading bar is detected', async (t) => {
    const { deps } = buildDeps();
    const sm = startMachine(t, deps);
    await sleep(50);
    assert.equal(sm.state, 'IDLE');
});

test('a loading bar enters HUNTING, and the intro title confirmed on 2 reads fires onMapDetected then moves to MATCH_ACTIVE', async (t) => {
    const { deps, calls, world } = buildDeps();
    const sm = startMachine(t, deps);
    await playIntro(sm, world);
    assert.equal(sm.state, 'MATCH_ACTIVE');
    assert.deepEqual(calls.onMapDetected, ['Blood Lodge']);
    assert.ok(calls.recognize >= 2, 'expected at least 2 consecutive OCR reads before confirming');
});

test('a loading bar seen on a single tick does not start a hunt', async (t) => {
    let barReads = 0;
    const { deps, calls } = buildDeps({
        // one bar sighting, then the screen is a normal one again
        hasFilledProgressBar: async () => ++barReads === 1,
    });
    const sm = startMachine(t, deps);
    await sleep(60);
    assert.equal(sm.state, 'IDLE');
    assert.equal(calls.recognize, 0);
});

test('barConfirmTicks sets how many consecutive bar sightings start a hunt', async (t) => {
    let barReads = 0;
    const { deps } = buildDeps({
        barConfirmTicks: 3,
        // two sightings, a gap, then two more: never three in a row
        hasFilledProgressBar: async () => [1, 2, 4, 5].includes(++barReads),
    });
    const sm = startMachine(t, deps);
    await sleep(80);
    assert.equal(sm.state, 'IDLE');
});

test('no OCR runs while the loading bar is still on screen (the title only shows in the intro)', async (t) => {
    const { deps, calls, world } = buildDeps({ huntOcrWindowMs: 5000 });
    const sm = startMachine(t, deps);
    world.screen = 'loading';
    assert.ok(await waitFor(() => sm.state === 'HUNTING'));
    await sleep(60);
    assert.equal(sm.state, 'HUNTING');
    assert.equal(calls.recognize, 0);
});

test('a single-tick OCR misread does not fire onMapDetected (requires 2 consecutive identical reads)', async (t) => {
    let tick = 0;
    const results = [
        { realm: null, map: 'Wrong Map' },
        { realm: 'Autohaven Wreckers', map: 'Blood Lodge' },
        { realm: 'Autohaven Wreckers', map: 'Blood Lodge' },
    ];
    const { deps, calls, world } = buildDeps({
        recognizeMapText: async (frame) => (frame === 'intro' ? results[Math.min(tick++, results.length - 1)] : null),
    });
    const sm = startMachine(t, deps);
    await playIntro(sm, world);
    assert.deepEqual(calls.onMapDetected, ['Autohaven Wreckers/Blood Lodge']);
});

test('a hunt with no title ends huntOcrWindowMs after the bar went away, long before huntTimeoutMs', async (t) => {
    const { deps, calls, world } = buildDeps({ huntTimeoutMs: 10000, huntOcrWindowMs: 30 });
    const sm = startMachine(t, deps);
    world.screen = 'loading';
    assert.ok(await waitFor(() => sm.state === 'HUNTING'));
    world.screen = 'gameplay';
    assert.ok(await waitFor(() => sm.state === 'MATCH_ACTIVE', 300), 'the OCR window should close the hunt');
    assert.deepEqual(calls.onMapDetected, []);
});

test('the bar coming back during a hunt reopens the OCR window', async (t) => {
    const { deps, world } = buildDeps({ huntOcrWindowMs: 60 });
    const sm = startMachine(t, deps);
    world.screen = 'loading';
    assert.ok(await waitFor(() => sm.state === 'HUNTING'));
    // The bar flickers off and back on for longer than one OCR window in total.
    for (let i = 0; i < 4; i++) {
        world.screen = 'gameplay';
        await sleep(30);
        world.screen = 'loading';
        await sleep(15);
    }
    assert.equal(sm.state, 'HUNTING');
});

test('huntTimeoutMs caps a hunt even while the bar stays up', async (t) => {
    const { deps, calls, world } = buildDeps({ huntTimeoutMs: 40, huntOcrWindowMs: 5000 });
    const sm = startMachine(t, deps);
    world.screen = 'loading';
    assert.ok(await waitFor(() => sm.state === 'HUNTING'));
    assert.ok(await waitFor(() => sm.state === 'MATCH_ACTIVE', 300));
    assert.equal(calls.recognize, 0);
});

test('after a hunt that found no map the next hunt reads at huntBackoffPollMs', async (t) => {
    const { deps, calls, world } = buildDeps({ huntPollMs: 2, huntBackoffPollMs: 200, huntOcrWindowMs: 60 });
    const sm = startMachine(t, deps);

    // First hunt: no title, full-speed reads, times out.
    world.screen = 'loading';
    assert.ok(await waitFor(() => sm.state === 'HUNTING'));
    world.screen = 'gameplay';
    await sleep(30);
    const fastReads = calls.recognize;
    assert.ok(await waitFor(() => sm.state === 'MATCH_ACTIVE', 300));
    assert.ok(fastReads >= 3, `first hunt should read at full speed, saw ${fastReads}`);

    // Second hunt (a fresh bar mid-match): backed off.
    await sleep(20);
    world.screen = 'loading';
    assert.ok(await waitFor(() => sm.state === 'HUNTING'));
    const before = calls.recognize;
    world.screen = 'gameplay';
    await sleep(30);
    assert.ok(calls.recognize - before <= 1, `backed-off hunt read ${calls.recognize - before} times in 30 ms`);
});

test('MATCH_ACTIVE polls for the endgame screen and returns to IDLE, firing onMatchEnded', async (t) => {
    const { deps, calls, world } = buildDeps({
        detectEndgame: async (frame) => ({ seen: frame === 'end', confident: false }),
    });
    const sm = startMachine(t, deps);
    await playIntro(sm, world);
    world.screen = 'end';
    assert.ok(await waitFor(() => sm.state === 'IDLE'));
    assert.equal(calls.onMatchEnded.length, 1);
});

test('a single confident endgame read clears the overlay immediately, no second read needed', async (t) => {
    let endgameReads = 0;
    const { deps, calls, world } = buildDeps({
        detectEndgame: async (frame) => {
            if (frame !== 'end') return { seen: false, confident: false };
            endgameReads++;
            return { seen: true, confident: true };
        },
    });
    const sm = startMachine(t, deps);
    await playIntro(sm, world);
    world.screen = 'end';
    assert.ok(await waitFor(() => sm.state === 'IDLE'));
    assert.equal(calls.onMatchEnded.length, 1);
    assert.equal(endgameReads, 1, 'a confident read must end the match on the spot');
});

test('a single spurious low-confidence endgame read does not clear the overlay (requires 2 consecutive reads)', async (t) => {
    let spurious = false;
    const { deps, calls, world } = buildDeps({
        detectEndgame: async () => {
            const seen = spurious;
            spurious = false;
            return { seen, confident: false };
        },
    });
    const sm = startMachine(t, deps);
    await playIntro(sm, world);
    spurious = true;
    await sleep(60);
    assert.equal(sm.state, 'MATCH_ACTIVE');
    assert.deepEqual(calls.onMatchEnded, []);
});

test('two consecutive low-confidence endgame reads clear the overlay even after an earlier spurious one', async (t) => {
    let script = [];
    const { deps, calls, world } = buildDeps({
        detectEndgame: async () => ({ seen: script.length ? script.shift() : false, confident: false }),
    });
    const sm = startMachine(t, deps);
    await playIntro(sm, world);
    script = [true, false, true, true];
    assert.ok(await waitFor(() => sm.state === 'IDLE'));
    assert.equal(calls.onMatchEnded.length, 1);
});

test('MATCH_ACTIVE detects a fresh loading screen (missed endgame screen) and transitions straight to HUNTING via onMatchEnded', async (t) => {
    const { deps, calls, world } = buildDeps({ detectEndgame: async () => ({ seen: false, confident: false }) });
    const sm = startMachine(t, deps);
    await playIntro(sm, world);
    world.screen = 'loading';
    assert.ok(await waitFor(() => sm.state === 'HUNTING'));
    assert.equal(calls.onMatchEnded.length, 1);
});

test('a single bar sighting mid-match (dark scene + action bar) does not start a hunt', async (t) => {
    let flash = false;
    const { deps, calls, world } = buildDeps({
        hasFilledProgressBar: async (frame) => {
            if (flash) { flash = false; return true; }
            return frame === 'loading';
        },
    });
    const sm = startMachine(t, deps);
    await playIntro(sm, world);
    const reads = calls.recognize;
    flash = true;
    await sleep(60);
    assert.equal(sm.state, 'MATCH_ACTIVE');
    assert.equal(calls.recognize, reads);
});

test('_run() survives an uncaught throw from a dependency on one tick and keeps operating afterward', async (t) => {
    let captureCalls = 0;
    const { deps, world } = buildDeps();
    deps.captureFrame = async () => {
        if (++captureCalls === 1) throw new Error('boom: transient capture failure');
        return world.screen;
    };
    const sm = startMachine(t, deps);
    await playIntro(sm, world);
    // If the throw killed the loop, state would be frozen at 'IDLE' and _running false.
    assert.equal(sm.state, 'MATCH_ACTIVE');
    assert.equal(sm._running, true);
});

test('a phantom cycle (hunt timeout, then endgame reads) never fires onMatchEnded -- the overlay is not the detector\'s to clear', async (t) => {
    const { deps, calls, world } = buildDeps({ huntOcrWindowMs: 20 });
    const sm = startMachine(t, deps);
    world.screen = 'loading';
    assert.ok(await waitFor(() => sm.state === 'HUNTING'));
    world.screen = 'gameplay';
    assert.ok(await waitFor(() => sm.state === 'MATCH_ACTIVE'));
    world.screen = 'end';
    assert.ok(await waitFor(() => sm.state === 'IDLE'), 'the match-ended transition itself still happens');
    assert.deepEqual(calls.onMapDetected, []);
    assert.deepEqual(calls.onMatchEnded, [], 'no detector map was showing, so nothing may be cleared');
});

test('the missed-endgame loading-screen escape also skips onMatchEnded when no map was confirmed', async (t) => {
    const { deps, calls, world } = buildDeps({ huntOcrWindowMs: 20 });
    const sm = startMachine(t, deps);
    world.screen = 'loading';
    assert.ok(await waitFor(() => sm.state === 'HUNTING'));
    world.screen = 'gameplay';
    assert.ok(await waitFor(() => sm.state === 'MATCH_ACTIVE'));
    await sleep(20);
    world.screen = 'loading';
    assert.ok(await waitFor(() => sm.state === 'HUNTING'));
    assert.deepEqual(calls.onMatchEnded, []);
});

test('releaseOverlay() makes a confirmed detection survive the match ending -- the user overrode the map by hand', async (t) => {
    const { deps, calls, world } = buildDeps();
    const sm = startMachine(t, deps);
    await playIntro(sm, world);
    assert.deepEqual(calls.onMapDetected, ['Blood Lodge']);
    sm.releaseOverlay();
    world.screen = 'end';
    assert.ok(await waitFor(() => sm.state === 'IDLE'));
    assert.deepEqual(calls.onMatchEnded, [], 'the user\'s manual pick must survive');
});

test('detectInCustoms=false skips a custom lobby entirely: no map-text OCR, no onMapDetected, endgame handling skipped', async (t) => {
    const { deps, calls, world } = buildDeps({
        isCustomLobby: async () => true,
        detectInCustoms: () => false,
    });
    const sm = startMachine(t, deps);
    await sleep(20); // IDLE classifies the lobby as custom
    world.screen = 'loading';
    await sleep(30);
    world.screen = 'intro';
    await sleep(30);
    world.screen = 'end';
    await sleep(30);
    assert.equal(calls.recognize, 0);
    assert.deepEqual(calls.onMapDetected, []);
    assert.deepEqual(calls.onMatchEnded, []);
});

test('IDLE skips the roster OCR pass when detection in customs is on (its result would be unused)', async (t) => {
    let lobbyReads = 0;
    const { deps } = buildDeps({
        isCustomLobby: async () => { lobbyReads++; return true; },
        detectInCustoms: () => true,
    });
    startMachine(t, deps);
    await sleep(60);
    assert.equal(lobbyReads, 0);
});

test('IDLE still classifies the lobby when detection in customs is off', async (t) => {
    let lobbyReads = 0;
    const { deps } = buildDeps({
        isCustomLobby: async () => { lobbyReads++; return false; },
        detectInCustoms: () => false,
    });
    startMachine(t, deps);
    await sleep(60);
    assert.ok(lobbyReads > 0);
});

test('an OCR read that finishes after stop() never reports a map, even after a restart', async (t) => {
    let release;
    let reads = 0;
    const { deps, calls, world } = buildDeps({
        recognizeMapText: async () => {
            reads++;
            if (reads === 2) await new Promise(r => { release = r; }); // second (confirming) read hangs
            return { realm: null, map: 'Blood Lodge' };
        },
        huntOcrWindowMs: 10000,
    });
    const sm = startMachine(t, deps);
    world.screen = 'loading';
    assert.ok(await waitFor(() => sm.state === 'HUNTING'));
    world.screen = 'intro';
    assert.ok(await waitFor(() => !!release), 'the confirming read should be in flight');
    sm.stop();
    // Restart with a loop that never gets a map read through.
    deps.recognizeMapText = async () => null;
    sm.start();
    release();
    await sleep(40);
    assert.deepEqual(calls.onMapDetected, [], 'the stale loop must not fire onMapDetected');
});

test('stop() + start() leaves exactly one loop running', async (t) => {
    let captures = 0;
    const { deps } = buildDeps({
        captureFrame: async () => { captures++; await sleep(5); return 'lobby'; },
        idlePollMs: 20,
    });
    const sm = startMachine(t, deps);
    await sleep(2); // first loop is mid-capture
    sm.stop();
    sm.start();
    captures = 0;
    await sleep(200);
    sm.stop();
    // One loop: ~25 ms per tick → about 8 captures in 200 ms; two loops would double it.
    assert.ok(captures <= 10, `expected a single loop, saw ${captures} captures`);
});

test('end-of-match detection off: no end-screen OCR and a confident end screen never clears the map', async (t) => {
    let endgameCalls = 0;
    const { deps, calls, world } = buildDeps({
        detectEndgame: async () => {
            endgameCalls++;
            return { seen: true, confident: true, text: '"CONTINUE" (1.00)' };
        },
        endgameEnabled: () => false,
    });
    const sm = startMachine(t, deps);
    await playIntro(sm, world);
    world.screen = 'end';
    await sleep(40);
    assert.equal(sm.state, 'MATCH_ACTIVE');
    assert.deepEqual(calls.onMapDetected, ['Blood Lodge']);
    assert.equal(endgameCalls, 0);
    assert.equal(calls.onMatchEnded.length, 0);
});

test('end-of-match detection off: a loading bar mid-match starts a hunt but keeps the map', async (t) => {
    const { deps, calls, world } = buildDeps({ endgameEnabled: () => false });
    const sm = startMachine(t, deps);
    await playIntro(sm, world);
    world.screen = 'loading';
    assert.ok(await waitFor(() => sm.state === 'HUNTING'));
    assert.equal(calls.onMatchEnded.length, 0);
});

test('onMatchEnded reports why the match ended', async (t) => {
    const { deps, calls, world } = buildDeps({ endgameEnabled: () => true });
    const sm = startMachine(t, deps);
    await playIntro(sm, world);
    world.screen = 'end';
    assert.ok(await waitFor(() => calls.onMatchEnded.length > 0));
    assert.match(calls.onMatchEnded[0], /end screen confident read: "CONTINUE" \(0\.99\)/);
});
