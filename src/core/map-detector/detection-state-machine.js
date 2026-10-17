'use strict';

const STATE = { IDLE: 'IDLE', HUNTING: 'HUNTING', MATCH_ACTIVE: 'MATCH_ACTIVE' };

class DetectionStateMachine {
    constructor(deps) {
        this.deps = deps;
        this._state = STATE.IDLE;
        this._running = false;
        this._loopPromise = null;

        // Bumped on every start()/stop(). A loop only keeps going (and only reports
        // anything) while its own generation is current, so a stop()+start() while
        // the old loop is still awaiting an OCR call can never leave two loops
        // running or let the stale one fire onMapDetected/onMatchEnded.
        this._generation = 0;

        // Cached from IDLE, since the lobby is usually gone by the time HUNTING starts.
        this._lastLobbyWasCustom = false;

        // Stops the MATCH_ACTIVE escape path (see _runMatchActive) from firing on the
        // tail of the loading screen we just came from.
        this._matchSeenBright = false;

        // A confident endgame read clears the overlay on its own; a low-confidence
        // one needs a second consecutive positive first -- gameplay pixels in the
        // CONTINUE corner occasionally OCR as text.
        this._endgameSeen = false;

        // A match ending may only clear a map the detector itself put up. Without
        // this, a phantom cycle (false loading-screen positive -> hunt timeout ->
        // false endgame positive) wipes a map the user picked by hand.
        this._detectorOwnsOverlay = false;

        // Consecutive ticks that saw a loading bar. A single sighting is only a
        // candidate: HUNTING starts after barConfirmTicks in a row.
        this._barSightings = 0;

        // The last hunt timed out without a map (usually a false loading-bar
        // positive: a repair/heal bar in a dark scene, the Quests tab). The next
        // hunt reads at huntBackoffPollMs until one confirms a map again.
        this._lastHuntFailed = false;
    }

    get state() { return this._state; }

    /** @returns {boolean} whether this tick's bar sighting completes the streak needed to start a hunt */
    _confirmBar() {
        this._barSightings++;
        if (this._barSightings < (this.deps.barConfirmTicks ?? 2)) return false;
        this._barSightings = 0;
        return true;
    }

    /** The user set or hid a map themselves -- whatever is on the overlay is
     *  no longer the detector's to clear when the match ends. */
    releaseOverlay() {
        this._detectorOwnsOverlay = false;
    }

    start() {
        if (this._running) return;
        this._running = true;
        const generation = ++this._generation;
        this._loopPromise = this._run(generation).catch(err => {
            console.error('DetectionStateMachine: loop crashed:', err);
            if (this._generation === generation) this._running = false;
        });
    }

    stop() {
        this._running = false;
        this._generation++;
        this._state = STATE.IDLE;
        this._barSightings = 0;
    }

    /** @returns {boolean} whether the loop that captured `generation` is still the live one */
    _live(generation) {
        return this._running && this._generation === generation;
    }

    async _run(generation) {
        while (this._live(generation)) {
            try {
                if (this._state === STATE.IDLE) {
                    await this._tickIdle(generation);
                } else if (this._state === STATE.HUNTING) {
                    await this._runHunting(generation);
                } else if (this._state === STATE.MATCH_ACTIVE) {
                    await this._runMatchActive(generation);
                }
            } catch (err) {
                if (!this._live(generation)) break; // stopped mid-tick (e.g. OCR disposed): not a failure
                // One bad tick shouldn't kill detection for the rest of the session.
                console.error('DetectionStateMachine: tick failed, continuing:', err);
                await sleep(this.deps.idlePollMs);
            }
        }
    }

    async _tickIdle(generation) {
        const frame = await this.deps.captureFrame();
        if (frame && this._live(generation)) {
            if (await this.deps.hasFilledProgressBar(frame)) {
                if (!this._live(generation)) return;
                if (this._confirmBar()) {
                    console.log('DetectionStateMachine: IDLE -> HUNTING (loading screen detected)');
                    this._state = STATE.HUNTING;
                    return;
                }
                await sleep(this.deps.idlePollMs);
                return;
            }
            this._barSightings = 0;
            // Remember whether the lobby looks custom, for detectInCustoms. The
            // flag is only read when detection in customs is off, so skip the
            // roster OCR pass (every idle tick) when it is on.
            if (this.deps.detectInCustoms()) {
                this._lastLobbyWasCustom = false;
            } else {
                const custom = await this.deps.isCustomLobby(frame);
                if (this._live(generation)) this._lastLobbyWasCustom = custom;
            }
        }
        await sleep(this.deps.idlePollMs);
    }

