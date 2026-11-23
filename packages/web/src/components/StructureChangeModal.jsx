// Shown when a selection's structure fingerprint differs from the live
// server. The user must explicitly accept the new definition before new
// samples are collected; historical samples keep their old interpretation.
function FieldList({ definition }) {
  if (!definition?.fields) return <div className="muted">无结构化字段（内置类型或数组）</div>;
  return (
    <div>
      {definition.fields.map((f, i) => (
        <div key={i} className="field-row">
          <span className="mono">{f.name}</span>
          <span className="muted mono">{f.dataType?.split('|').slice(1).join(':') ?? f.dataType}{f.valueRank > 0 ? `[${f.arrayDimensions?.join(',') ?? ''}]` : ''}</span>
        </div>
      ))}
    </div>
  );
}

function fieldNames(def) {
  return new Set((def?.fields ?? []).map((f) => f.name));
}

export default function StructureChangeModal({ selection, detail, onConfirm, onCancel, busy }) {
  if (!selection || !detail) return null;
  const oldDef = detail.stored?.definition;
  const newDef = detail.current?.definition;
  const oldNames = fieldNames(oldDef);
  const newNames = fieldNames(newDef);
  const added = [...newNames].filter((n) => !oldNames.has(n));
  const removed = [...oldNames].filter((n) => !newNames.has(n));

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>结构类型已变化 — 需要确认</h2>
        <p className="muted">
          节点 <b>{selection.label}</b> 的数据结构与保存选择时不同。确认后新样本将按新定义解释；
          已采集的历史样本会保留原来的解释，不会被重新解读。
        </p>

        {(added.length > 0 || removed.length > 0) && (
          <div className="chips">
            {added.map((n) => <span key={`a${n}`} className="chip" style={{ color: 'var(--good)', borderColor: 'var(--good)' }}>新增字段: {n}</span>)}
            {removed.map((n) => <span key={`r${n}`} className="chip" style={{ color: 'var(--bad)', borderColor: 'var(--bad)' }}>移除字段: {n}</span>)}
          </div>
        )}

        <div className="diff-grid">
          <div className="diff-box">
            <h3>保存时的定义</h3>
            <dl className="kv" style={{ gridTemplateColumns: '110px 1fr' }}>
              <dt>数据类型</dt><dd className="mono">{detail.stored?.dataType?.identifier}</dd>
              <dt>ValueRank</dt><dd>{detail.stored?.valueRank}</dd>
            </dl>
            <FieldList definition={oldDef} />
          </div>
          <div className="diff-box">
            <h3>服务器当前定义</h3>
            <dl className="kv" style={{ gridTemplateColumns: '110px 1fr' }}>
              <dt>数据类型</dt><dd className="mono">{detail.current?.dataType?.identifier}</dd>
              <dt>ValueRank</dt><dd>{detail.current?.valueRank}</dd>
            </dl>
            <FieldList definition={newDef} />
          </div>
        </div>

        <div className="modal-actions">
          <button disabled={busy} onClick={onCancel}>暂不确认（保持挂起）</button>
          <button className="primary" disabled={busy} onClick={onConfirm}>确认按新定义接收</button>
        </div>
      </div>
    </div>
  );
}
