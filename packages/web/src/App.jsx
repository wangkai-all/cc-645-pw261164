import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { openSocket } from './ws.js';
import { stableIdKey } from './identity.js';
import ConnectionBar from './components/ConnectionBar.jsx';
import AddressTree from './components/AddressTree.jsx';
import NodeDetail from './components/NodeDetail.jsx';
import CollectionPanel from './components/CollectionPanel.jsx';
import DemoControls from './components/DemoControls.jsx';

const EMPTY_CONNECTION = { status: 'disconnected', namespaceUris: [], embedded: false, variant: null, endpointUrl: null, lastError: null };

export default function App() {
  const [connection, setConnection] = useState(EMPTY_CONNECTION);
  const [config, setConfig] = useState({ selections: [], collections: [] });
  const [reconcile, setReconcile] = useState([]);
  const [occurrence, setOccurrence] = useState(null);
  const [tab, setTab] = useState('collections');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [liveSamples, setLiveSamples] = useState([]);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const runningMapRef = useRef({});
  const [, forceTick] = useState(0);

  const refreshReconcile = useCallback(async () => {
    try {
      const r = await api.reconcile();
      setReconcile(r.reconciliation);
    } catch {
      /* not connected yet */
    }
  }, []);

  const refreshCollections = useCallback(async () => {
    try {
      const r = await api.collections();
      runningMapRef.current = Object.fromEntries(
        Object.entries(r.runtime.running).map(([id, info]) => [id, info]),
      );
      forceTick((n) => n + 1);
    } catch {
      /* ignore */
    }
  }, []);

  // Initial load.
  useEffect(() => {
    api.connection().then((data) => {
      setConnection({
        status: data.status, namespaceUris: data.namespaceUris ?? [],
        embedded: data.embedded, variant: data.variant,
        endpointUrl: data.endpointUrl, lastError: data.lastError,
      });
      setConfig(data.config ?? { selections: [], collections: [] });
    }).catch(() => {});
  }, []);

  // WebSocket: samples, config changes, collection status.
  useEffect(() => {
    const socket = openSocket((msg) => {
      if (msg.type === 'sample') {
        setLiveSamples((prev) => [...prev.slice(-400), msg]);
      } else if (msg.type === 'samples-cleared') {
        setLiveSamples((prev) => [...prev, msg]);
      } else if (msg.type === 'config') {
        setConfig(msg.config);
      } else if (msg.type === 'collection-status') {
        refreshCollections();
      } else if (msg.type === 'structure-confirmed') {
        refreshReconcile();
      } else if (msg.type === 'connection') {
        setConnection((c) => ({ ...c, ...msg.info }));
      }
    });
    return () => socket.close();
  }, [refreshCollections, refreshReconcile]);

  const handleConnect = async (payload) => {
    setBusy(true); setError(null); setLiveSamples([]);
    try {
      const info = await api.connect(payload);
      setConnection({
        status: info.status, namespaceUris: info.namespaceUris,
        embedded: info.embedded, variant: info.variant,
        endpointUrl: info.endpointUrl, lastError: null,
      });
      setReconcile(info.reconciliation);
      setConfig(await api.config());
      setRefreshSignal((n) => n + 1);
      setOccurrence(null);
      await refreshCollections();
      if (info.autoResumeBlocked?.length) setTab('collections');
    } catch (e) {
      setError(e.message);
      setConnection((c) => ({ ...c, status: 'error', lastError: e.message }));
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      await api.disconnect();
      setConnection(EMPTY_CONNECTION);
      setReconcile([]);
      runningMapRef.current = {};
    } finally { setBusy(false); }
  };

  const selectedKeys = useMemo(
    () => new Set((config.selections ?? []).map((s) => stableIdKey(s.stableId))),
    [config.selections],
  );
  const selectedNodeKey = occurrence ? stableIdKey(occurrence.node.stableId) : null;

  return (
    <div className="app">
      <ConnectionBar connection={connection} onConnect={handleConnect} onDisconnect={handleDisconnect} busy={busy} />
      {error && <div className="banner error" style={{ margin: '8px 16px 0' }}>{error}</div>}
      <div className="main">
        <div className="pane left">
          <div className="pane-header">地址空间（按对象展开 · 共享节点不重复复制）</div>
          {connection.status === 'connected'
            ? <AddressTree onSelect={setOccurrence} selectedNode={occurrence?.node} refreshSignal={refreshSignal} />
            : <div className="detail muted">请先连接服务器。内置测试服务器包含引用环、多路径节点、数组、矩阵和结构化变量。</div>}
          {occurrence && (
            <>
              <div className="pane-header" style={{ top: 'auto' }}>节点详情</div>
              <NodeDetail
                occurrence={occurrence}
                isSelected={selectedKeys.has(selectedNodeKey)}
                onSelected={() => { setTab('collections'); refreshReconcile(); }}
              />
            </>
          )}
        </div>
        <div className="pane">
          <div className="tabs">
            <div className={`tab ${tab === 'collections' ? 'active' : ''}`} onClick={() => setTab('collections')}>选择与采集</div>
            <div className={`tab ${tab === 'controls' ? 'active' : ''}`} onClick={() => setTab('controls')}>演示控制台</div>
          </div>
          {tab === 'collections'
            ? (
              <CollectionPanel
                config={config}
                reconcile={reconcile}
                runningMap={runningMapRef.current}
                liveSamples={liveSamples}
                onReconcile={() => { refreshReconcile(); refreshCollections(); }}
              />
            )
            : <DemoControls connection={connection} />}
        </div>
      </div>
    </div>
  );
}
