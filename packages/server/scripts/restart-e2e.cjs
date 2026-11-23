// Restart / structure-change end-to-end test.
//
// Runs against the gateway and simulates the server being restarted with the
// V2 model: application namespaces register in the opposite order, the
// BatchRecord structure changes shape, and the Pressure node disappears while
// a different node takes over its browse name.
const BASE = 'http://localhost:4080';
let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`  ok  ${name} ${extra}`);
  else { failures++; console.error(`  FAIL ${name} ${extra}`); }
}
const api = async (path, body, method = body === undefined ? 'GET' : 'POST') => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error ?? `HTTP ${res.status}`), { body: json });
  return json;
};
const findRef = (browse, name) => browse.references.find((r) => r.browseName === name);
const PROCESS = 'urn:demo:process';
const stable = (identifier) => ({ namespaceUri: PROCESS, identifierType: 'string', identifier });

async function walkToReactor() {
  const root = await api('/api/browse', { stableId: { namespaceUri: 'http://opcfoundation.org/UA/', identifierType: 'numeric', identifier: 84 } });
  const objects = await api('/api/browse', { stableId: findRef(root, 'Objects').stableId });
  const plant = await api('/api/browse', { stableId: findRef(objects, 'DemoPlant').stableId });
  const line1 = await api('/api/browse', { stableId: findRef(plant, 'Line1').stableId });
  return api('/api/browse', { stableId: findRef(line1, 'Reactor').stableId });
}

async function main() {
  console.log('A) start against V1 and select nodes (including Pressure)');
  let info = await api('/api/connection/connect', { embeddedDemo: true, variant: 'V1' });
  check('V1 process namespace at index 2', info.namespaceUris.indexOf(PROCESS) === 2, String(info.namespaceUris));

  const reactor = await walkToReactor();
  const pressureV1 = findRef(reactor, 'Pressure');
  check('V1 Pressure identifier', pressureV1.stableId.identifier === 'Line1.Reactor.Pressure');
  const batchRef = findRef(reactor, 'Batch');

  let sel = await api('/api/selections', { stableId: pressureV1.stableId, label: 'Pressure V1', path: [] });
  const pressureSelId = sel.id;
  const existingBatch = (await api('/api/selections')).find((s) => s.label === 'Reactor Batch');
  const batchSelId = existingBatch?.id
    ?? (await api('/api/selections', { stableId: batchRef.stableId, label: 'Reactor Batch', path: [] })).id;

  // collect a few V1 Batch samples
  await api('/api/collections/start', { selectionId: batchSelId, samplingInterval: 200 });
  await new Promise((r) => setTimeout(r, 900));
  await api('/api/collections/stop', { selectionId: batchSelId });
  const v1Samples = await api(`/api/samples/${batchSelId}`);
  check('V1 samples collected', v1Samples.length >= 1, `count=${v1Samples.length}`);
  const v1Signature = v1Samples[0].structureSignature;
  check('V1 sample interpreted with batchId', 'batchId' in v1Samples[0].value.value);
  const configV1 = await api('/api/config');
  const batchFingerprintV1 = configV1.selections.find((s) => s.id === batchSelId).fingerprint;
  check('V1 fingerprint has 4 fields', batchFingerprintV1.definition.fields.length === 4);

  console.log('B) "restart" the server with V2 (namespace reorder + new structure)');
  info = await api('/api/connection/connect', { embeddedDemo: true, variant: 'V2' });
  check('V2 process namespace moved to index 3', info.namespaceUris.indexOf(PROCESS) === 3, String(info.namespaceUris));

  console.log('C) persisted selections re-resolve via URI, not index');
  const reconcile = await api('/api/connection/reconcile', {});
  const bySel = Object.fromEntries(reconcile.reconciliation.map((r) => [r.selectionId, r]));
  const batchState = bySel[batchSelId];
  check('Batch flagged structure-changed', batchState?.state === 'structure-changed', batchState?.state);
  check('structure change details carry both definitions',
    batchState?.detail?.current?.definition?.fields?.some((f) => f.name === 'id')
    && batchState?.detail?.stored?.definition?.fields?.some((f) => f.name === 'batchId'));

  const pressureState = bySel[pressureSelId];
  check('V1 Pressure selection mismatches (identifier absent on V2)',
    pressureState?.state === 'mismatch' && pressureState.detail.reason === 'node-id-unknown-on-server',
    JSON.stringify(pressureState?.detail));

  console.log('D) name-based re-binding must not happen: V2 "Pressure" is a different node');
  const reactorV2 = await walkToReactor();
  const pressureV2 = findRef(reactorV2, 'Pressure');
  check('V2 Pressure keeps browse name but has new identifier',
    pressureV2.stableId.identifier === 'Line1.Reactor.Pressure2',
    pressureV2.stableId.identifier);
  check('V1 and V2 Pressure identities differ', pressureV2.key !== pressureV1.key);

  console.log('E) trying to start collection on the mismatched node is refused');
  const refused = await api('/api/collections/start', { selectionId: pressureSelId, samplingInterval: 200 });
  check('collection gated by mismatch', refused.status === 'mismatch', refused.status);

  console.log('F) old samples keep their V1 interpretation while change is pending');
  const samplesWhilePending = await api(`/api/samples/${batchSelId}`);
  check('history retained', samplesWhilePending.length === v1Samples.length);
  check('retained sample still shows batchId (old interpretation)',
    'batchId' in samplesWhilePending[0].value.value);

  console.log('G) user confirms the new structure');
  await api(`/api/selections/${batchSelId}/confirm-structure`, {});
  const configV2 = await api('/api/config');
  const batchFingerprintV2 = configV2.selections.find((s) => s.id === batchSelId).fingerprint;
  check('fingerprint now has 5 fields incl. pressure/id',
    batchFingerprintV2.definition.fields.length === 5
    && batchFingerprintV2.definition.fields.some((f) => f.name === 'pressure')
    && batchFingerprintV2.definition.fields.some((f) => f.name === 'id'));
  check('previous fingerprint retained for traceability',
    configV2.selections.find((s) => s.id === batchSelId).previousFingerprint?.signature === batchFingerprintV1.signature);

  console.log('H) new samples arrive under the new interpretation, old ones untouched');
  await api('/api/collections/start', { selectionId: batchSelId, samplingInterval: 200 });
  await new Promise((r) => setTimeout(r, 900));
  await api('/api/collections/stop', { selectionId: batchSelId });
  const all = await api(`/api/samples/${batchSelId}`);
  const oldOnes = all.filter((s) => s.structureSignature === v1Signature);
  const newOnes = all.filter((s) => s.structureSignature === batchFingerprintV2.signature);
  check('old samples still present with old signature', oldOnes.length === v1Samples.length);
  check('new samples present with new signature', newOnes.length >= 1, `new=${newOnes.length}`);
  check('new sample interpreted with id/pressure',
    'id' in newOnes[0].value.value && 'pressure' in newOnes[0].value.value);
  check('old sample still interpreted with batchId', 'batchId' in oldOnes[0].value.value);

  console.log('I) forgetting the mismatched selection removes it cleanly');
  await api(`/api/selections/${pressureSelId}`, undefined, 'DELETE');
  const remaining = (await api('/api/selections')).map((s) => s.id);
  check('pressure selection forgotten', !remaining.includes(pressureSelId));

  console.log(failures === 0 ? '\nALL RESTART CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error('TEST CRASH:', err); process.exit(1); });
