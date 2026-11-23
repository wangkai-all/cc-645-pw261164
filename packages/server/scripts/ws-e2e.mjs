// Verifies the WebSocket fan-out: connect, start a collection, confirm live
// sample frames arrive with the documented shape (type, selectionId, sample,
// quality), and that collection-status/config frames are broadcast too.
import { WebSocket } from 'ws';

const BASE_HTTP = 'http://localhost:4080';
const api = async (path, body) => {
  const res = await fetch(`${BASE_HTTP}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
};

const messages = [];
const ws = new WebSocket('ws://localhost:4080/ws');
await new Promise((resolve, reject) => {
  ws.on('open', resolve);
  ws.on('error', reject);
});
ws.on('message', (buf) => messages.push(JSON.parse(buf.toString())));

await api('/api/connection/connect', { embeddedDemo: true, variant: 'V1' });

// browse to Temperature
const root = await api('/api/browse', { stableId: { namespaceUri: 'http://opcfoundation.org/UA/', identifierType: 'numeric', identifier: 84 } });
const objects = await api('/api/browse', { stableId: root.references.find((r) => r.browseName === 'Objects').stableId });
const plant = await api('/api/browse', { stableId: objects.references.find((r) => r.browseName === 'DemoPlant').stableId });
const line1 = await api('/api/browse', { stableId: plant.references.find((r) => r.browseName === 'Line1').stableId });
const reactor = await api('/api/browse', { stableId: line1.references.find((r) => r.browseName === 'Reactor').stableId });
const temp = reactor.references.find((r) => r.browseName === 'Temperature');

const sel = await api('/api/selections', { stableId: temp.stableId, label: 'WS Temp', path: [] });
await api('/api/collections/start', { selectionId: sel.id, samplingInterval: 200 });

await new Promise((r) => setTimeout(r, 1200));
await api('/api/collections/stop', { selectionId: sel.id });

const types = messages.map((m) => m.type);
const samples = messages.filter((m) => m.type === 'sample' && m.selectionId === sel.id);
const statuses = messages.filter((m) => m.type === 'collection-status');

let failures = 0;
const check = (name, cond, extra = '') => {
  if (cond) console.log('  ok ', name, extra);
  else { failures++; console.error('  FAIL', name, extra); }
};
check('hello frame received', types.includes('hello'));
check('connection frame received', types.includes('connection'));
check('config frame broadcast on selection', types.includes('config'));
check('collection-status frames (start+stop)', statuses.length >= 2, String(statuses.length));
check('live sample frames received', samples.length >= 2, `count=${samples.length}`);
const s = samples[0].sample;
check('sample has quality + statusCode', s.quality === 'Good' && s.statusCode?.name === 'Good');
check('sample has both timestamps', !!s.sourceTimestamp && !!s.serverTimestamp);
check('sample has typed value', s.value?.dataType === 'Double' && typeof s.value.value === 'number');
check('sample has structure signature', typeof s.structureSignature === 'string');

ws.close();
console.log(failures === 0 ? '\nWS PUSH CHECKS PASSED' : `\n${failures} WS CHECK(S) FAILED`);
process.exit(failures ? 1 : 0);
