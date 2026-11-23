import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { shortNodeId, shortUri } from '../identity.js';
import ValueRenderer from './ValueRenderer.jsx';

export default function NodeDetail({ occurrence, onSelected, isSelected }) {
  const [info, setInfo] = useState(null);
  const [read, setRead] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const node = occurrence?.node;

  useEffect(() => {
    setInfo(null); setRead(null); setError(null);
    if (!node) return;
    let cancelled = false;
    api.nodeInfo(node.stableId).then((r) => { if (!cancelled) setInfo(r); }).catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [node]);

  if (!node) {
    return <div className="detail muted">选择树中的节点查看详情。变量节点（📈）可加入采集。</div>;
  }

  const doRead = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.read(node.stableId);
      setRead(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const doSelect = async () => {
    setBusy(true); setError(null);
    try {
      await api.addSelection({
        stableId: node.stableId,
        label: node.browseName,
        path: occurrence.path,
      });
      onSelected?.(node);
    } catch (e) {
      setError(e.body?.mismatch ? `无法选择：${e.body.mismatch.reason}` : e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="detail">
      <h3 style={{ margin: '0 0 4px' }}>{node.displayName}</h3>
      <div className="path-line mono">{node.nodeIdText}</div>

      {occurrence.path?.length > 0 && (
        <>
          <div className="section-title">引用路径</div>
          <div className="path-line">
            {occurrence.path.map((p, i) => (
              <span key={i}>{i > 0 && ' → '}<span className="mono">{p.referenceType}</span> / {p.browseName}</span>
            ))}
          </div>
        </>
      )}

      {error && <div className="banner error">{error}</div>}
      {info?.mismatch && <div className="banner error">节点失配：{info.mismatch.reason}</div>}

      {info && !info.mismatch && (
        <dl className="kv">
          <dt>节点类别</dt><dd>{info.nodeClass}</dd>
          <dt>命名空间 URI</dt><dd className="mono">{node.stableId.namespaceUri}</dd>
          <dt>标识符类型</dt><dd>{node.stableId.identifierType}</dd>
          <dt>标识符</dt><dd className="mono">{shortNodeId(node.stableId)}</dd>
          <dt>命名空间简称</dt><dd>{shortUri(node.stableId.namespaceUri)}</dd>
          {info.dataType && (<>
            <dt>数据类型</dt><dd className="mono">{shortUri(info.dataType.namespaceUri)}:{shortNodeId(info.dataType)}</dd>
          </>)}
          <dt>ValueRank</dt><dd>{info.valueRank}{info.arrayDimensions ? ` [${info.arrayDimensions.join(',')}]` : ''}</dd>
          {info.description && (<><dt>描述</dt><dd>{info.description}</dd></>)}
        </dl>
      )}

      <div className="row-actions">
        {node.isVariable && (
          <button className="primary" disabled={busy || isSelected || info?.mismatch} onClick={doSelect}>
            {isSelected ? '已在选择列表' : '加入选择'}
          </button>
        )}
        {node.isVariable && <button disabled={busy} onClick={doRead}>立即读取一次</button>}
      </div>

      {read?.mismatch && <div className="banner error" style={{ marginTop: 12 }}>读取失配：{read.mismatch.reason}</div>}
      {read?.sample && (
        <>
          <div className="section-title">当前值</div>
          <div className="chips">
            <span className="chip">{read.sample.value?.dataType ?? 'Null'}{read.sample.value?.arrayType !== 'scalar' ? ` (${read.sample.value?.arrayType})` : ''}</span>
            <span className={`quality ${read.sample.quality}`}>{read.sample.statusCode?.name}</span>
            <span className="chip">源 {read.sample.sourceTimestamp ?? '—'}</span>
            <span className="chip">服务 {read.sample.serverTimestamp ?? '—'}</span>
          </div>
          {read.sample.quality === 'Bad'
            ? <div className="banner error">Bad 质量：无有效值（不当作数值显示）</div>
            : <div className="value-block"><ValueRenderer value={read.sample.value?.value} /></div>}
        </>
      )}
    </div>
  );
}
