// End-to-end test of the gateway HTTP API (no browser).
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

// find a reference by browse name inside a browse result
const findRef = (browse, name) => browse.references.find((r) => r.browseName === name);

async function main() {
  console.log('1) health + connect embedded V1');
  const health = await api('/api/health');
  check('health', health.ok === true);

  const info = await api('/api/connection/connect', { embeddedDemo: true, variant: 'V1' });
  check('connected', info.status === 'connected', info.status);
  check('namespace uris exposed', info.namespaceUris.includes('urn:demo:process'));
  check('process ns index is 2 in V1', info.namespaceUris.indexOf('urn:demo:process') === 2);

  console.log('2) browse down the hierarchy using stable identities');
  const root = await api('/api/browse', {
    stableId: { namespaceUri: 'http://opcfoundation.org/UA/', identifierType: 'numeric', identifier: 84 },
  });
  const objectsRef = findRef(root, 'Objects');
  check('browse Objects', !!objectsRef, objectsRef?.key);
  const objects = await api('/api/browse', { stableId: objectsRef.stableId });
  const plantRef = findRef(objects, 'DemoPlant');
  check('DemoPlant found via URI identity', !!plantRef, JSON.stringify(plantRef?.stableId));
  check('plant identity uses string identifier', plantRef.stableId.identifierType === 'string');

  const plant = await api('/api/browse', { stableId: plantRef.stableId });
  const line1Ref = findRef(plant, 'Line1');
  const line2Ref = findRef(plant, 'Line2');
  const loopsRef = findRef(plant, 'Loops');
  check('Line1/Line2/Loops', !!(line1Ref && line2Ref && loopsRef));

  const line1 = await api('/api/browse', { stableId: line1Ref.stableId });
  const reactorRef = findRef(line1, 'Reactor');
  const reactor = await api('/api/browse', { stableId: reactorRef.stableId });
  const tempRef = findRef(reactor, 'Temperature');
  const batchRef = findRef(reactor, 'Batch');
  const levelsRef = findRef(reactor, 'Levels');
  check('Temperature/Batch/Levels variables', !!(tempRef && batchRef && levelsRef));

  console.log('3) multi-path + cycle references are exposed (dedup stays client-side)');
  const line2 = await api('/api/browse', { stableId: line2Ref.stableId });
  const mirrorRef = findRef(line2, 'Mirror');
  const mirror = await api('/api/browse', { stableId: mirrorRef.stableId });
  const reactorViaMirror = findRef(mirror, 'Reactor');
  check('same Reactor reachable via Line2/Mirror',
    reactorViaMirror.key === reactorRef.key, `${reactorViaMirror?.key} === ${reactorRef.key}`);
  const loopRef = findRef(reactor, 'Loop');
  const loop = await api('/api/browse', { stableId: loopRef.stableId });
  const plantFromLoop = findRef(loop, 'DemoPlant');
  check('cycle back to DemoPlant exposed', plantFromLoop.key === plantRef.key);

  console.log('4) selections persist stable identity + fingerprint');
  const tempSel = await api('/api/selections', {
    stableId: tempRef.stableId, label: 'Reactor Temperature',
    path: [plantRef, line1Ref, reactorRef, tempRef].map((r) => ({ key: r.key, browseName: r.browseName, referenceType: r.referenceType })),
  });
  check('temperature selection saved', !!tempSel.id && !!tempSel.fingerprint);
  const batchSel = await api('/api/selections', {
    stableId: batchRef.stableId, label: 'Reactor Batch',
    path: [{ key: batchRef.key, browseName: 'Batch' }],
  });
  check('batch selection has structure fingerprint',
    batchSel.fingerprint?.definition?.fields?.some((f) => f.name === 'batchId'),
    JSON.stringify(batchSel.fingerprint?.definition?.fields?.map((f) => f.name)));
  const levelsSel = await api('/api/selections', {
    stableId: levelsRef.stableId, label: 'Levels', path: [],
  });
  check('levels fingerprint records valueRank=1', levelsSel.fingerprint.valueRank === 1);

  console.log('5) value collection keeps type, status, both timestamps');
  const started = await api('/api/collections/start', { selectionId: tempSel.id, samplingInterval: 200 });
  check('collection started', started.status === 'started', started.status);
  await new Promise((r) => setTimeout(r, 1100));
  let samples = await api(`/api/samples/${tempSel.id}?limit=10`);
  check('samples received', samples.length >= 2, `count=${samples.length}`);
  const s0 = samples[0];
  check('sample has dataType Double', s0.value?.dataType === 'Double');
  check('sample has Good quality', s0.quality === 'Good' && s0.isGood === true);
  check('sample has both timestamps', !!s0.sourceTimestamp && !!s0.serverTimestamp);
  check('sample tagged with structure signature', !!s0.structureSignature);

  console.log('6) quality injection: Bad samples must not look like values');
  // locate QualityControl variables
  const controlBrowse = await api('/api/browse', { stableId: objectsRef.stableId });
  const qcRef = findRef(controlBrowse, 'QualityControl');
  const qc = await api('/api/browse', { stableId: qcRef.stableId });
  const targetRef = findRef(qc, 'QualityTarget');
  const levelRef = findRef(qc, 'QualityLevel');
  await api('/api/write', { stableId: targetRef.stableId, dataType: 'String', value: 'Temperature' });
  await api('/api/write', { stableId: levelRef.stableId, dataType: 'String', value: 'Bad' });
  await new Promise((r) => setTimeout(r, 900));
  samples = await api(`/api/samples/${tempSel.id}?limit=20`);
  const badSamples = samples.filter((s) => s.quality === 'Bad');
  check('Bad samples recorded', badSamples.length >= 1, `bad=${badSamples.length}`);
  check('Bad sample carries status code', badSamples[0]?.statusCode?.name === 'Bad' && badSamples[0]?.isGood === false);
  check('Bad sample does not carry a numeric value', badSamples[0]?.value === null);
  // restore
  await api('/api/write', { stableId: levelRef.stableId, dataType: 'String', value: 'Good' });
  await api('/api/write', { stableId: targetRef.stableId, dataType: 'String', value: 'none' });
  await new Promise((r) => setTimeout(r, 700));

  console.log('7) array length control + array/structured values');
  const lenRef = findRef(qc, 'ArrayLength');
  await api('/api/write', { stableId: lenRef.stableId, dataType: 'Int32', value: 6 });
  const oneShot = await api('/api/read', { stableId: levelsRef.stableId });
  check('array read is array type with 6 elements',
    oneShot.sample.value.arrayType === 'array' && oneShot.sample.value.value.length === 6,
    `len=${oneShot.sample.value.value.length}`);
  const batchRead = await api('/api/read', { stableId: batchRef.stableId });
  check('structured value rendered as object',
    typeof batchRead.sample.value.value === 'object' && 'batchId' in batchRead.sample.value.value);

  console.log('8) Uncertain quality classified separately');
  await api('/api/write', { stableId: targetRef.stableId, dataType: 'String', value: 'Temperature' });
  await api('/api/write', { stableId: levelRef.stableId, dataType: 'String', value: 'Uncertain' });
  await new Promise((r) => setTimeout(r, 900));
  samples = await api(`/api/samples/${tempSel.id}?limit=20`);
  const unc = samples.filter((s) => s.quality === 'Uncertain');
  check('Uncertain samples classified', unc.length >= 1, `uncertain=${unc.length}`);
  await api('/api/write', { stableId: levelRef.stableId, dataType: 'String', value: 'Good' });
  await api('/api/write', { stableId: targetRef.stableId, dataType: 'String', value: 'none' });

  console.log('9) stop + clear + persistence file');
  await api('/api/collections/stop', { selectionId: tempSel.id });
  await api('/api/collections/clear', { selectionId: tempSel.id });
  const afterClear = await api(`/api/samples/${tempSel.id}`);
  check('samples cleared', afterClear.length === 0);
  const persisted = await api('/api/config');
  check('config persisted 3 selections', persisted.selections.length === 3);
  check('persisted identities are URI-based',
    persisted.selections.every((s) => typeof s.stableId.namespaceUri === 'string' && !('namespaceIndex' in s.stableId)));

  console.log('\n10) explicit mismatch: unknown namespace URI is reported, not bound');
  const mismatch = await api('/api/node-info', {
    stableId: { namespaceUri: 'urn:does-not-exist', identifierType: 'string', identifier: 'whatever' },
  });
  check('namespace mismatch reported', mismatch.mismatch?.reason === 'namespace-uri-not-on-server');

  console.log(failures === 0 ? '\nALL BACKEND CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error('TEST CRASH:', err); process.exit(1); });
