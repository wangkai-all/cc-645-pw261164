// Builds the demo address space.
//
// Two structural variants share every node identifier and namespace URI but:
//   - register the two application namespaces in opposite order (proves that
//     selections keyed by URI+identifier survive an index reshuffle),
//   - V2 changes the BatchRecord field layout (structure-change confirmation),
//   - V2 removes the Pressure node and adds Pressure2 with the *same browse
//     name* but a different identifier (proves an identifier mismatch is
//     reported instead of silently re-binding by name).
import {
  DataType,
  DataValue,
  StatusCodes,
  Variant,
  VariantArrayType,
  resolveNodeId,
  NodeIdType,
  standardUnits,
} from 'node-opcua';
import { ensureDatatypeExtracted } from 'node-opcua-address-space';

export const NS_PROCESS = 'urn:demo:process';
export const NS_CONFIG = 'urn:demo:config';

// String identifiers used by every variant — these are the durable identities.
export const IDS = {
  plant: 's=DemoPlant',
  line1: 's=Line1',
  reactor: 's=Line1.Reactor',
  temperature: 's=Line1.Reactor.Temperature',
  pressure: 's=Line1.Reactor.Pressure',       // removed in V2
  pressure2: 's=Line1.Reactor.Pressure2',      // V2 only, same browse name "Pressure"
  batch: 's=Line1.Reactor.Batch',
  levels: 's=Line1.Reactor.Levels',
  matrix: 's=Line1.Reactor.Matrix',
  counter: 's=Line1.Reactor.Counter',
  reset: 's=Line1.Reactor.Reset',
  loop: 's=Loops.Loop',
  loops: 's=Loops',
  line2: 's=Line2',
  mirror: 's=Line2.Mirror',
  batchType: 's=Type.BatchRecord',
  batchBinaryEnc: 's=Type.BatchRecord.Encoding.DefaultBinary',
  batchXmlEnc: 's=Type.BatchRecord.Encoding.DefaultXml',
  qualityTarget: 's=Control.QualityTarget',
  qualityLevel: 's=Control.QualityLevel',
  arrayLength: 's=Control.ArrayLength',
  structureVersion: 's=Control.StructureVersion',
};

const QUALITY_STATUS = {
  Good: StatusCodes.Good,
  Uncertain: StatusCodes.Uncertain,
  Bad: StatusCodes.Bad,
};

function batchFields(variant) {
  if (variant === 'V2') {
    return [
      { name: 'id', dataType: resolveNodeId('String'), description: 'renamed from batchId' },
      { name: 'sequence', dataType: resolveNodeId('Int32') },
      { name: 'temperature', dataType: resolveNodeId('Double') },
      { name: 'pressure', dataType: resolveNodeId('Double'), description: 'new in V2' },
      { name: 'createdAt', dataType: resolveNodeId('DateTime') },
    ];
  }
  return [
    { name: 'batchId', dataType: resolveNodeId('String') },
    { name: 'sequence', dataType: resolveNodeId('Int32') },
    { name: 'temperature', dataType: resolveNodeId('Double') },
    { name: 'createdAt', dataType: resolveNodeId('DateTime') },
  ];
}

/**
 * Build (or rebuild) the demo model inside an initialized server's address space.
 * Returns a live state object and a dispose() that stops the simulation timer.
 */
