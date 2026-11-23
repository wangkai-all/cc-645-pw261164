import { useEffect, useState } from 'react';
import { api } from '../api.js';

const TARGETS = ['none', 'Temperature', 'Pressure', 'Batch', 'Levels', 'Matrix', 'Counter'];
const LEVELS = ['Good', 'Uncertain', 'Bad'];

// Locate the QualityControl folder's writable variables by browsing once.
export default function DemoControls({ connection }) {
  const [controlIds, setControlIds] = useState(null);
  const [target, setTarget] = useState('none');
  const [level, setLevel] = useState('Good');
  const [arrayLength, setArrayLength] = useState(4);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function locate() {
      try {
        const objects = await api.browse({
          stableId: { namespaceUri: 'http://opcfoundation.org/UA/', identifierType: 'numeric', identifier: 85 },
        });
        const qc = objects.references.find((r) => r.browseName === 'QualityControl');
        if (!qc) return;
        const children = await api.browse({ stableId: qc.stableId });
        const map = Object.fromEntries(children.references.map((r) => [r.browseName, r.stableId]));
        if (!cancelled) setControlIds(map);
      } catch {
        /* controls are only present on the embedded demo server */
      }
    }
    if (connection.status === 'connected' && connection.embedded) locate();
    else setControlIds(null);
    return () => { cancelled = true; };
  }, [connection.status, connection.embedded, connection.variant]);

  if (!controlIds) {
    return (
      <div className="panel-body">
        <div className="section-title">演示控制台</div>
        <div className="muted">连接内置测试服务器后，可在此修改数组长度、注入质量状态。外部端点不提供这些控制变量。</div>
      </div>
    );
  }

  const write = async (stableId, dataType, value) => {
    setMessage(null);
    try {
      const r = await api.write({ stableId, dataType, value });
      if (r.mismatch) setMessage(`写入失配：${r.mismatch.reason}`);
    } catch (e) {
      setMessage(e.message);
    }
  };

  return (
    <div className="panel-body">
      <div className="section-title">演示控制台</div>
      {message && <div className="banner warn">{message}</div>}

      <div className="control-grid" style={{ gridTemplateColumns: '120px 1fr auto' }}>
        <span className="muted">质量注入目标</span>
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          {TARGETS.map((t) => <option key={t} value={t}>{t === 'none' ? '（不注入）' : t}</option>)}
        </select>
        <button onClick={() => write(controlIds.QualityTarget, 'String', target)}>应用目标</button>
      </div>

      <div className="control-grid" style={{ gridTemplateColumns: '120px 1fr auto' }}>
        <span className="muted">质量状态</span>
        <select value={level} onChange={(e) => setLevel(e.target.value)}>
          {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <button onClick={() => write(controlIds.QualityLevel, 'String', level)}>注入质量</button>
      </div>

      <div className="control-grid" style={{ gridTemplateColumns: '120px 1fr auto' }}>
        <span className="muted">数组长度 (Levels)</span>
        <input type="number" min="0" max="64" value={arrayLength}
          onChange={(e) => setArrayLength(Number(e.target.value))} />
        <button onClick={() => write(controlIds.ArrayLength, 'Int32', arrayLength)}>修改长度</button>
      </div>

      <div className="banner info">
        提示：注入 <b>Bad</b> 后，目标变量的新样本将不带数值并以红色标记；<b>Uncertain</b> 保留数值但明确标注为可疑。
      </div>
    </div>
  );
}
