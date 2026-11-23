// HTTP + WebSocket gateway.
//
// The browser never talks OPC UA itself: this process owns the node-opcua
// client, the embedded demo server, persistence and all identity/structure
// reconciliation. It also serves the built React app in production.
import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { DataType } from 'node-opcua';

import { ConfigStore } from './store/config-store.js';
import { ConnectionManager } from './opcua/connection-manager.js';
import { CollectionManager } from './collection/collection-manager.js';
import { WsHub } from './ws/hub.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = process.env.OPC_BROWSER_CONFIG
  ?? resolve(__dirname, '../../data/config.json');
const PORT = Number(process.env.PORT ?? 4080);

const app = express();
app.use(express.json({ limit: '2mb' }));

const httpServer = createServer(app);
const hub = new WsHub(httpServer);
const configStore = new ConfigStore(CONFIG_PATH);
const connections = new ConnectionManager(configStore);
const collections = new CollectionManager({
  connectionManager: connections,
  configStore,
  hub,
  bufferSize: configStore.snapshot().options.sampleBufferSize,
});

// Broadcast every config change so all tabs stay in sync.
configStore.onChange((snapshot) => hub.broadcast({ type: 'config', config: snapshot }));

function asyncRoute(handler) {
  return (req, res) => {
    Promise.resolve(handler(req, res)).catch((err) => {
      const status = err?.code === 'not-connected' ? 409 : 400;
      res.status(status).json({ error: err?.message ?? String(err), code: err?.code ?? null });
    });
  };
}

// ---- connection -------------------------------------------------------------
app.get('/api/connection', (req, res) => {
  res.json({ ...connections.connectionInfo(), config: configStore.snapshot() });
});

app.post('/api/connection/connect', asyncRoute(async (req, res) => {
  const { endpointUrl = null, embeddedDemo = true, variant = 'V1' } = req.body ?? {};
  collections.stopAll();
  const info = await connections.connect({ endpointUrl, embeddedDemo, variant });
  const blocked = await collections.autoResume();
  hub.broadcast({ type: 'connection', info });
  res.json({ ...info, autoResumeBlocked: blocked });
}));

app.post('/api/connection/disconnect', asyncRoute(async (req, res) => {
  collections.stopAll();
  await connections.disconnect();
  hub.broadcast({ type: 'connection', info: connections.connectionInfo() });
  res.json(connections.connectionInfo());
}));

app.post('/api/connection/reconcile', asyncRoute(async (req, res) => {
  connections.requireSession();
  res.json(await connections.reconcileSelections());
}));

// ---- browsing ----------------------------------------------------------------
app.post('/api/browse', asyncRoute(async (req, res) => {
  const opc = connections.requireSession();
  const { stableId } = req.body ?? {};
  if (!stableId) throw new Error('stableId is required');
  const result = await opc.browse(stableId);
  res.json(result);
}));

app.post('/api/node-info', asyncRoute(async (req, res) => {
  const opc = connections.requireSession();
  const { stableId } = req.body ?? {};
  res.json(await opc.readNodeInfo(stableId));
}));

app.post('/api/read', asyncRoute(async (req, res) => {
  const opc = connections.requireSession();
  const { stableId } = req.body ?? {};
  res.json(await opc.readValue(stableId));
}));

// ---- selections --------------------------------------------------------------
app.get('/api/selections', (req, res) => {
  res.json(configStore.snapshot().selections);
});

app.post('/api/selections', asyncRoute(async (req, res) => {
  const opc = connections.requireSession();
  const { stableId, label, path = [] } = req.body ?? {};
  if (!stableId || !stableId.namespaceUri) throw new Error('stableId with namespaceUri is required');
  const verification = await opc.verifyNode(stableId);
  if (verification.mismatch) return res.status(409).json({ mismatch: verification.mismatch });
  const inspection = await opc.inspectStructure(stableId, null);
  const record = configStore.addSelection({
    stableId,
    label: label ?? path.at(-1)?.browseName ?? 'node',
    path,
    fingerprint: inspection.fingerprint,
  });
  res.json(record);
}));

app.delete('/api/selections/:id', (req, res) => {
  collections.stop(req.params.id);
  configStore.removeSelection(req.params.id);
  res.json({ ok: true });
});

app.post('/api/selections/:id/confirm-structure', asyncRoute(async (req, res) => {
  connections.requireSession();
  const fingerprint = await connections.confirmStructure(req.params.id);
  hub.broadcast({ type: 'structure-confirmed', selectionId: req.params.id, fingerprint });
  res.json({ ok: true, fingerprint });
}));

// ---- collection --------------------------------------------------------------
app.get('/api/collections', (req, res) => {
  res.json({ config: configStore.snapshot().collections, runtime: collections.status() });
});

app.post('/api/collections/start', asyncRoute(async (req, res) => {
  const { selectionId, samplingInterval = 500 } = req.body ?? {};
  const result = await collections.start(selectionId, { samplingInterval });
  res.json(result);
}));

app.post('/api/collections/stop', (req, res) => {
  collections.stop(req.body?.selectionId);
  res.json({ ok: true });
});

app.post('/api/collections/clear', (req, res) => {
  collections.clearSamples(req.body?.selectionId);
  res.json({ ok: true });
});

app.get('/api/samples/:selectionId', (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  res.json(collections.listSamples(req.params.selectionId, limit));
});

// ---- generic write (demo controls: quality injection, array length) ----------
app.post('/api/write', asyncRoute(async (req, res) => {
  const opc = connections.requireSession();
  const { stableId, dataType = 'String', value, arrayType = 'scalar' } = req.body ?? {};
  const dataTypeCode = DataType[dataType] ?? DataType.String;
  const variantOptions = {
    dataType: dataTypeCode,
    value: arrayType === 'array' ? (Array.isArray(value) ? value : [value]) : value,
  };
  if (arrayType === 'array') variantOptions.arrayType = 1; // VariantArrayType.Array
  res.json(await opc.writeValue(stableId, variantOptions));
}));

app.get('/api/config', (req, res) => res.json(configStore.snapshot()));

app.get('/api/health', (req, res) => res.json({ ok: true, wsClients: hub.clientCount }));

// ---- static web build --------------------------------------------------------
const webDist = resolve(__dirname, '../../web/dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/ws') return next();
    res.sendFile(resolve(webDist, 'index.html'));
  });
} else {
  app.get('/', (req, res) => res.json({ service: 'opcua-address-browser', note: 'web build not found; run npm run build -w @opc/web' }));
}

httpServer.listen(PORT, () => {
  console.log(`[gateway] http://localhost:${PORT}`);
  console.log(`[gateway] config at ${CONFIG_PATH}`);
  console.log(`[gateway] websocket ws://localhost:${PORT}/ws`);
});

const shutdown = async () => {
  collections.stopAll();
  await connections.disconnect().catch(() => {});
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