    async _runHunting(generation) {
        if (this._lastLobbyWasCustom && !this.deps.detectInCustoms()) {
            // Custom match, detection off for those: skip OCR, still track when it ends.
            console.log('DetectionStateMachine: HUNTING -> MATCH_ACTIVE (custom lobby, detectInCustoms is off -- skipping map-text OCR)');
            this._state = STATE.MATCH_ACTIVE;
            this._skipMatchActive = true;
            return;
        }
        this._skipMatchActive = false;

        // The game prints the map title in the intro that follows the loading
        // screen, never on the loading screen itself. While the bar is still up
        // the hunt only re-checks the bar (cheap) instead of running OCR, and the
        // OCR window (huntOcrWindowMs) counts from the last bar sighting. A false
        // positive (repair/heal bar in a dark scene, the Quests tab) therefore
        // costs at most one OCR window once the bar goes away, not a full
        // huntTimeoutMs of OCR. huntTimeoutMs caps the whole hunt.
        const startedAt = Date.now();
        const deadline = startedAt + this.deps.huntTimeoutMs;
        const ocrWindowMs = this.deps.huntOcrWindowMs ?? this.deps.huntTimeoutMs;
        const barPollMs = this.deps.huntBarPollMs ?? this.deps.huntPollMs;
        const ocrPollMs = this._lastHuntFailed ? (this.deps.huntBackoffPollMs ?? this.deps.huntPollMs) : this.deps.huntPollMs;
        let lastBarAt = startedAt;
        let ocrReads = 0;
        let pendingKey = null;
        let lastHeartbeatAt = startedAt;
        console.log(`DetectionStateMachine: HUNTING started (timeout ${this.deps.huntTimeoutMs}ms, OCR window ${ocrWindowMs}ms after the loading bar, OCR every ${ocrPollMs}ms${this._lastHuntFailed ? ' -- slowed down, the last hunt found no map' : ''})`);

        while (this._live(generation) && this._state === STATE.HUNTING && Date.now() < Math.min(deadline, lastBarAt + ocrWindowMs)) {
            let pollMs = ocrPollMs;
            const frame = await this.deps.captureFrame();
            if (frame && this._live(generation)) {
                const loading = await this.deps.hasFilledProgressBar(frame);
                if (!this._live(generation)) return;
                if (loading) {
                    lastBarAt = Date.now();
                    pendingKey = null;
                    pollMs = barPollMs;
                } else {
                    ocrReads++;
                    const result = await this.deps.recognizeMapText(frame);
                    if (!this._live(generation)) return;
                    if (result) {
                        const key = result.realm ? `${result.realm}/${result.map}` : result.map;
                        if (key === pendingKey) {
                            console.log(`DetectionStateMachine: HUNTING confirmed "${key}" after ${Date.now() - startedAt}ms (2 consecutive matching reads) -> MATCH_ACTIVE`);
                            this.deps.onMapDetected(key);
                            this._detectorOwnsOverlay = true;
                            this._matchSeenBright = false;
                            this._endgameSeen = false;
                            this._lastHuntFailed = false;
                            this._state = STATE.MATCH_ACTIVE;
                            return;
                        }
                        console.log(`DetectionStateMachine: HUNTING candidate "${key}" (needs one more matching read to confirm)`);
                        pendingKey = key;
                    }
                }
            }
            const now = Date.now();
            if (now - lastHeartbeatAt >= 2000) {
                console.log(`DetectionStateMachine: HUNTING still running -- ${now - startedAt}ms elapsed, ${ocrReads} OCR read(s), loading bar last seen ${now - lastBarAt}ms ago, no confirmed match yet`);
                lastHeartbeatAt = now;
            }
            await sleep(pollMs);
        }

        if (this._live(generation) && this._state === STATE.HUNTING) {
            console.log(`DetectionStateMachine: HUNTING timed out after ${Date.now() - startedAt}ms (${ocrReads} OCR read(s)) with no confirmed map -> MATCH_ACTIVE anyway (will keep watching for the match to end)`);
            this._lastHuntFailed = true;
            this._matchSeenBright = false;
            this._endgameSeen = false;
            this._state = STATE.MATCH_ACTIVE;
        }
    }

