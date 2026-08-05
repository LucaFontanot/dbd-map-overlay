'use strict';

class OcrMatcher {
    /**
     * @param {{reverseI18n: Map<string,string>, normalizedI18n: Map<string,string>, realmKeys: Set<string>}} deps
     */
    constructor({ reverseI18n, normalizedI18n, realmKeys }) {
        this.reverseI18n = reverseI18n;
        this.normalizedI18n = normalizedI18n;
        this.realmKeys = realmKeys;
    }

    _levenshtein(a, b) {
        const m = a.length, n = b.length;
        const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
        for (let j = 0; j <= n; j++) dp[0][j] = j;
        for (let i = 1; i <= m; i++)
            for (let j = 1; j <= n; j++)
                dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1]
                    : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
        return dp[m][n];
    }

    _fuzzyMatchRealmKey(raw) {
        const MAX_DIST = Math.max(2, Math.floor(raw.length * 0.18));
        let best = null, bestDist = MAX_DIST + 1;
        for (const realmKey of this.realmKeys) {
            const dist = this._levenshtein(raw, realmKey);
            if (dist < bestDist) { bestDist = dist; best = realmKey; }
        }
        return bestDist <= MAX_DIST ? best : null;
    }

    _fuzzyMatchI18n(raw) {
        const MAX_DIST = Math.max(2, Math.floor(raw.length * 0.18));
        let best = null, bestDist = MAX_DIST + 1;
        for (const [key, value] of this.normalizedI18n) {
            if (Math.abs(key.length - raw.length) > MAX_DIST) continue;
            const dist = this._levenshtein(raw, key);
            if (dist < bestDist) { bestDist = dist; best = value; }
        }
        return bestDist <= MAX_DIST ? best : null;
    }

    /** @returns {'map'|'realm'} realmKeys is the source of truth for what counts as a realm. */
    _classify(englishKey) {
        return this.realmKeys.has(englishKey.toLowerCase()) ? 'realm' : 'map';
    }

    /**
     * Tries every lookup strategy (exact -> normalized -> substring -> fuzzy) for one candidate string.
     * @returns {{key: string, type: 'map'|'realm'}|null}
     */
    _tryMatch(candidate) {
        const raw = candidate.toLowerCase().trim();

        const exact = this.reverseI18n.get(raw);
        if (exact) return { key: exact, type: this._classify(exact) };

        const normRaw = raw.replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
        if (normRaw.length > 2) {
            const normKey = this.normalizedI18n.get(normRaw);
            if (normKey) return { key: normKey, type: this._classify(normKey) };
        }

        if (normRaw.length >= 5) {
            for (const [key, value] of this.normalizedI18n) {
                if (key.endsWith(normRaw) || key.startsWith(normRaw) || key.includes(normRaw)) {
                    return { key: value, type: this._classify(value) };
                }
            }
        }

        if (raw.length >= 4) {
            const fuzzyRealm = this._fuzzyMatchRealmKey(raw);
            if (fuzzyRealm) {
                const key = this.reverseI18n.get(fuzzyRealm) ?? fuzzyRealm;
                return { key, type: this._classify(key) };
            }
            if (raw.length >= 6) {
                const fuzzyI18n = this._fuzzyMatchI18n(normRaw.length > 2 ? normRaw : raw);
                if (fuzzyI18n) return { key: fuzzyI18n, type: this._classify(fuzzyI18n) };
            }
        }

        return null;
    }

    /**
     * Scans OCR lines for a MAP name, using any REALM name seen along the way only to
     * fill in the `realm` field -- never as the reported result, since the loading
     * screen always shows a specific map, and a realm alone is not enough to pick
     * one of the (possibly several) maps within it.
     * @param {string[]} lines
     * @returns {{realm: string|null, map: string}|null}
     */
    matchLines(lines) {
        let realmCandidate = null;
        let mapCandidate = null;

        for (let i = 0; i < lines.length; i++) {
            const result = this._tryMatch(lines[i]);
            if (!result) continue;
            if (result.type === 'map' && !mapCandidate) mapCandidate = result.key;
            if (result.type === 'realm' && !realmCandidate) realmCandidate = result.key;
        }

        if (mapCandidate) return { realm: realmCandidate, map: mapCandidate };

        for (let i = 0; i < lines.length - 1; i++) {
            for (let len = 2; len <= Math.min(3, lines.length - i); len++) {
                const chunk = lines.slice(i, i + len).map(l => l.toLowerCase().trim());
                for (const joined of [chunk.join(''), chunk.join(' ')]) {
                    const result = this._tryMatch(joined);
                    if (result?.type === 'map') return { realm: realmCandidate, map: result.key };
                    if (result?.type === 'realm' && !realmCandidate) realmCandidate = result.key;
                }
            }
        }

        return null;
    }
}

module.exports = { OcrMatcher };
