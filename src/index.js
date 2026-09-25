// Cloudflare Worker entry. Static files in ./public are served by Workers
// Static Assets before the Worker runs; everything else (the /api/* routes and
// /health) is handled by the Hono app.
import { createApp } from './app.js';

export default createApp();
