// Structural fingerprint of a variable node.
//
// The fingerprint describes *how the value is structured* (data type,
// array-ness, array dimensions and — for structured values — the field
// layout), never the live value itself. If this changes after a reconnect,
// previously collected samples keep their old interpretation and the user
// must confirm before new values are accepted.
//
// Note: DataTypeDefinition is an attribute of the *DataType* node, not of the
// variable, so it is read in a second hop through the variable's DataType
// attribute. Built-in data types expose no definition and simply get null.
import { AttributeIds } from 'node-opcua';
import { stableIdFromNodeId, stableIdKey } from './identity.js';

function fieldSignature(field, namespaceArray) {
  const dataTypeStable = field?.dataType
    ? stableIdFromNodeId(field.dataType, namespaceArray)
    : null;
  return {
    name: field.name,
    dataType: dataTypeStable ? stableIdKey(dataTypeStable) : null,
    valueRank: field.valueRank ?? -1,
    arrayDimensions: Array.isArray(field.arrayDimensions) ? [...field.arrayDimensions] : null,
    isOptional: !!field.isOptional,
  };
}

function definitionSignature(dataTypeDefinition, namespaceArray) {
  if (!dataTypeDefinition) return null;
  const fields = dataTypeDefinition.fields;
  if (!Array.isArray(fields)) return null;
  return {
    structureType: dataTypeDefinition.structureType ?? null,
    fields: fields.map((f) => fieldSignature(f, namespaceArray)),
  };
}

/**
 * Read everything needed to build the fingerprint.
 * Hop 1: variable's DataType / ValueRank / ArrayDimensions.
 * Hop 2: DataTypeDefinition on the resolved DataType node (custom structures only).
 */
export async function readStructureAttributes(session, nodeId) {
  const first = await session.read([
    { nodeId, attributeId: AttributeIds.DataType },
    { nodeId, attributeId: AttributeIds.ValueRank },
    { nodeId, attributeId: AttributeIds.ArrayDimensions },
  ]);
  const [dataTypeDv, valueRankDv, arrayDimensionsDv] = first;

  let definitionDv = null;
  if (dataTypeDv.statusCode.isGood()) {
    const dataTypeNodeId = dataTypeDv.value.value;
    // Namespace 0 built-in types have no user-visible structure definition.
    if (dataTypeNodeId.namespace !== 0) {
      definitionDv = await session.read({
        nodeId: dataTypeNodeId,
        attributeId: AttributeIds.DataTypeDefinition,
      });
    }
  }
  return { dataType: dataTypeDv, valueRank: valueRankDv, arrayDimensions: arrayDimensionsDv, dataTypeDefinition: definitionDv };
}

/** Compute a portable fingerprint object from the attribute reads. */
export function computeFingerprint(attrs, namespaceArray) {
  const dataTypeNodeId = attrs.dataType?.statusCode?.isGood?.()
    ? attrs.dataType.value.value
    : null;
  const valueRank = attrs.valueRank?.statusCode?.isGood?.()
    ? attrs.valueRank.value.value
    : -1;
  const arrayDimensions = attrs.arrayDimensions?.statusCode?.isGood?.()
    ? attrs.arrayDimensions.value.value
    : null;
  const dataTypeDefinition = attrs.dataTypeDefinition?.statusCode?.isGood?.()
    ? attrs.dataTypeDefinition.value.value
    : null;

  const fingerprint = {
    dataType: dataTypeNodeId ? stableIdFromNodeId(dataTypeNodeId, namespaceArray) : null,
    valueRank,
    arrayDimensions: Array.isArray(arrayDimensions) ? arrayDimensions.map(Number) : null,
    definition: definitionSignature(dataTypeDefinition, namespaceArray),
  };
  fingerprint.signature = stableSignature(fingerprint);
  return fingerprint;
}

/** Deterministic string signature (canonical, order-stable JSON). */
export function stableSignature(fingerprint) {
  return canonicalJson({
    dataType: fingerprint.dataType,
    valueRank: fingerprint.valueRank,
    arrayDimensions: fingerprint.arrayDimensions,
    definition: fingerprint.definition,
  });
}

export function sameFingerprint(a, b) {
  if (!a || !b) return a === b;
  return (a.signature ?? stableSignature(a)) === (b.signature ?? stableSignature(b));
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}
