import { build } from 'esbuild';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

// This entry point and its device substitutes are never imported by the app.
const path = name => fileURLToPath(new URL(name, import.meta.url));
const bundle = await build({
  entryPoints: [path('./camera-check.tsx')], bundle: true, write: false, platform: 'browser',
  define: { 'process.env.NODE_ENV': '"development"', __DEV__: 'true' },
  resolveExtensions: ['.web.tsx', '.tsx', '.web.ts', '.ts', '.web.js', '.js', '.json'],
  alias: { 'react-native': 'react-native-web', 'expo-camera': path('./camera-device.tsx'),
    'expo-haptics': path('./camera-device.tsx'), '@expo/vector-icons/Ionicons': path('./camera-icons.tsx') },
  plugins: [{ name: 'no-native-live-preview', setup(b) {
    b.onResolve({ filter: /\/LiveLookPreview$/ }, () => ({ path: path('./camera-device.tsx') }));
  } }],
});
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>VibeCam camera interaction check</title><style>
@font-face{font-family:Ionicons;src:url(/icons.ttf)}
html,body,#root{margin:0;height:100%;background:#10110f}#root{display:flex;flex-direction:column}
#label{position:fixed;top:8px;left:0;right:0;text-align:center;font:10px system-ui;color:#efb764;z-index:100;pointer-events:none}
#label button{pointer-events:auto;margin-left:8px;color:#efb764;border:1px solid #635337;background:#1c1e1a;border-radius:8px;padding:4px 8px}
dialog{max-width:500px;border:1px solid #635337;border-radius:18px;background:#1c1e1a;color:#f5f1e8;font:14px system-ui}
dialog pre{white-space:pre-wrap}dialog::backdrop{background:#000a}
</style><div id="label">SIMULATED CAMERA <button id="run">Run checks</button></div>
<dialog id="report"><h2>Camera interaction check</h2>
<p>Simulated device and audio. This does not verify a real camera, microphone or exported video.</p>
<pre id="results"></pre><form method="dialog"><button>Close</button></form></dialog>
<div id="root"></div><script src="/check.js"></script>`;
createServer((req, res) => {
  if (req.url === '/icons.ttf') {
    res.setHeader('Content-Type', 'font/ttf');
    res.end(readFileSync(path('../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf'))); return;
  }
  res.setHeader('Content-Type', req.url === '/check.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/check.js' ? bundle.outputFiles[0].text : html);
}).listen(8083, '127.0.0.1', () => console.log('Camera interaction check: http://127.0.0.1:8083 — run window.runCameraChecks() in the browser. No real media is recorded.'));
