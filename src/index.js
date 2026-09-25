// Cloudflare Worker entry. Static files in ./public are served by Workers
// Static Assets before the Worker runs; everything else (the /api/* routes and
// /health) is handled by the Hono app.
export { default } from './app.js';