export async function buildDemoAddressSpace(server, variant) {
  const addressSpace = server.engine.addressSpace;

  // Opposite registration order between variants: indices change, URIs do not.
  const orderedUris = variant === 'V2' ? [NS_CONFIG, NS_PROCESS] : [NS_PROCESS, NS_CONFIG];
  const namespaces = Object.fromEntries(
    orderedUris.map((uri) => [uri, addressSpace.registerNamespace(uri)]),
  );
  const processNs = namespaces[NS_PROCESS];
  const configNs = namespaces[NS_CONFIG];

  // ---- structured type -----------------------------------------------------
  const batchType = processNs.createDataType({
    browseName: 'BatchRecord',
    nodeId: IDS.batchType,
    isAbstract: false,
    subtypeOf: 'Structure',
    partialDefinition: batchFields(variant),
  });
  const binaryEncoding = processNs.addObject({
    browseName: 'Default Binary', nodeId: IDS.batchBinaryEnc, typeDefinition: 'DataTypeEncodingType',
  });
  const xmlEncoding = processNs.addObject({
    browseName: 'Default XML', nodeId: IDS.batchXmlEnc, typeDefinition: 'DataTypeEncodingType',
  });
  batchType.addReference({ referenceType: 'HasEncoding', isForward: true, nodeId: binaryEncoding.nodeId });
  batchType.addReference({ referenceType: 'HasEncoding', isForward: true, nodeId: xmlEncoding.nodeId });
  await ensureDatatypeExtracted(addressSpace);

  // ---- mutable simulation state --------------------------------------------
  const state = {
    tick: 0,
    qualityTarget: 'none',       // browse-name key of the variable to inject into, or 'none'
    qualityLevel: 'Good',
    arrayLength: 4,
    variant,
  };

  const now = () => new Date();
  const injected = (key) => state.qualityTarget === key ? state.qualityLevel : 'Good';
  const dataValue = (variantValue, key) => {
    const quality = injected(key);
    const ts = now();
    if (quality === 'Bad') {
      // Bad samples deliberately carry no value; the UI must not render a number.
      return new DataValue({
        value: new Variant({ dataType: DataType.Null }),
        statusCode: StatusCodes.Bad,
        sourceTimestamp: ts, serverTimestamp: ts,
      });
    }
    return new DataValue({
      value: variantValue,
      statusCode: QUALITY_STATUS[quality] ?? StatusCodes.Good,
      sourceTimestamp: ts, serverTimestamp: ts,
    });
  };

  // ---- hierarchy -------------------------------------------------------------
  const plant = processNs.addFolder('ObjectsFolder', { browseName: 'DemoPlant', nodeId: IDS.plant });
  const line1 = processNs.addFolder(plant, { browseName: 'Line1', nodeId: IDS.line1 });
  const reactor = processNs.addObject({
    componentOf: line1, browseName: 'Reactor', nodeId: IDS.reactor, typeDefinition: 'BaseObjectType',
  });

  processNs.addVariable({
    componentOf: reactor, browseName: 'Temperature', nodeId: IDS.temperature,
    dataType: 'Double', minimumSamplingInterval: 100, engineeringUnits: standardUnits.degree_celsius,
    value: { timestamped_get: () => dataValue(
      new Variant({ dataType: DataType.Double, value: 25 + 5 * Math.sin(state.tick / 10) }), 'Temperature') },
  });

  if (variant === 'V1') {
    processNs.addVariable({
      componentOf: reactor, browseName: 'Pressure', nodeId: IDS.pressure,
      dataType: 'Double', minimumSamplingInterval: 100,
      value: { timestamped_get: () => dataValue(
        new Variant({ dataType: DataType.Double, value: 1.5 + 0.1 * Math.sin(state.tick / 7) }), 'Pressure') },
    });
  } else {
    // Same browse name, different identifier — a name-based match would mis-bind here.
    processNs.addVariable({
      componentOf: reactor, browseName: 'Pressure', nodeId: IDS.pressure2,
      dataType: 'Double', minimumSamplingInterval: 100,
      value: { timestamped_get: () => dataValue(
        new Variant({ dataType: DataType.Double, value: 2.0 + 0.1 * Math.cos(state.tick / 7) }), 'Pressure') },
    });
  }

  processNs.addVariable({
    componentOf: reactor, browseName: 'Batch', nodeId: IDS.batch,
    dataType: batchType.nodeId, minimumSamplingInterval: 100,
    value: {
      timestamped_get: () => {
        const fields = variant === 'V2'
          ? {
              id: `B-${(state.tick % 90).toString().padStart(3, '0')}`,
              sequence: state.tick,
              temperature: 25 + 5 * Math.sin(state.tick / 10),
              pressure: 1.5 + 0.1 * Math.sin(state.tick / 7),
              createdAt: now(),
            }
          : {
              batchId: `B-${(state.tick % 90).toString().padStart(3, '0')}`,
              sequence: state.tick,
              temperature: 25 + 5 * Math.sin(state.tick / 10),
              createdAt: now(),
            };
        return dataValue(
          new Variant({
            dataType: DataType.ExtensionObject,
            value: addressSpace.constructExtensionObject(batchType.nodeId, fields),
          }), 'Batch');
      },
    },
  });

  processNs.addVariable({
    componentOf: reactor, browseName: 'Levels', nodeId: IDS.levels,
    dataType: 'Double', valueRank: 1, minimumSamplingInterval: 100,
    arrayDimensions: [state.arrayLength],
    value: {
      timestamped_get: () => {
        const len = Math.max(0, Math.min(64, state.arrayLength | 0));
        const arr = Array.from({ length: len }, (_, i) => (state.tick + i) % 7 + 0.25 * i);
        return dataValue(new Variant({
          dataType: DataType.Double, arrayType: VariantArrayType.Array, value: arr,
        }), 'Levels');
      },
    },
  });

  processNs.addVariable({
    componentOf: reactor, browseName: 'Matrix', nodeId: IDS.matrix,
    dataType: 'Double', valueRank: 2, minimumSamplingInterval: 500,
    value: {
      timestamped_get: () => {
        const flat = Array.from({ length: 9 }, (_, i) => (state.tick + i) % 5);
        return dataValue(new Variant({
          dataType: DataType.Double, arrayType: VariantArrayType.Matrix, value: flat, dimensions: [3, 3],
        }), 'Matrix');
      },
    },
  });

  processNs.addVariable({
    componentOf: reactor, browseName: 'Counter', nodeId: IDS.counter,
    dataType: 'Int32', minimumSamplingInterval: 100,
    value: { timestamped_get: () => dataValue(
      new Variant({ dataType: DataType.Int32, value: state.tick }), 'Counter') },
  });

  // A method node — visible in the tree, not collectible as a value.
  processNs.addMethod(reactor, {
    browseName: 'Reset', nodeId: IDS.reset,
    inputArguments: [], outputArguments: [],
    executable: true,
  }).bindMethod(async (_inputArguments, _context) => {
    state.tick = 0;
    return { statusCode: StatusCodes.Good };
  });

  // ---- multi-path: Line2/Mirror reaches the same Reactor ---------------------
  const line2 = processNs.addFolder(plant, { browseName: 'Line2', nodeId: IDS.line2 });
  const mirror = processNs.addObject({
    componentOf: line2, browseName: 'Mirror', nodeId: IDS.mirror, typeDefinition: 'BaseObjectType',
  });
  mirror.addReference({ referenceType: 'Organizes', isForward: true, nodeId: reactor.nodeId });

  // ---- reference cycle: Reactor -> Loop -> DemoPlant -> ... ------------------
  const loops = processNs.addFolder(plant, { browseName: 'Loops', nodeId: IDS.loops });
  const loop = processNs.addObject({
    componentOf: loops, browseName: 'Loop', nodeId: IDS.loop, typeDefinition: 'BaseObjectType',
  });
  reactor.addReference({ referenceType: 'Organizes', isForward: true, nodeId: loop.nodeId });
  loop.addReference({ referenceType: 'Organizes', isForward: true, nodeId: plant.nodeId });

  // ---- writable control variables -------------------------------------------
  const controlFolder = configNs.addFolder('ObjectsFolder', { browseName: 'QualityControl', nodeId: 's=Control' });

  const writableString = (browseName, nodeId, get) => configNs.addVariable({
    componentOf: controlFolder, browseName, nodeId, dataType: 'String',
    accessLevel: 'CurrentRead | CurrentWrite', userAccessLevel: 'CurrentRead | CurrentWrite',
    minimumSamplingInterval: 50,
    value: {
      get: () => new Variant({ dataType: DataType.String, value: get() }),
      set: (v) => { applyControl(browseName, v.value); return StatusCodes.Good; },
    },
  });

  writableString('QualityTarget', IDS.qualityTarget, () => state.qualityTarget);
  writableString('QualityLevel', IDS.qualityLevel, () => state.qualityLevel);

  configNs.addVariable({
    componentOf: controlFolder, browseName: 'ArrayLength', nodeId: IDS.arrayLength,
    dataType: 'Int32', accessLevel: 'CurrentRead | CurrentWrite',
    userAccessLevel: 'CurrentRead | CurrentWrite', minimumSamplingInterval: 50,
    value: {
      get: () => new Variant({ dataType: DataType.Int32, value: state.arrayLength }),
      set: (v) => { state.arrayLength = v.value | 0; return StatusCodes.Good; },
    },
  });
  configNs.addVariable({
    componentOf: controlFolder, browseName: 'StructureVersion', nodeId: IDS.structureVersion,
    dataType: 'String', minimumSamplingInterval: 1000,
    value: { get: () => new Variant({ dataType: DataType.String, value: variant }) },
  });

  function applyControl(browseName, value) {
    if (browseName === 'QualityTarget') state.qualityTarget = String(value);
    if (browseName === 'QualityLevel') {
      state.qualityLevel = ['Good', 'Uncertain', 'Bad'].includes(String(value)) ? String(value) : 'Good';
    }
  }

  const timer = setInterval(() => { state.tick++; }, 500);
  return {
    state,
    dispose: () => clearInterval(timer),
    namespaceUris: { process: NS_PROCESS, config: NS_CONFIG },
  };
}
