const http = require('http');
const fs = require('fs');
const path = require('path');
const {RENDERER_DIR} = require('./renderer-pages');

const DEFAULT_PORT = 4747;
const HOST = '127.0.0.1'; // loopback only: the map must never be reachable from the network

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
};

/**
 * Serves the OBS page over HTTP so it can be added to OBS as a Browser Source
 * (http://127.0.0.1:4747/). Map updates come from the same `send()` calls the
 * OBS window gets and are pushed to every connected page over Server-Sent Events.
 */
class ObsServer {
    server = null;
    clients = new Set();
    last = null; // replayed to pages that connect after the map was sent

    constructor(port = Number(process.env.DBD_OBS_PORT) || DEFAULT_PORT) {
        this.port = port;
    }

    start() {
        if (this.server) return;
        this.server = http.createServer((req, res) => this.handle(req, res));
        this.server.on('error', (err) => {
            console.error(`ObsServer: cannot listen on ${HOST}:${this.port}:`, err.message);
            this.server = null;
        });
        this.server.listen(this.port, HOST, () => {
            console.log(`ObsServer: OBS Browser Source URL is http://${HOST}:${this.port}/`);
        });
    }

    stop() {
        for (const res of this.clients) res.end();
        this.clients.clear();
        if (this.server) this.server.close();
        this.server = null;
    }

    /** Same (event, ...data) shape ObsWindow.send receives. */
    publish(event, ...data) {
        let message;
        if (event === 'map-change') {
            const [bytes, size] = data;
            message = {event, image: bytes && bytes.length ? Buffer.from(bytes).toString('base64') : '', size};
        } else if (event === 'map-hide') {
            message = {event};
        } else {
            return;
        }
        this.last = message;
        this.write(message);
    }

    write(message) {
        const frame = `data: ${JSON.stringify(message)}\n\n`;
        for (const res of this.clients) res.write(frame);
    }

    handle(req, res) {
        if (req.method !== 'GET') {
            res.writeHead(405).end();
            return;
        }
        // DNS rebinding: a web page can point its own domain at 127.0.0.1 and
        // read the stream. Only answer to the loopback names OBS uses.
        const hostName = (req.headers.host || '').replace(/:\d+$/, '');
        if (hostName !== '127.0.0.1' && hostName !== 'localhost') {
            res.writeHead(403).end();
            return;
        }
        let pathname;
        try {
            pathname = decodeURIComponent(new URL(req.url, `http://${HOST}`).pathname);
        } catch {
            // Malformed escapes ("/%") would otherwise throw inside the main process
            res.writeHead(400).end();
            return;
        }
        if (pathname.includes('\0')) {
            res.writeHead(400).end();
            return;
        }
        if (pathname === '/events') return this.events(req, res);

        const rel = pathname === '/' ? 'obs.html' : pathname.replace(/^\/+/, '');
        const file = path.resolve(RENDERER_DIR, rel);
        // No path traversal out of the build folder
        if (file !== RENDERER_DIR && !file.startsWith(RENDERER_DIR + path.sep)) {
            res.writeHead(403).end();
            return;
        }
        fs.readFile(file, (err, content) => {
            if (err) {
                res.writeHead(404).end('Not found (run "npm run build:renderer"?)');
                return;
            }
            res.writeHead(200, {
                'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
                'Cache-Control': 'no-store',
            });
            res.end(content);
        });
    }

    events(req, res) {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-store',
            Connection: 'keep-alive',
        });
        res.write('retry: 2000\n\n');
        this.clients.add(res);
        if (this.last) res.write(`data: ${JSON.stringify(this.last)}\n\n`);
        const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000);
        req.on('close', () => {
            clearInterval(keepAlive);
            this.clients.delete(res);
        });
    }
}

module.exports = ObsServer;
