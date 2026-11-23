import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { shortNodeId, shortUri } from '../identity.js';
import ValueRenderer, { MatrixView } from './ValueRenderer.jsx';
import StructureChangeModal from './StructureChangeModal.jsx';

function SampleValue({ sample }) {
  if (sample.quality === 'Bad' || sample.value === null) {
    return <span className="muted">— 无有效值 —</span>;
  }
  const v = sample.value;
  if (v.arrayType === 'matrix' && Array.isArray(v.value) && v.arrayDimensions?.length === 2) {
    return <MatrixView value={v.value} dimensions={v.arrayDimensions} />;
  }
  return <ValueRenderer value={v.value} />;
}

function SelectionCard({ sel, state, running, onStart, onStop, onClear, onRemove, onShowChange }) {
  const mismatch = state?.state === 'mismatch';
  const changed = state?.state === 'structure-changed';
  const [interval, setIntervalMs] = useState(500);

  return (
    <div className={`sel-card ${mismatch ? 'mismatch' : changed ? 'changed' : ''}`}>
      <div className="sel-head">
        <div>
          <div className="sel-title">{sel.label}</div>
          <div className="path-line mono" style={{ marginBottom: 2 }}>
            {shortUri(sel.stableId.namespaceUri)} : {shortNodeId(sel.stableId)}
          </div>
        </div>
        <div className="row-actions">
          {running
            ? <button onClick={() => onStop(sel.id)}>停止</button>
            : <button className="primary" disabled={mismatch || changed} onClick={() => onStart(sel.id, interval)}>开始采集</button>}
          <button onClick={() => onClear(sel.id)}>清空</button>
          <button className="danger" onClick={() => onRemove(sel.id)}>删除</button>
        </div>
      </div>

      {sel.path?.length > 0 && (
        <div className="path-line">
          {sel.path.map((p, i) => <span key={i}>{i > 0 && ' → '}{p.browseName}</span>)}
        </div>
      )}

      <div className="control-grid">
        <span className="muted">采样间隔(ms)</span>
        <input type="number" min="50" step="50" value={interval} onChange={(e) => setIntervalMs(Number(e.target.value))} />
        <span className="chip">{running ? '采集中' : '已停止'}</span>
      </div>

      {mismatch && (
        <div className="banner error">
          节点失配（{state.detail?.reason}）：当前服务器上找不到该标识，不会按名称错误重绑。请删除此选择或改连包含该节点的服务器。
        </div>
      )}
      {changed && (
        <div className="banner warn">
          结构类型已变化，采集已暂停。
          <button style={{ marginLeft: 8 }} onClick={() => onShowChange(sel, state.detail)}>查看差异并确认</button>
        </div>
      )}
    </div>
  );
}

