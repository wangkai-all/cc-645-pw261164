// Root test orchestrator: build the web app, start the gateway, run every
// suite against it, then always shut the gateway down.
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { once } from 'node:events';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = resolve(root, 'packages/data/config.json');
rmSync(configPath, { force: true });

const run = (command, args, cwd = root) => new Promise((resolveRun, rejectRun) => {
  const child = spawn(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32', env: process.env });
  child.on('error', rejectRun);
  child.on('exit', (code) => (code === 0 ? resolveRun() : rejectRun(new Error(`${command} ${args.join(' ')} exited ${code}`))));
});

const waitForHealth = async (port = 4080, timeoutMs = 30000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('gateway did not become healthy in time');
};

const gateway = spawn(process.execPath, ['packages/server/src/index.js'], { cwd: root, stdio: 'inherit', env: process.env });
let exitCode = 0;
try {
  await waitForHealth();
  await run('npm', ['run', 'build', '-w', '@opc/web']);
  // restart so the gateway picks up the freshly built web bundle
  gateway.kill('SIGTERM');
  await once(gateway, 'exit');
  const gateway2 = spawn(process.execPath, ['packages/server/src/index.js'], { cwd: root, stdio: 'inherit', env: process.env });
  await waitForHealth();
  await run(process.execPath, ['packages/server/scripts/run-all-tests.js']);
  gateway2.kill('SIGTERM');
  await once(gateway2, 'exit');
} catch (err) {
  exitCode = 1;
  console.error('\n测试编排失败:', err.message);
  gateway.kill('SIGTERM');
}
process.exit(exitCode);
