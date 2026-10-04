// Local dev: serves the static app and the /api handlers. Data goes to ./.devdata (never use in production).
//   LIFEOS_DEV=1 node tools/dev-server.js [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.LIFEOS_DEV ??= '1';
const root = join(fileURLToPath(import.meta.url), '..', '..');
const port = Number(process.argv[2]) || 8124;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/markdown' };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/[^a-z-]/g, '');
      const mod = await import(pathToFileURL(join(root, 'api', `${name}.js`)).href);
      return await mod.default(req, res);
    }
    let p = normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''); if (p.endsWith('/')) p += 'index.html';
    const file = join(root, p);
    if (!file.startsWith(root) || file.includes('node_modules') || file.includes('.devdata')) { res.statusCode = 403; return res.end('forbidden'); }
    const data = await readFile(file);
    res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream'); res.end(data);
  } catch (e) { res.statusCode = e.code === 'ENOENT' || e.code === 'ERR_MODULE_NOT_FOUND' ? 404 : 500; res.end('not found'); }
}).listen(port, () => console.log(`LifeOS dev server on http://localhost:${port}`));
