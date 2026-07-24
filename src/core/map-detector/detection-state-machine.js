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
            if (this._state === STATE.IDLE) {
                await this._tickIdle();
            } else if (this._state === STATE.HUNTING) {
                await this._runHunting();
            } else if (this._state === STATE.MATCH_ACTIVE) {
                await this._runMatchActive();
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
                        this._state = STATE.MATCH_ACTIVE;
                        return;
                    }
                    pendingKey = key;
                }
            }
            await sleep(this.deps.huntPollMs);
        }

        if (this._running) this._state = STATE.MATCH_ACTIVE;
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
        if (frame && await this.deps.isEndgameScreen(frame)) {
            this.deps.onMatchEnded();
            this._state = STATE.IDLE;
            return;
        }
        await sleep(this.deps.matchPollMs);
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { DetectionStateMachine, STATE };
