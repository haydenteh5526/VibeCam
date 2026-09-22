import { build } from 'esbuild';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const bundle = await build({ entryPoints: [fileURLToPath(new URL('./render-smoke.ts', import.meta.url))], bundle: true, write: false, platform: 'browser' });
const html = '<!doctype html><meta charset="utf-8"><title>VibeCam GPU check</title><style>body{background:#101014;color:#fff;font:18px system-ui;padding:40px}button{padding:16px;font:inherit}pre{white-space:pre-wrap}</style><h1>VibeCam GPU check</h1><p>Compiles and exercises the actual app renderer using a known colour chart.</p><button>Run GPU check</button><pre>Ready</pre><canvas hidden></canvas><script src="/check.js"></script>';
createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/check.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/check.js' ? bundle.outputFiles[0].text : html);
}).listen(8082, '127.0.0.1', () => console.log('GPU check ready at http://127.0.0.1:8082'));
