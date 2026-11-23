// Runs every check in dependency order. The gateway must be up (the root
// `npm test` starts it first). Each suite resets the persisted config.
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, '..');
const webRoot = resolve(serverRoot, '../web');
const configPath = resolve(serverRoot, '../data/config.json');

const run = (label, command, args, cwd) => new Promise((resolveRun, rejectRun) => {
  console.log(`\n=== ${label} ===`);
  const child = spawn(command, args, { cwd, stdio: 'inherit', env: process.env });
  child.on('error', rejectRun);
  child.on('exit', (code) => (code === 0 ? resolveRun() : rejectRun(new Error(`${label} exited ${code}`))));
});

const suites = [
  ['后端 API 端到端', process.execPath, ['scripts/api-e2e.cjs'], serverRoot],
  ['后端重启/结构变更端到端', process.execPath, ['scripts/restart-e2e.cjs'], serverRoot],
  ['后端 WebSocket 推送', process.execPath, ['scripts/ws-e2e.mjs'], serverRoot],
  ['前端组件渲染', process.execPath, ['test/run-render-tests.mjs'], webRoot],
];

try {
  for (const [label, command, args, cwd] of suites) {
    rmSync(configPath, { force: true });
    await run(label, command, args, cwd);
  }
  console.log('\n全部测试通过 ✔');
} catch (err) {
  console.error('\n测试失败:', err.message);
  process.exit(1);
}
