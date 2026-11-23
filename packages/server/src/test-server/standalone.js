// Standalone demo server:
//   node src/test-server/standalone.js [--port 4840] [--variant V2]
//
// Restarting with --variant V2 simulates the post-restart world described in
// the requirements: namespace indices reshuffle, one structure changes shape
// and a node with a familiar browse name gets a different identifier.
import { startTestServer, DEFAULT_PORT } from './factory.js';

function parseArgs(argv) {
  const args = { port: DEFAULT_PORT, variant: 'V1' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--port') args.port = Number(argv[++i]);
    else if (argv[i] === '--variant') args.variant = argv[++i];
  }
  if (!['V1', 'V2'].includes(args.variant)) {
    throw new Error(`Unknown variant "${args.variant}", expected V1 or V2`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const running = await startTestServer(args);
  console.log(`[test-server] variant=${running.variant}`);
  console.log(`[test-server] endpoint=${running.endpointUrl}`);
  console.log('[test-server] namespace URIs:', running.model.namespaceUris);

  const shutdown = async () => {
    console.log('\n[test-server] shutting down...');
    try {
      await running.shutdown();
      process.exit(0);
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[test-server] failed to start:', err);
  process.exit(1);
});
