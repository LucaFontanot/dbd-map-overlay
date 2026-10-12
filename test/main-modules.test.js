const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const {computeNonce, redact} = require('../src/core/api');
const {parseCatalogEntry, normalizePhotoKey} = require('../src/core/photo-sync');
const {buildPages, isShellSafe} = require('../src/core/stream-deck');
const {RENDERER_WRITABLE} = require('../src/core/settings');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

test('computeNonce finds an answer whose hash starts with the nonce', () => {
    const data = 'abc';
    const nonce = sha(data + 42).slice(0, 2);
    const answer = computeNonce({data, nonce, difficulty: 2});
    assert.ok(answer !== null);
    assert.strictEqual(sha(data + answer).slice(0, 2), nonce);
});

test('computeNonce refuses mismatched or excessive difficulty', () => {
    assert.strictEqual(computeNonce({data: 'x', nonce: 'abc', difficulty: 2}), null);
    assert.strictEqual(computeNonce({data: 'x', nonce: '0000000', difficulty: 7}), null);
});

test('redact hides the token and long payloads', () => {
    const out = redact({user: 'secret', token: 't', map: 'x'.repeat(500), id: 3});
    assert.deepStrictEqual(out, {user: '<redacted>', token: '<redacted>', map: '<500 chars>', id: 3});
});

test('parseCatalogEntry keeps maps/ entries only', () => {
    assert.deepStrictEqual(parseCatalogEntry({filePath: 'maps/A/B/C.png', md5: 'm'}),
        {key: 'A/B/C.png', url: 'maps/A/B/C.png', md5: 'm'});
    assert.deepStrictEqual(parseCatalogEntry({filePath: 'maps\\A\\B\\C.png', md5: 'm'}).key, 'A/B/C.png');
    assert.strictEqual(parseCatalogEntry({filePath: 'other/A.png', md5: 'm'}), null);
    assert.strictEqual(parseCatalogEntry({filePath: 'maps/A.png'}), null);
    assert.strictEqual(parseCatalogEntry(null), null);
    assert.strictEqual(normalizePhotoKey('\\A\\B.png'), 'A/B.png');
});

test('buildPages paginates realms and embeds the show-map command', () => {
    const realms = {R1: ['Map One.png'], R2: ['A.png', 'B.png', 'C.png', 'D.png']};
    const pages = buildPages({
        buttonCount: 6, commandPrefix: 'dbd-map-tool', creator: 'Me', realms,
        pagePath: (f) => `/p/${f}`, iconPath: (f) => `/i/${f}`,
    });
    assert.deepStrictEqual(Object.keys(pages).sort(),
        ['DeadByDaylight.json', 'R1_page1.json', 'R2_page1.json', 'R2_page2.json']);
    const commands = JSON.stringify(pages['R1_page1.json']);
    assert.ok(commands.includes('\\"dbd-map-tool\\" show-map=\\"Me/R1/Map One.png\\"'));
    // 6 buttons - 3 reserved = 3 maps per realm page, next arrow on page 1
    assert.ok(JSON.stringify(pages['R2_page1.json']).includes('/p/R2_page2.json'));
});

test('isShellSafe rejects shell metacharacters inside double quotes', () => {
    assert.ok(isShellSafe('Me/Realm/Map.png'));
    for (const bad of ['a"b', 'a`b', 'a$b', 'a\\b', '']) assert.ok(!isShellSafe(bad), bad);
});

test('renderer may only write whitelisted settings with valid values', () => {
    assert.ok(!('token' in RENDERER_WRITABLE));
    assert.ok(!('id' in RENDERER_WRITABLE));
    assert.ok(!('overlayX' in RENDERER_WRITABLE));
    assert.ok(RENDERER_WRITABLE.size('250'));
    assert.ok(RENDERER_WRITABLE.size(250));
    assert.ok(!RENDERER_WRITABLE.size('abc'));
    assert.ok(RENDERER_WRITABLE.rotation(270));
    assert.ok(!RENDERER_WRITABLE.rotation(360));
    assert.ok(RENDERER_WRITABLE.glideX(null));
    assert.ok(!RENDERER_WRITABLE.glideX(101));
    assert.ok(!RENDERER_WRITABLE.draggable('true'));
});
