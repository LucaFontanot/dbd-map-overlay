'use strict';

const STATE = { IDLE: 'IDLE', HUNTING: 'HUNTING', MATCH_ACTIVE: 'MATCH_ACTIVE' };

class DetectionStateMachine {
    constructor(deps) {
        this.deps = deps;
        this._state = STATE.IDLE;
        this._running = false;
        this._loopPromise = null;

        // Cached from IDLE, since the lobby is usually gone by the time HUNTING starts.
        this._lastLobbyWasCustom = false;

        // Stops the MATCH_ACTIVE escape path (see _runMatchActive) from firing on the
        // tail of the loading screen we just came from.
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
                // One bad tick shouldn't kill detection for the rest of the session.
                console.error('DetectionStateMachine: tick failed, continuing:', err);
                await sleep(this.deps.idlePollMs);
            }
        }
    }

    async _tickIdle() {
        const frame = await this.deps.captureFrame();
        if (frame) {
            // Remember whether the lobby looks custom, for detectInCustoms.
            const stats = await this.deps.computeFrameStats(frame);
            if (this.deps.isNearBlackFrame(stats)) {
                if (await this.deps.hasFilledProgressBar(frame)) {
                    console.log(`DetectionStateMachine: IDLE -> HUNTING (near-black frame with a filled progress bar detected; mean=${stats.mean?.toFixed?.(1)}, darkFrac=${stats.darkFrac?.toFixed?.(2)})`);
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
            // Custom match, detection off for those: skip OCR, still track when it ends.
            console.log('DetectionStateMachine: HUNTING -> MATCH_ACTIVE (custom lobby, detectInCustoms is off -- skipping map-text OCR)');
            this._state = STATE.MATCH_ACTIVE;
            this._skipMatchActive = true;
            return;
        }
        this._skipMatchActive = false;

        const startedAt = Date.now();
        const deadline = startedAt + this.deps.huntTimeoutMs;
        let pendingKey = null;
        let lastHeartbeatAt = startedAt;
        console.log(`DetectionStateMachine: HUNTING started (timeout ${this.deps.huntTimeoutMs}ms, polling every ${this.deps.huntPollMs}ms)`);

        while (this._running && this._state === STATE.HUNTING && Date.now() < deadline) {
            const frame = await this.deps.captureFrame();
            if (frame) {
                const result = await this.deps.recognizeMapText(frame);
                if (result) {
                    const key = result.realm ? `${result.realm}/${result.map}` : result.map;
                    if (key === pendingKey) {
                        console.log(`DetectionStateMachine: HUNTING confirmed "${key}" after ${Date.now() - startedAt}ms (2 consecutive matching reads) -> MATCH_ACTIVE`);
                        this.deps.onMapDetected(key);
                        this._matchSeenBright = false;
                        this._state = STATE.MATCH_ACTIVE;
                        return;
                    }
                    console.log(`DetectionStateMachine: HUNTING candidate "${key}" (needs one more matching read to confirm)`);
                    pendingKey = key;
                }
            }
            const now = Date.now();
            if (now - lastHeartbeatAt >= 2000) {
                console.log(`DetectionStateMachine: HUNTING still running -- ${now - startedAt}ms elapsed of ${this.deps.huntTimeoutMs}ms timeout, no confirmed match yet`);
                lastHeartbeatAt = now;
            }
            await sleep(this.deps.huntPollMs);
        }

        if (this._running) {
            console.log(`DetectionStateMachine: HUNTING timed out after ${Date.now() - startedAt}ms with no confirmed map -> MATCH_ACTIVE anyway (will keep watching for the match to end)`);
            this._matchSeenBright = false;
            this._state = STATE.MATCH_ACTIVE;
        }
    }

    async _runMatchActive() {
        if (this._skipMatchActive) {
            // Just wait for the next loading screen, no endgame OCR for opted-out matches.
            await this._tickIdle();
            if (this._state === STATE.HUNTING) {
                this._state = STATE.IDLE; // re-check the custom flag fresh next lobby
                // _tickIdle()'s near-black+bar branch never sleeps (fast reaction from
                // IDLE), so we need a sleep here or this spins and starves the event loop.
                await sleep(this.deps.matchPollMs);
            }
            return;
        }

        const frame = await this.deps.captureFrame();
        if (frame) {
            if (await this.deps.isEndgameScreen(frame)) {
                console.log('DetectionStateMachine: MATCH_ACTIVE -> IDLE (endgame screen detected, clearing overlay)');
                this.deps.onMatchEnded();
                this._state = STATE.IDLE;
                return;
            }

            // Missed the endgame screen? A fresh loading screen also means the match
            // ended, so jump straight to HUNTING instead of going back through IDLE.
            const stats = await this.deps.computeFrameStats(frame);
            if (this.deps.isNearBlackFrame(stats)) {
                if (this._matchSeenBright && await this.deps.hasFilledProgressBar(frame)) {
                    console.log('DetectionStateMachine: MATCH_ACTIVE -> HUNTING (missed the endgame screen, but a fresh loading screen appeared -- treating the previous match as over)');
                    this.deps.onMatchEnded();
                    this._state = STATE.HUNTING;
                    return;
                }
            } else {
                // Real gameplay seen, so a later near-black+bar frame is a genuinely new loading screen.
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
