// Vercel Function entry. vercel.json rewrites /api/* and /health here, and
// Vercel serves ./public (the dashboard) as static files.
import app from '../src/app.js';

// Vercel normally forwards the original request path. If a rewrite ever hands
// us the destination path instead, the `__path` query parameter added by the
// rewrite rules restores the original route.
function restoreOriginalPath(request) {
  const url = new URL(request.url);
  const original = url.searchParams.get('__path');
  if (original === null) return request;

  url.searchParams.delete('__path');
  if (url.pathname === '/api' || url.pathname === '/api/index' || url.pathname === '/api/index.js') {
    url.pathname = original === '__health' ? '/health' : original ? `/api/${original.replace(/^\/+/, '')}` : '/api';
  }
  return new Request(url, request);
}

export default {
  fetch(request) {
    return app.fetch(restoreOriginalPath(request), process.env);
  }
};
