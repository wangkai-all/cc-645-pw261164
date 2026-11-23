// Renders a serialized variant value appropriately for its shape:
// scalars inline, arrays as wrapped chips, matrices as grids, structures as
// nested key/value blocks. Bad samples never reach here with a value.
function StructureView({ value }) {
  if (value === null || typeof value !== 'object') return <span className="mono">{String(value)}</span>;
  if (value.base64 !== undefined) {
    return <span className="mono">ByteString({value.byteLength}B) {value.base64.slice(0, 24)}…</span>;
  }
  if (value.nodeId !== undefined) {
    return <span className="mono">{value.nodeId}</span>;
  }
  return (
    <div className="value-block">
      {Object.entries(value).map(([k, v]) => (
        <div key={k} className="field-row">
          <span className="muted">{k}</span>
          <span><ValueRenderer value={v} /></span>
        </div>
      ))}
    </div>
  );
}

function MatrixView({ value, dimensions }) {
  const cols = dimensions?.[1] ?? value.length;
  const rows = dimensions?.[0] ?? 1;
  return (
    <table className="matrix-table">
      <tbody>
        {Array.from({ length: rows }, (_, r) => (
          <tr key={r}>
            {Array.from({ length: cols }, (_, c) => (
              <td key={c} className="mono">{value[r * cols + c] ?? ''}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ValueRenderer({ value }) {
  if (value === null || value === undefined) return <span className="muted">null</span>;
  if (typeof value !== 'object') return <span className="mono">{String(value)}</span>;
  if (value.base64 !== undefined || value.nodeId !== undefined) return <StructureView value={value} />;
  if (Array.isArray(value)) {
    return (
      <div className="array-row">
        {value.map((item, i) => (
          <span key={i} className="array-cell mono">
            {typeof item === 'object' && item !== null ? <StructureView value={item} /> : String(item)}
          </span>
        ))}
      </div>
    );
  }
  // matrix variant is serialized as a flat array + arrayDimensions; detect via
  // caller passing the wrapper instead (handled in SampleTable).
  return <StructureView value={value} />;
}

export { MatrixView };