export default function CollectionPanel({ config, reconcile, runningMap, liveSamples, onReconcile }) {
  const [activeId, setActiveId] = useState(null);
  const [samples, setSamples] = useState([]);
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const liveBuffer = useRef(new Map());

  const stateMap = useMemo(
    () => Object.fromEntries((reconcile ?? []).map((r) => [r.selectionId, r])),
    [reconcile],
  );

  const selections = config?.selections ?? [];
  const activeSelection = selections.find((s) => s.id === activeId) ?? selections[0];
  const currentId = activeSelection?.id;

  // Load buffered samples when the active selection changes.
  useEffect(() => {
    if (!currentId) { setSamples([]); return; }
    let cancelled = false;
    api.samples(currentId, 300).then((rows) => { if (!cancelled) setSamples(rows); }).catch(() => {});
    return () => { cancelled = true; };
  }, [currentId]);

  // Merge live samples pushed over WebSocket.
  useEffect(() => {
    if (!liveSamples.length) return;
    for (const msg of liveSamples) {
      if (msg.type !== 'sample') continue;
      const buf = liveBuffer.current.get(msg.selectionId) ?? [];
      buf.push(msg.sample);
      if (buf.length > 300) buf.shift();
      liveBuffer.current.set(msg.selectionId, buf);
    }
    const buf = liveBuffer.current.get(currentId);
    if (buf?.length) setSamples((prev) => [...prev, ...buf].slice(-300));
    liveBuffer.current.set(currentId, []);
  }, [liveSamples, currentId]);

  // Refresh when samples get cleared.
  useEffect(() => {
    if (!liveSamples.length) return;
    if (liveSamples.some((m) => m.type === 'samples-cleared' && m.selectionId === currentId)) {
      setSamples([]);
    }
  }, [liveSamples, currentId]);

  const guard = async (fn) => {
    setBusy(true); setNotice(null);
    try { await fn(); } catch (e) { setNotice(e.message); } finally { setBusy(false); }
  };

  const handleStart = (id, interval) => guard(async () => {
    const result = await api.start(id, interval);
    if (result.status === 'structure-changed') {
      const sel = selections.find((s) => s.id === id);
      setModal({ selection: sel, detail: result.detail });
    } else if (result.status === 'mismatch') {
      setNotice(`无法采集：${result.detail?.reason}`);
    }
    onReconcile?.();
  });
  const handleStop = (id) => guard(() => api.stop(id));
  const handleClear = (id) => guard(() => api.clear(id));
  const handleRemove = (id) => guard(async () => { await api.removeSelection(id); onReconcile?.(); });
  const handleConfirm = async () => {
    setBusy(true);
    try {
      await api.confirmStructure(modal.selection.id);
      setModal(null);
      onReconcile?.();
    } finally { setBusy(false); }
  };

  return (
    <div className="panel-body">
      {notice && <div className="banner error">{notice}</div>}
      <div className="section-title">当前选择（{selections.length}）</div>
      {selections.length === 0 && <div className="muted">还没有选择。在左侧树中展开对象，对变量点击“加入选择”。</div>}
      {selections.map((sel) => (
        <div key={sel.id} onClick={() => setActiveId(sel.id)} style={{ cursor: 'pointer' }}>
          <SelectionCard
            sel={sel}
            state={stateMap[sel.id]}
            running={!!runningMap[sel.id]}
            onStart={handleStart}
            onStop={handleStop}
            onClear={handleClear}
            onRemove={handleRemove}
            onShowChange={(selection, detail) => setModal({ selection, detail })}
          />
        </div>
      ))}

      {currentId && (
        <>
          <div className="section-title">
            采集结果 — {activeSelection.label}
            <span className="chip" style={{ marginLeft: 8 }}>{samples.length} 条</span>
          </div>
          <div className="value-block" style={{ padding: 0, maxHeight: 380, overflow: 'auto' }}>
            <table className="samples">
              <thead>
                <tr><th>#</th><th>质量</th><th>类型</th><th>值</th><th>源时间</th><th>服务时间</th><th>结构</th></tr>
              </thead>
              <tbody>
                {samples.map((s) => (
                  <tr key={s.sequence}>
                    <td className="mono muted">{s.sequence}</td>
                    <td><span className={`quality ${s.quality}`} title={s.statusCode?.hex}>{s.statusCode?.name ?? s.quality}</span></td>
                    <td className="mono muted" style={{ whiteSpace: 'nowrap' }}>
                      {s.value?.dataType ?? 'Null'}{s.value?.arrayType !== 'scalar' ? ` (${s.value.arrayType})` : ''}
                    </td>
                    <td style={{ minWidth: 160 }}><SampleValue sample={s} /></td>
                    <td className="mono muted" style={{ whiteSpace: 'nowrap' }}>{s.sourceTimestamp?.slice(11, 23) ?? '—'}</td>
                    <td className="mono muted" style={{ whiteSpace: 'nowrap' }}>{s.serverTimestamp?.slice(11, 23) ?? '—'}</td>
                    <td className="mono muted" title={s.structureSignature ?? ''}>{s.structureSignature ? s.structureSignature.slice(0, 8) + '…' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {modal && (
        <StructureChangeModal
          selection={modal.selection}
          detail={modal.detail}
          busy={busy}
          onConfirm={handleConfirm}
          onCancel={() => setModal(null)}
        />
      )}
    </div>
  );
}
