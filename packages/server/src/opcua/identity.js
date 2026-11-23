// Stable node identity: namespace URI + identifier, never a namespace index.
//
// OPC UA namespace indices are per-connection: restarting a server (or adding a
// namespace) can shift them while the same node keeps the same namespace URI
// and identifier. Every persisted selection therefore stores the URI and the
// identifier, and indices are re-resolved on each connection.
import { coerceNodeId, NodeIdType } from 'node-opcua';

/**
 * Serialize an identifier value depending on its type.
 * ByteString identifiers are stored as base64 so the whole identity is JSON-safe.
 */
function serializeIdentifier(nodeId) {
  switch (nodeId.identifierType) {
    case NodeIdType.NUMERIC:
      return { identifierType: 'numeric', identifier: nodeId.value };
    case NodeIdType.STRING:
      return { identifierType: 'string', identifier: nodeId.value };
    case NodeIdType.GUID:
      return { identifierType: 'guid', identifier: String(nodeId.value) };
    case NodeIdType.BYTESTRING:
      return { identifierType: 'opaque', identifier: Buffer.from(nodeId.value).toString('base64') };
    default:
      throw new Error(`Unsupported NodeId identifier type: ${nodeId.identifierType}`);
  }
}

/**
 * Build a stable identity from a NodeId/ExpandedNodeId plus the connection's
 * namespace array (index -> URI). ExpandedNodeIds may carry their own
 * namespaceUri, which wins when present.
 */
export function stableIdFromNodeId(nodeId, namespaceArray) {
  if (nodeId == null) return null;
  let namespaceUri;
  if (nodeId.namespaceUri) {
    namespaceUri = nodeId.namespaceUri;
  } else if (nodeId.namespace === 0) {
    namespaceUri = namespaceArray[0] ?? 'http://opcfoundation.org/UA/';
  } else {
    namespaceUri = namespaceArray[nodeId.namespace];
  }
  if (!namespaceUri) {
    throw new Error(`Cannot resolve namespace URI for index ${nodeId.namespace}; namespace array incomplete`);
  }
  return { namespaceUri, ...serializeIdentifier(nodeId) };
}

/** Deterministic string key used for de-duplication and Map lookups. */
export function stableIdKey(stableId) {
  return `${stableId.namespaceUri}|${stableId.identifierType}|${stableId.identifier}`;
}

/**
 * Resolve a stable identity back to a concrete NodeId for the current
 * connection. Never silently binds to a different node:
 *  - unknown namespace URI -> explicit mismatch
 *  - node absent on the server -> explicit mismatch (checked by the caller via a read)
 */
export function resolveStableId(stableId, namespaceArray) {
  const namespaceIndex = namespaceArray.indexOf(stableId.namespaceUri);
  if (namespaceIndex < 0) {
    return {
      nodeId: null,
      mismatch: {
        reason: 'namespace-uri-not-on-server',
        namespaceUri: stableId.namespaceUri,
        serverNamespaces: namespaceArray,
      },
    };
  }
  const typeCode = { numeric: 'i', string: 's', guid: 'g', opaque: 'b' }[stableId.identifierType];
  if (!typeCode) {
    return { nodeId: null, mismatch: { reason: 'unsupported-identifier-type', stableId } };
  }
  const nodeId = coerceNodeId(`ns=${namespaceIndex};${typeCode}=${stableId.identifier}`);
  return { nodeId, mismatch: null };
}

/** True when two stable identities describe exactly the same node. */
export function sameStableId(a, b) {
  return !!a && !!b && stableIdKey(a) === stableIdKey(b);
}
