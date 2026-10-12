const {test} = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {safeJoin, isHttpUrl, ensureDirectoryExistence, deleteDirectoryContents} = require('../src/core/utils');

const base = path.resolve(os.tmpdir(), 'dbd-safejoin-base');

test('safeJoin keeps renderer-style leading slashes inside base', () => {
    assert.strictEqual(safeJoin(base, '/Creator/Realm/Map.png'), path.join(base, 'Creator', 'Realm', 'Map.png'));
    assert.strictEqual(safeJoin(base, '\\Creator\\Realm\\Map.png'), path.join(base, 'Creator', 'Realm', 'Map.png'));
    assert.strictEqual(safeJoin(base, 'a/./b/../c.png'), path.join(base, 'a', 'c.png'));
});

test('safeJoin rejects paths escaping base', () => {
    assert.throws(() => safeJoin(base, '../outside.png'));
    assert.throws(() => safeJoin(base, '/../../etc/passwd'));
    assert.throws(() => safeJoin(base, '..\\..\\Windows\\win.ini'));
    assert.throws(() => safeJoin(base, 'a/../../b'));
    assert.throws(() => safeJoin(base, 'bad\0name'));
    assert.throws(() => safeJoin(base, null));
});

test('safeJoin does not treat a sibling with the same prefix as inside', () => {
    assert.throws(() => safeJoin(base, '../dbd-safejoin-base-evil/x.png'));
});

test('isHttpUrl only accepts http(s)', () => {
    assert.ok(isHttpUrl('https://dbdmap.lucaservers.com'));
    assert.ok(isHttpUrl('http://example.com/a'));
    assert.ok(!isHttpUrl('file:///etc/passwd'));
    assert.ok(!isHttpUrl('javascript:alert(1)'));
    assert.ok(!isHttpUrl('smb://host/share'));
    assert.ok(!isHttpUrl('not a url'));
});

test('ensureDirectoryExistence creates nested parents; deleteDirectoryContents keeps the dir', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dbd-utils-'));
    try {
        const file = path.join(root, 'a', 'b', 'c', 'f.png');
        assert.strictEqual(ensureDirectoryExistence(file), true);
        fs.writeFileSync(file, 'x');
        fs.writeFileSync(path.join(root, 'top.png'), 'y');

        await deleteDirectoryContents(root);
        assert.ok(fs.existsSync(root));
        assert.deepStrictEqual(fs.readdirSync(root), []);

        // Missing directory is not an error
        await deleteDirectoryContents(path.join(root, 'missing'));
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});

test('computePhotoHashes keys by /relative/path and reuses the md5 cache', async () => {
    const UserData = require('../src/core/user-data');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dbd-photos-'));
    try {
        fs.mkdirSync(path.join(root, 'Creator', 'Realm'), {recursive: true});
        fs.writeFileSync(path.join(root, 'Creator', 'Realm', 'Map.png'), 'hello');

        const first = await UserData.computePhotoHashes(root);
        assert.deepStrictEqual(first, {'/Creator/Realm/Map.png': '5d41402abc4b2a76b9719d911017c592'});
        const cache = JSON.parse(fs.readFileSync(path.join(root, '.md5cache.json'), 'utf-8'));
        assert.strictEqual(cache['/Creator/Realm/Map.png'].md5, '5d41402abc4b2a76b9719d911017c592');

        // A cache hit (same size + mtime) is trusted without re-reading the file
        cache['/Creator/Realm/Map.png'].md5 = 'cached';
        fs.writeFileSync(path.join(root, '.md5cache.json'), JSON.stringify(cache));
        const second = await UserData.computePhotoHashes(root);
        assert.deepStrictEqual(second, {'/Creator/Realm/Map.png': 'cached'});

        // A changed file is re-hashed; removed files drop out
        fs.writeFileSync(path.join(root, 'Creator', 'Realm', 'Map.png'), 'hello world');
        const third = await UserData.computePhotoHashes(root);
        assert.deepStrictEqual(third, {'/Creator/Realm/Map.png': '5eb63bbbe01eeed093cb22bb8f5acdc3'});

        fs.rmSync(path.join(root, 'Creator'), {recursive: true});
        assert.deepStrictEqual(await UserData.computePhotoHashes(root), {});
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});
