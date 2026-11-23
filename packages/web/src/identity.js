// Mirror of the gateway's stable-identity key rule, used for de-duplication
// and lookups in the tree and selection panels.
export function stableIdKey(stableId) {
  if (!stableId) return '';
  return `${stableId.namespaceUri}|${stableId.identifierType}|${stableId.identifier}`;
}

export function shortNodeId(stableId) {
  if (!stableId) return '';
  const prefix = { numeric: 'i', string: 's', guid: 'g', opaque: 'b' }[stableId.identifierType] ?? '?';
  return `${prefix}=${stableId.identifier}`;
}

export function shortUri(uri) {
  if (!uri) return '';
  if (uri === 'http://opcfoundation.org/UA/') return 'opcua';
  return uri.replace(/^urn:/, '').replace(/^https?:\/\//, '');
}
