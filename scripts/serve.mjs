// Plain Node server (no dependencies): serves ./public and the API exactly
// like the Vercel deployment does. Use it on any Node host (Render, Railway,
// a VPS) with `npm start`, or locally without Cloudflare tooling.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import app from '../src/app.js';

const PUBLIC_DIR = resolve(fileURLToPath(new URL('../public', import.meta.url)));
const PORT = Number(process.env.PORT) || 3000;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

async function serveStatic(pathname, res, method) {
  let rel;
  try {
    rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  } catch {
    return false;
  }
  const file = resolve(PUBLIC_DIR, `.${rel}`);
  if (!file.startsWith(PUBLIC_DIR + sep)) return false; // path traversal guard
  try {
    if (!(await stat(file)).isFile()) return false;
  } catch {
    return false;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(method === 'HEAD' ? undefined : await readFile(file));
  return true;
}

createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  try {
    const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname === '/health';
    if (!isApi && (req.method === 'GET' || req.method === 'HEAD') && (await serveStatic(url.pathname, res, req.method))) return;

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const request = new Request(url, { method: req.method, headers: req.headers, body: hasBody ? Readable.toWeb(req) : undefined, duplex: 'half' });
    const response = await app.fetch(request, process.env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) for await (const chunk of response.body) res.write(chunk);
    res.end();
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
  }
}).listen(PORT, () => {
  console.log(`Alpha AI Trader running at http://localhost:${PORT}`);
});
