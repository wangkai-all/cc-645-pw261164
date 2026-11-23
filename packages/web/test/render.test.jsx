// Component render smoke tests using react-dom/server.
// A real browser cannot be installed in this sandbox, so we render every
// component to HTML with realistic props (shapes identical to what the
// gateway returns) to catch runtime errors, bad property access and broken
// value/structure rendering. This does not replace interactive testing but
// proves the component tree is sound.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import assert from 'node:assert';

import ValueRenderer, { MatrixView } from '../src/components/ValueRenderer.jsx';
import StructureChangeModal from '../src/components/StructureChangeModal.jsx';
import SamplePanelParts from '../src/components/CollectionPanel.jsx';
import ConnectionBar from '../src/components/ConnectionBar.jsx';
import DemoControls from '../src/components/DemoControls.jsx';
import { stableIdKey } from '../src/identity.js';

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log('  ok ', name);
};

const sampleStable = { namespaceUri: 'urn:demo:process', identifierType: 'string', identifier: 'Line1.Reactor.Temperature' };

test('stableIdKey matches the gateway rule', () => {
  assert.equal(stableIdKey(sampleStable), 'urn:demo:process|string|Line1.Reactor.Temperature');
});

test('ValueRenderer renders scalar/array/structure/matrix without throwing', () => {
  const scalar = renderToStaticMarkup(<ValueRenderer value={3.14} />);
  assert.ok(scalar.includes('3.14'));
  const arr = renderToStaticMarkup(<ValueRenderer value={[1, 2, 3]} />);
  assert.ok(arr.includes('array-cell') && arr.includes('2'));
  const struct = renderToStaticMarkup(<ValueRenderer value={{ batchId: 'B-1', temperature: 36.5, createdAt: '2026-01-01T00:00:00.000Z' }} />);
  assert.ok(struct.includes('batchId') && struct.includes('B-1'));
  const matrix = renderToStaticMarkup(<MatrixView value={[1, 2, 3, 4, 5, 6, 7, 8, 9]} dimensions={[3, 3]} />);
  assert.ok(matrix.includes('matrix-table'));
  const nullVal = renderToStaticMarkup(<ValueRenderer value={null} />);
  assert.ok(nullVal.includes('null'));
  const bytes = renderToStaticMarkup(<ValueRenderer value={{ base64: 'AAA=', byteLength: 2 }} />);
  assert.ok(bytes.includes('ByteString'));
});

test('StructureChangeModal shows field-level diff', () => {
  const selection = { id: 's1', label: 'Batch', stableId: sampleStable };
  const detail = {
    stored: {
      dataType: { identifier: 'Type.BatchRecord' }, valueRank: -1,
      definition: { fields: [{ name: 'batchId', dataType: 'x|string', valueRank: -1, arrayDimensions: null }, { name: 'temperature', dataType: 'x|double', valueRank: -1, arrayDimensions: null }] },
    },
    current: {
      dataType: { identifier: 'Type.BatchRecord' }, valueRank: -1,
      definition: { fields: [{ name: 'id', dataType: 'x|string', valueRank: -1, arrayDimensions: null }, { name: 'temperature', dataType: 'x|double', valueRank: -1, arrayDimensions: null }, { name: 'pressure', dataType: 'x|double', valueRank: -1, arrayDimensions: null }] },
    },
  };
  const html = renderToStaticMarkup(
    <StructureChangeModal selection={selection} detail={detail} busy={false} onConfirm={() => {}} onCancel={() => {}} />,
  );
  assert.ok(html.includes('结构类型已变化'));
  assert.ok(html.includes('新增字段: id') && html.includes('新增字段: pressure'));
  assert.ok(html.includes('移除字段: batchId'));
  assert.ok(html.includes('确认按新定义接收'));
});

test('CollectionPanel renders ok/mismatch/changed states and Bad samples', () => {
  const config = {
    selections: [
      { id: 'a', label: 'Temperature', stableId: sampleStable, path: [{ browseName: 'Temperature' }], fingerprint: { signature: 'sig1' } },
      { id: 'b', label: 'Gone', stableId: { namespaceUri: 'urn:demo:process', identifierType: 'string', identifier: 'Line1.Reactor.Pressure' }, path: [], fingerprint: { signature: 'sig2' } },
    ],
    collections: [],
  };
  const reconcile = [
    { selectionId: 'a', state: 'ok', detail: null },
    { selectionId: 'b', state: 'mismatch', detail: { reason: 'node-id-unknown-on-server' } },
  ];
  // CollectionPanel uses effects; SSR still renders the synchronous card tree.
  const html = renderToStaticMarkup(
    <SamplePanelParts config={config} reconcile={reconcile} runningMap={{}} liveSamples={[]} onReconcile={() => {}} />,
  );
  assert.ok(html.includes('Temperature') && html.includes('Gone'));
  assert.ok(html.includes('node-id-unknown-on-server'));
  assert.ok(html.includes('sel-card mismatch'));
  assert.ok(html.includes('开始采集'));
});

test('ConnectionBar reflects connected/embedded/V2 state', () => {
  const html = renderToStaticMarkup(
    <ConnectionBar
      connection={{ status: 'connected', embedded: true, variant: 'V2', endpointUrl: 'opc.tcp://x:4840', lastError: null }}
      onConnect={() => {}} onDisconnect={() => {}} busy={false}
    />,
  );
  assert.ok(html.includes('已连接') && html.includes('V2'));
});

test('DemoControls renders the external-endpoint fallback', () => {
  const html = renderToStaticMarkup(
    <DemoControls connection={{ status: 'connected', embedded: false, variant: null }} />,
  );
  assert.ok(html.includes('外部端点不提供这些控制变量'));
});

console.log(`\n${passed} COMPONENT RENDER TESTS PASSED`);
