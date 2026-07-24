'use strict';

const STATE = { IDLE: 'IDLE', HUNTING: 'HUNTING', MATCH_ACTIVE: 'MATCH_ACTIVE' };

class DetectionStateMachine {
    constructor(deps) {
        this.deps = deps;
        this._state = STATE.IDLE;
        this._running = false;
        this._loopPromise = null;

        // Best-effort, cached across the IDLE state: the lobby before the current
        // loading screen might already be gone by the time HUNTING starts, so we
        // remember the last classification rather than trying to re-derive it mid-load.
        this._lastLobbyWasCustom = false;

        // Edge-detector for MATCH_ACTIVE's missed-endgame-screen escape path (see
        // _runMatchActive): the tail end of the loading screen that HUNTING just
        // confirmed is itself near-black + filled-bar, so the very first MATCH_ACTIVE
        // tick can still see that same lingering frame. Only treat a near-black +
        // filled-bar frame as a genuinely NEW loading screen once we've observed at
        // least one non-near-black (real gameplay) frame since entering MATCH_ACTIVE.
        this._matchSeenBright = false;
    }

    get state() { return this._state; }

    start() {
        if (this._running) return;
        this._running = true;
        this._loopPromise = this._run().catch(err => {
            console.error('DetectionStateMachine: loop crashed:', err);
            this._running = false;
        });
    }

    stop() {
        this._running = false;
        this._state = STATE.IDLE;
    }

    async _run() {
        while (this._running) {
            try {
                if (this._state === STATE.IDLE) {
                    await this._tickIdle();
                } else if (this._state === STATE.HUNTING) {
                    await this._runHunting();
                } else if (this._state === STATE.MATCH_ACTIVE) {
                    await this._runMatchActive();
                }
            } catch (err) {
                // A single bad tick (transient capture/OCR/classifier failure) must not
                // kill automatic detection for the rest of the app session -- log and
                // keep looping. A brief sleep avoids a tight error-retry loop if
                // whatever threw is persistently broken.
                console.error('DetectionStateMachine: tick failed, continuing:', err);
                await sleep(this.deps.idlePollMs);
            }
        }
    }

    async _tickIdle() {
        const frame = await this.deps.captureFrame();
        if (frame) {
            // Opportunistically remember whether the current lobby looks custom.
            // Cheap relative to a HUNTING tick -- still gated behind having a frame at all.
            const stats = await this.deps.computeFrameStats(frame);
            if (this.deps.isNearBlackFrame(stats)) {
                if (await this.deps.hasFilledProgressBar(frame)) {
                    this._state = STATE.HUNTING;
                    return;
                }
            } else {
                this._lastLobbyWasCustom = await this.deps.isCustomLobby(frame);
            }
        }
        await sleep(this.deps.idlePollMs);
    }

    async _runHunting() {
        if (this._lastLobbyWasCustom && !this.deps.detectInCustoms()) {
            // Skip the expensive map-text OCR entirely for opted-out custom matches --
            // still transition to MATCH_ACTIVE so we track when to return to IDLE,
            // but never report a map or watch for the endgame screen (see _runMatchActive).
            this._state = STATE.MATCH_ACTIVE;
            this._skipMatchActive = true;
            return;
        }
        this._skipMatchActive = false;

        const deadline = Date.now() + this.deps.huntTimeoutMs;
        let pendingKey = null;

        while (this._running && this._state === STATE.HUNTING && Date.now() < deadline) {
            const frame = await this.deps.captureFrame();
            if (frame) {
                const result = await this.deps.recognizeMapText(frame);
                if (result) {
                    const key = result.realm ? `${result.realm}/${result.map}` : result.map;
                    if (key === pendingKey) {
                        this.deps.onMapDetected(key);
                        this._matchSeenBright = false;
                        this._state = STATE.MATCH_ACTIVE;
                        return;
                    }
                    pendingKey = key;
                }
            }
            await sleep(this.deps.huntPollMs);
        }

        if (this._running) {
            this._matchSeenBright = false;
            this._state = STATE.MATCH_ACTIVE;
        }
    }

    async _runMatchActive() {
        if (this._skipMatchActive) {
            // Opted-out custom match: just wait for a near-black frame with a bar again
            // (next match's loading screen), skipping all endgame OCR in between.
            await this._tickIdle();
            if (this._state === STATE.HUNTING) {
                this._state = STATE.IDLE; // re-evaluate custom flag fresh next lobby
                // _tickIdle() returns immediately (no internal sleep) on the near-black+bar
                // branch, by design, so the primary IDLE loop reacts to a loading screen
                // without delay. Reused here, that same branch would otherwise let this
                // IDLE<->HUNTING<->MATCH_ACTIVE cycle spin with zero macrotask yields
                // whenever the polled frame doesn't change between ticks -- a real hang,
                // not just slow polling, since an unbroken chain of already-resolved
                // promises starves the event loop and timers (including this class's own
                // sleep() calls and setTimeout in general) never get a chance to fire.
                await sleep(this.deps.matchPollMs);
            }
            return;
        }

        const frame = await this.deps.captureFrame();
        if (frame) {
            if (await this.deps.isEndgameScreen(frame)) {
                this.deps.onMatchEnded();
                this._state = STATE.IDLE;
                return;
            }

            // Independent escape path: the endgame screen can be missed entirely (alt-tab
            // across the scoreboard, a transient OCR/ROI miss), which would otherwise strand
            // this state forever -- a loading screen is never shown mid-match, so seeing the
            // same near-black + filled-progress-bar signal _tickIdle() uses unambiguously means
            // the previous match already ended. Skip straight to HUNTING (not IDLE) since we've
            // already confirmed the new loading screen is present.
            const stats = await this.deps.computeFrameStats(frame);
            if (this.deps.isNearBlackFrame(stats)) {
                if (this._matchSeenBright && await this.deps.hasFilledProgressBar(frame)) {
                    this.deps.onMatchEnded();
                    this._state = STATE.HUNTING;
                    return;
                }
            } else {
                // Real gameplay frame observed -- any subsequent near-black + filled-bar
                // frame is now unambiguously a NEW loading screen, not just the tail end
                // of the one HUNTING already confirmed us out of.
                this._matchSeenBright = true;
            }
        }
        await sleep(this.deps.matchPollMs);
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { DetectionStateMachine, STATE };
