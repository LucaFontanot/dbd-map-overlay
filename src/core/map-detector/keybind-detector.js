'use strict';

/**
 * KeybindDetector — the "keybind detection" mode: no background tick at all.
 * The user presses a global hotkey during the map intro and trigger() starts a
 * short burst of map-title reads (every pollMs, for at most burstMs) that stops
 * at the first match. A press during a running burst pushes its deadline out
 * instead of starting a second loop.
 *
 * The first match wins (the hunt in DetectionStateMachine wants two matching
 * reads): the user asked for this read, and a wrong pick is visible and fixed
 * by pressing again.
 *
 * deps: captureFrame, recognizeMapText, onMapDetected(key), onStatus({state,
 * reason?, key?, reads?}) with state 'scanning'|'matched'|'not-found', optional
 * onError(err), pollMs, burstMs.
 */
class KeybindDetector {
    constructor(deps) {
        this.deps = deps;
        this._running = false;
        // Bumped on start()/stop(): a burst only reports while its generation is current.
        this._generation = 0;
        this._deadline = 0;
        this._burst = null;
    }

    /** @returns {boolean} whether a burst is reading right now */
    get scanning() { return !!this._burst; }

    start() {
        if (this._running) return;
        this._running = true;
        this._generation++;
    }

    stop() {
        this._running = false;
        this._generation++;
        this._burst = null;
    }

    trigger() {
        if (!this._running) {
            console.log('KeybindDetector: key pressed but keybind detection is not running, ignored');
            return;
        }
        this._deadline = Date.now() + this.deps.burstMs;
        if (this._burst) {
            console.log(`KeybindDetector: key pressed again, burst extended by ${this.deps.burstMs}ms`);
            return;
        }
        const generation = this._generation;
        this._burst = this._runBurst(generation).catch(err => {
            console.error('KeybindDetector: burst crashed:', err);
        }).finally(() => {
            if (this._generation === generation) this._burst = null;
        });
    }

    _live(generation) {
        return this._running && this._generation === generation;
    }

    async _runBurst(generation) {
        const startedAt = Date.now();
        let reads = 0;
        let sawWindow = false;
        console.log(`KeybindDetector: burst started (OCR every ${this.deps.pollMs}ms for ${this.deps.burstMs}ms)`);
        this.deps.onStatus({ state: 'scanning' });

        while (this._live(generation) && Date.now() < this._deadline) {
            try {
                const frame = await this.deps.captureFrame();
                if (!this._live(generation)) return;
                if (!frame) {
                    // No game window: nothing to read, retrying for 8 s won't make one appear.
                    break;
                }
                sawWindow = true;
                reads++;
                const result = await this.deps.recognizeMapText(frame);
                if (!this._live(generation)) return;
                if (result) {
                    const key = result.realm ? `${result.realm}/${result.map}` : result.map;
                    console.log(`KeybindDetector: burst end (match "${key}" after ${Date.now() - startedAt}ms, ${reads} read(s))`);
                    this.deps.onMapDetected(key);
                    this.deps.onStatus({ state: 'matched', key, reads });
                    return;
                }
            } catch (err) {
                if (!this._live(generation)) return; // stopped mid-read (e.g. OCR disposed)
                console.error('KeybindDetector: read failed, continuing:', err.message);
                if (this.deps.onError) this.deps.onError(err);
            }
            await sleep(this.deps.pollMs);
        }

        if (!this._live(generation)) return;
        const reason = sawWindow ? 'no map title seen' : 'Dead by Daylight window not found';
        console.log(`KeybindDetector: burst end (timeout after ${Date.now() - startedAt}ms, ${reads} read(s): ${reason})`);
        this.deps.onStatus({ state: 'not-found', reason, reads });
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { KeybindDetector };
