// Repeatable, self-contained demo.
//
// Drives the gateway exactly the way the UI would, printing a narrated
// transcript. Assumes the gateway is already running on PORT (start it with
// `npm start`). Reset state by deleting packages/data/config.json first.
const PORT = process.env.PORT ?? 4080;
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (path, body, method = body === undefined ? 'GET' : 'POST') => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${json.error ?? ''}`);
  return json;
};
const step = (n, text) => console.log(`\n[${n}] ${text}`);
const find = (browse, name) => browse.references.find((r) => r.browseName === name);
const ROOT = { namespaceUri: 'http://opcfoundation.org/UA/', identifierType: 'numeric', identifier: 84 };

async function walkToReactor() {
  const root = await api('/api/browse', { stableId: ROOT });
  const objects = await api('/api/browse', { stableId: find(root, 'Objects').stableId });
  const plant = await api('/api/browse', { stableId: find(objects, 'DemoPlant').stableId });
  const line1 = await api('/api/browse', { stableId: find(plant, 'Line1').stableId });
  const reactorBrowse = await api('/api/browse', { stableId: find(line1, 'Reactor').stableId });
  // demonstrate the reference cycle
  const loop = find(reactorBrowse, 'Loop');
  const loopBrowse = await api('/api/browse', { stableId: loop.stableId });
  console.log('    引用环: Reactor → Loop →', find(loopBrowse, 'DemoPlant').browseName, '(回到起点，不重复复制)');
  return reactorBrowse;
}

async function main() {
  console.log('=== OPC UA 地址空间浏览器 · 可重复演示 ===');

  step(1, '连接内置测试服务器（结构 V1）');
  const info = await api('/api/connection/connect', { embeddedDemo: true, variant: 'V1' });
  console.log('    命名空间表:', info.namespaceUris);
  console.log('    urn:demo:process 的当前序号 =', info.namespaceUris.indexOf('urn:demo:process'));

  step(2, '按对象展开节点，沿引用路径找到 Reactor（含引用环检查）');
  const reactor = await walkToReactor();

  step(3, '挑选变量并保存为选择（身份=命名空间 URI + 标识符）');
  const tempRef = find(reactor, 'Temperature');
  const batchRef = find(reactor, 'Batch');
  const tempSel = await api('/api/selections', { stableId: tempRef.stableId, label: 'Temperature', path: [{ browseName: 'Temperature' }] });
  const batchSel = await api('/api/selections', { stableId: batchRef.stableId, label: 'Batch', path: [{ browseName: 'Batch' }] });
  console.log('    Temperature 稳定身份:', JSON.stringify(tempSel.stableId));
  console.log('    Batch 结构字段:', batchSel.fingerprint.definition.fields.map((f) => f.name).join(', '));

  step(4, '开始采集，检查类型/状态码/源时间/服务时间（同时留存 V1 结构的 Batch 历史样本）');
  await api('/api/collections/start', { selectionId: tempSel.id, samplingInterval: 300 });
  await api('/api/collections/start', { selectionId: batchSel.id, samplingInterval: 300 });
  await sleep(900);
  const good = (await api(`/api/samples/${tempSel.id}?limit=5`)).at(-1);
  console.log(`    样本: 类型=${good.value.dataType} 值=${good.value.value} 状态=${good.statusCode.name} 源=${good.sourceTimestamp} 服务=${good.serverTimestamp}`);
  const v1BatchCount = (await api(`/api/samples/${batchSel.id}`)).length;
  console.log(`    V1 结构 Batch 历史样本数: ${v1BatchCount}（稍后与 V2 新定义样本共存）`);
  await api('/api/collections/stop', { selectionId: batchSel.id });

  step(5, '注入 Bad / Uncertain 质量状态');
  const objectsBrowse = await api('/api/browse', { stableId: find(await api('/api/browse', { stableId: ROOT }), 'Objects').stableId });
  const qc = await api('/api/browse', { stableId: find(objectsBrowse, 'QualityControl').stableId });
  const idOf = (name) => find(qc, name).stableId;
  await api('/api/write', { stableId: idOf('QualityTarget'), dataType: 'String', value: 'Temperature' });
  await api('/api/write', { stableId: idOf('QualityLevel'), dataType: 'String', value: 'Bad' });
  await sleep(800);
  const bad = (await api(`/api/samples/${tempSel.id}?limit=5`)).at(-1);
  console.log(`    Bad 样本: 质量=${bad.quality} 值是否为空=${bad.value === null}（不当作数值）`);
  await api('/api/write', { stableId: idOf('QualityLevel'), dataType: 'String', value: 'Uncertain' });
  await sleep(800);
  const unc = (await api(`/api/samples/${tempSel.id}?limit=5`)).at(-1);
  console.log(`    Uncertain 样本: 质量=${unc.quality} 值保留=${unc.value?.value}（明确标注可疑）`);
  await api('/api/write', { stableId: idOf('QualityLevel'), dataType: 'String', value: 'Good' });
  await api('/api/write', { stableId: idOf('QualityTarget'), dataType: 'String', value: 'none' });

  step(6, '修改数组长度并读取数组/结构化值');
  await api('/api/write', { stableId: idOf('ArrayLength'), dataType: 'Int32', value: 5 });
  const levelsRef = find(reactor, 'Levels');
  const levelsRead = await api('/api/read', { stableId: levelsRef.stableId });
  console.log('    Levels 数组:', levelsRead.sample.value.arrayType, JSON.stringify(levelsRead.sample.value.value));
  const batchRead = await api('/api/read', { stableId: batchRef.stableId });
  console.log('    Batch 结构化值:', JSON.stringify(batchRead.sample.value.value));

  step(7, '“重启”服务器为 V2：命名空间顺序变化 + 结构变化');
  const info2 = await api('/api/connection/connect', { embeddedDemo: true, variant: 'V2' });
  console.log('    urn:demo:process 的新序号 =', info2.namespaceUris.indexOf('urn:demo:process'), '(URI 不变，选择仍指向同一节点)');
  const reconcile = await api('/api/connection/reconcile', {});
  for (const r of reconcile.reconciliation) {
    const label = r.selectionId === batchSel.id ? 'Batch' : 'Temperature';
    console.log(`    选择 ${label}: ${r.state}`, r.state === 'structure-changed' ? '(等待确认)' : '');
  }

  step(8, '确认新结构后按新定义接收，历史样本保留旧解释');
  await api(`/api/selections/${batchSel.id}/confirm-structure`, {});
  await api('/api/collections/start', { selectionId: batchSel.id, samplingInterval: 300 });
  await sleep(900);
  const all = await api(`/api/samples/${batchSel.id}?limit=50`);
  const oldSamples = all.filter((s) => 'batchId' in (s.value?.value ?? {}));
  const oldSigs = new Set(oldSamples.map((s) => s.structureSignature));
  const newOnes = all.filter((s) => 'id' in (s.value?.value ?? {}));
  console.log('    历史样本数:', oldSamples.length, '| 旧结构签名数:', oldSigs.size, '| 新定义样本数:', newOnes.length);
  console.log('    新旧样本在同一缓冲区共存，旧样本保留 batchId 解释，新样本字段:', Object.keys(newOnes[0].value.value).join(', '));

  await api('/api/connection/disconnect', {});
  console.log('\n=== 演示完成。打开 http://localhost:4080 可在网页中重复以上全部操作。 ===');
}

main().catch((err) => { console.error('演示失败:', err); process.exit(1); });
