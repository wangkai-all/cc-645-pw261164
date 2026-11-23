// Bundles the JSX render tests with esbuild (CSS imports stubbed out) and runs
// them in Node, since the sandbox has no browser for a full DOM test run.
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { writeFileSync, rmSync } from 'node:fs';

const outfile = 'test/.render-test.bundle.cjs';
await build({
  entryPoints: ['test/render.test.jsx'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  jsx: 'automatic',
  outfile,
  loader: { '.js': 'jsx', '.jsx': 'jsx' },
  plugins: [{
    name: 'stub-css',
    setup(b) {
      b.onResolve({ filter: /\.css$/ }, () => ({ path: 'stub.css', namespace: 'css-stub' }));
      b.onLoad({ filter: /.*/, namespace: 'css-stub' }, () => ({ contents: 'module.exports = {};' }));
    },
  }],
});

try {
  await import(pathToFileURL(outfile).href);
} finally {
  rmSync(outfile, { force: true });
}
