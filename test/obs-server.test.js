const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const ObsServer = require('../src/core/obs-server');

const PORT = 47999;

function get(pathname, headers = {}) {
    return new Promise((resolve, reject) => {
        const req = http.get({host: '127.0.0.1', port: PORT, path: pathname, headers}, (res) => {
            res.resume();
            resolve(res.statusCode);
        });
        req.on('error', reject);
    });
}

test('ObsServer request handling', async (t) => {
    const server = new ObsServer(PORT);
    server.start();
    await new Promise((r) => server.server.once('listening', r));
    t.after(() => server.stop());

    await t.test('rejects path traversal', async () => {
        assert.strictEqual(await get('/..%2f..%2fpackage.json'), 403);
    });
    await t.test('answers malformed escapes with 400 instead of throwing', async () => {
        assert.strictEqual(await get('/%'), 400);
    });
    await t.test('rejects foreign Host headers (DNS rebinding)', async () => {
        assert.strictEqual(await get('/', {Host: 'evil.example'}), 403);
    });
});

test('ObsServer publish keeps the last map for late clients', () => {
    const server = new ObsServer(PORT + 1);
    server.publish('map-change', new Uint8Array([1, 2, 3]), 250);
    assert.deepStrictEqual(server.last, {event: 'map-change', image: 'AQID', size: 250});
    server.publish('map-hide');
    assert.deepStrictEqual(server.last, {event: 'map-hide'});
    server.publish('unknown-event');
    assert.deepStrictEqual(server.last, {event: 'map-hide'});
});
