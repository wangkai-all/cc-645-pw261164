// Wire-safe serialization of OPC UA variants and data values.
//
// Every sample keeps:
//  - the OPC UA data type name (and whether it is an array / matrix)
//  - the status code name + numeric value, classified Good/Uncertain/Bad
//  - source and server timestamps
//  - a display-oriented JSON value (arrays stay arrays, structures stay objects)
// Bad/Uncertain samples are flagged so the UI never treats them as normal values.
import { DataType, StatusCodes, NodeIdType } from 'node-opcua';

const DATA_TYPE_NAMES = Object.fromEntries(
  Object.entries(DataType)
    .filter(([, v]) => typeof v === 'number')
    .map(([name, code]) => [code, name]),
);

export function dataTypeName(variant) {
  return DATA_TYPE_NAMES[variant.dataType] ?? `Unknown(${variant.dataType})`;
}

function isExtensionObject(value) {
  return value != null && typeof value === 'object'
    && (typeof value.encode === 'function' || value.schema != null || value.encodingDefaultBinary != null);
}

function serializeScalar(value, dataType) {
  if (value === null || value === undefined) return null;
  // Date -> ISO string (DateTime)
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return { base64: value.toString('base64'), byteLength: value.length };
  // NodeId-like
  if (typeof value.toString === 'function' && value.identifierType !== undefined) {
    return nodeIdLikeToJson(value);
  }
  if (dataType === DataType.ExtensionObject) {
    if (isExtensionObject(value) || typeof value === 'object') {
      return plainObject(value);
    }
  }
  if (typeof value === 'object') {
    return plainObject(value);
  }
  return value;
}

function nodeIdLikeToJson(value) {
  const idType = {
    [NodeIdType.NUMERIC]: 'numeric',
    [NodeIdType.STRING]: 'string',
    [NodeIdType.GUID]: 'guid',
    [NodeIdType.BYTESTRING]: 'opaque',
  }[value.identifierType] ?? 'unknown';
  return {
    nodeId: value.toString(),
    identifierType: idType,
    namespaceUri: value.namespaceUri ?? null,
  };
}

function plainObject(obj) {
  if (obj instanceof Date) return obj.toISOString();
  if (obj instanceof Map) {
    return Object.fromEntries([...obj.entries()].map(([k, v]) => [k, serializeAny(v)]));
  }
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'function') continue;
    out[k] = serializeAny(v);
  }
  return out;
}

function serializeAny(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    return [...value].map((v) => serializeAny(v));
  }
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return { base64: value.toString('base64'), byteLength: value.length };
  if (typeof value === 'object') return plainObject(value);
  return value;
}

export function serializeVariant(variant) {
  if (!variant) return null;
  const name = dataTypeName(variant);
  const isArray = variant.arrayType === 1 || variant.arrayType === 2 || Array.isArray(variant.value);
  const dimensions = Array.isArray(variant.dimensions) ? [...variant.dimensions] : null;
  let jsonValue;
  if (variant.dataType === DataType.ExtensionObject) {
    const v = variant.value;
    if (Array.isArray(v)) {
      jsonValue = v.map((item) => (item == null ? null : plainObject(item)));
    } else {
      jsonValue = v == null ? null : plainObject(v);
    }
  } else if (isArray) {
    jsonValue = [...(variant.value ?? [])].map((item) => serializeScalar(item, variant.dataType));
  } else {
    jsonValue = serializeScalar(variant.value, variant.dataType);
  }
  return {
    dataType: name,
    dataTypeCode: variant.dataType,
    arrayType: isArray ? (variant.arrayType === 2 ? 'matrix' : 'array') : 'scalar',
    arrayDimensions: dimensions,
    value: jsonValue,
  };
}

export function classifyStatus(statusCode) {
  if (!statusCode) return 'Bad';
  const value = statusCode.value ?? 0;
  // Top two bits: 00 = Good, 01 = Uncertain, 1x = Bad
  if ((value & 0xc0000000) === 0) return 'Good';
  if ((value & 0xc0000000) === 0x40000000) return 'Uncertain';
  return 'Bad';
}

export function serializeStatusCode(statusCode) {
  if (!statusCode) return null;
  const numeric = statusCode.value ?? 0;
  // find symbolic name
  let name = statusCode.name ?? null;
  if (!name) {
    const found = Object.entries(StatusCodes).find(([, sc]) => sc && sc.value === numeric);
    name = found ? found[0] : null;
  }
  return {
    name: name ?? statusCode.toString()?.split(' ')[0] ?? 'Unknown',
    numeric,
    hex: `0x${(numeric >>> 0).toString(16).padStart(8, '0')}`,
    quality: classifyStatus(statusCode),
  };
}

/** Serialize a full DataValue (read result or subscription notification). */
export function serializeDataValue(dataValue) {
  if (!dataValue) return null;
  const status = serializeStatusCode(dataValue.statusCode);
  // A Bad value is not a value: present null regardless of the variant the
  // server attached, so the UI can never render a Bad sample as a number.
  // Uncertain samples keep their value but stay explicitly flagged.
  const includeValue = status.quality !== 'Bad' && dataValue.value;
  return {
    value: includeValue ? serializeVariant(dataValue.value) : null,
    statusCode: status,
    quality: status.quality,
    isGood: status.quality === 'Good',
    sourceTimestamp: dataValue.sourceTimestamp ? new Date(dataValue.sourceTimestamp).toISOString() : null,
    sourcePicoseconds: dataValue.sourcePicoseconds ?? 0,
    serverTimestamp: dataValue.serverTimestamp ? new Date(dataValue.serverTimestamp).toISOString() : null,
    serverPicoseconds: dataValue.serverPicoseconds ?? 0,
  };
}