    /** onMatchEnded (and the overlay clear behind it) only fires for a map the
     *  detector confirmed itself; a hand-picked map survives the match ending. */
    _endMatch(reason) {
        if (this._detectorOwnsOverlay) this.deps.onMatchEnded(reason);
        this._detectorOwnsOverlay = false;
    }

    /** End-of-match detection is opt-in (settings `endgameDetection`). */
    _endgameEnabled() {
        return this.deps.endgameEnabled ? this.deps.endgameEnabled() === true : true;
    }

    async _runMatchActive(generation) {
        if (this._skipMatchActive) {
            // Just wait for the next loading screen, no endgame OCR for opted-out matches.
            await this._tickIdle(generation);
            if (this._state === STATE.HUNTING) {
                this._state = STATE.IDLE; // re-check the custom flag fresh next lobby
                // _tickIdle()'s near-black+bar branch never sleeps (fast reaction from
                // IDLE), so we need a sleep here or this spins and starves the event loop.
                await sleep(this.deps.matchPollMs);
            }
            return;
        }

        const endgameEnabled = this._endgameEnabled();
        const frame = await this.deps.captureFrame();
        if (frame && this._live(generation)) {
            // Disabled: no end-screen OCR at all; the map stays up until the
            // next loading screen brings a new one.
            const endgame = endgameEnabled ? await this.deps.detectEndgame(frame) : {seen: false};
            if (!this._live(generation)) return;
            if (endgame.seen) {
                if (endgame.confident || this._endgameSeen) {
                    const how = endgame.confident ? 'confident read' : 'confirmed on 2 consecutive reads';
                    console.log(`DetectionStateMachine: MATCH_ACTIVE -> IDLE (endgame screen ${how}${this._detectorOwnsOverlay ? ', clearing overlay' : ' -- overlay untouched, it is not the detector\'s map'})`);
                    this._endMatch(`end screen ${how}: ${endgame.text || '?'}`);
                    this._state = STATE.IDLE;
                    return;
                }
                // One low-confidence read is only a candidate.
                console.log('DetectionStateMachine: MATCH_ACTIVE endgame candidate (low-confidence read, needs one more consecutive read to confirm)');
                this._endgameSeen = true;
                await sleep(this.deps.matchPollMs);
                return;
            }
            this._endgameSeen = false;

            // Missed the endgame screen? A fresh loading screen also means the match
            // ended, so jump straight to HUNTING instead of going back through IDLE.
            const loadingScreen = await this.deps.hasFilledProgressBar(frame);
            if (!this._live(generation)) return;
            if (loadingScreen) {
                // One sighting is only a candidate (_confirmBar): a dark scene
                // with an action bar passes a single check far more often than
                // a run of them.
                if (this._matchSeenBright && this._confirmBar()) {
                    // A dark scene with an action bar (repair/heal/unhook) at the
                    // bottom can pass for a loading bar; with end-of-match
                    // detection off this only starts a hunt and never clears the map.
                    if (endgameEnabled) {
                        console.log('DetectionStateMachine: MATCH_ACTIVE -> HUNTING (missed the endgame screen, but a fresh loading screen appeared -- treating the previous match as over)');
                        this._endMatch('loading bar seen during the match (missed end screen)');
                    } else {
                        console.log('DetectionStateMachine: MATCH_ACTIVE -> HUNTING (loading screen seen; end-of-match detection off, overlay kept)');
                    }
                    this._state = STATE.HUNTING;
                    return;
                }
            } else {
                // Real gameplay seen, so a later bar sighting is a genuinely new loading screen.
                this._matchSeenBright = true;
                this._barSightings = 0;
            }
        }
        await sleep(this.deps.matchPollMs);
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { DetectionStateMachine, STATE };
