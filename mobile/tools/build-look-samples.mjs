import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Open localhost:8084 in a GPU-capable browser. All variants use the app shader.
const bundle = await build({ entryPoints: [fileURLToPath(new URL('./build-look-samples.ts', import.meta.url))], bundle: true, write: false, platform: 'browser' });
createServer(async (req, res) => {
  const sample = /^\/save\/(g7x|rx100|gr|x100|ccd|powershot)$/.exec(req.url);
  if (req.method === 'POST' && sample) {
    if (req.headers.origin !== 'http://127.0.0.1:8084') { res.writeHead(403).end(); return; }
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 2000000) { res.writeHead(413).end(); return; } chunks.push(chunk); }
    writeFileSync(new URL('../assets/look-samples/' + sample[1] + '.jpg', import.meta.url), Buffer.concat(chunks));
    res.end('saved'); return;
  }
  if (/^\/luts\/(g7x|rx100|gr|x100|ccd|powershot)\.png$/.test(req.url)) {
    res.setHeader('Content-Type', 'image/png'); res.end(readFileSync(new URL('../assets' + req.url, import.meta.url))); return;
  }
  if (req.url === '/original.jpg') {
    res.setHeader('Content-Type', 'image/jpeg'); res.end(readFileSync(new URL('../assets/look-samples/original.jpg', import.meta.url))); return;
  }
  res.setHeader('Content-Type', req.url === '/build.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/build.js' ? bundle.outputFiles[0].text : '<!doctype html><meta charset="utf-8"><title>Build look samples</title><pre>Rendering…</pre><script src="/build.js"></script>');
}).listen(8084, '127.0.0.1', () => console.log('Open http://127.0.0.1:8084 to render the bundled look samples.'));
