import { useState } from 'react';

export default function ConnectionBar({ connection, onConnect, onDisconnect, busy }) {
  const [mode, setMode] = useState('embedded'); // embedded | external
  const [variant, setVariant] = useState('V1');
  const [endpoint, setEndpoint] = useState('opc.tcp://localhost:4840');

  const statusClass = connection.status === 'connected' ? 'connected'
    : connection.status === 'connecting' ? 'connecting' : connection.status;

  return (
    <div className="topbar">
      <h1>OPC UA 地址空间浏览器</h1>
      <span className={`status-pill ${statusClass}`}>
        {connection.status === 'connected' ? '已连接'
          : connection.status === 'connecting' ? '连接中…'
            : connection.status === 'error' ? `错误: ${connection.lastError ?? ''}` : '未连接'}
      </span>
      <select value={mode} onChange={(e) => setMode(e.target.value)} disabled={busy}>
        <option value="embedded">内置测试服务器</option>
        <option value="external">外部端点</option>
      </select>
      {mode === 'embedded' ? (
        <select value={variant} onChange={(e) => setVariant(e.target.value)} disabled={busy}>
          <option value="V1">结构 V1（命名空间顺序 A）</option>
          <option value="V2">结构 V2（命名空间顺序 B，字段变化）</option>
        </select>
      ) : (
        <input style={{ width: 240 }} value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="opc.tcp://host:port" />
      )}
      <button
        className="primary"
        disabled={busy}
        onClick={() => onConnect(mode === 'embedded'
          ? { embeddedDemo: true, variant }
          : { embeddedDemo: false, endpointUrl: endpoint })}
      >
        {connection.status === 'connected' ? '重新连接' : '连接'}
      </button>
      <button disabled={busy || connection.status !== 'connected'} onClick={onDisconnect}>断开</button>
      {connection.embedded && connection.variant && (
        <span className="chip">内置服务 · {connection.variant}</span>
      )}
      {connection.endpointUrl && <span className="chip mono">{connection.endpointUrl}</span>}
    </div>
  );
}
