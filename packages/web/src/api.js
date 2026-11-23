// Typed-ish HTTP client for the gateway.
async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(json.error ?? `HTTP ${res.status}`), { status: res.status, body: json });
  }
  return json;
}

export const api = {
  connection: () => request('/api/connection'),
  connect: (payload) => request('/api/connection/connect', payload),
  disconnect: () => request('/api/connection/disconnect', {}),
  reconcile: () => request('/api/connection/reconcile', {}),
  browse: (stableId) => request('/api/browse', { stableId }),
  nodeInfo: (stableId) => request('/api/node-info', { stableId }),
  read: (stableId) => request('/api/read', { stableId }),
  selections: () => request('/api/selections'),
  addSelection: (payload) => request('/api/selections', payload),
  removeSelection: (id) => request(`/api/selections/${id}`, undefined, 'DELETE'),
  confirmStructure: (id) => request(`/api/selections/${id}/confirm-structure`, {}),
  collections: () => request('/api/collections'),
  start: (selectionId, samplingInterval) => request('/api/collections/start', { selectionId, samplingInterval }),
  stop: (selectionId) => request('/api/collections/stop', { selectionId }),
  clear: (selectionId) => request('/api/collections/clear', { selectionId }),
  samples: (selectionId, limit = 200) => request(`/api/samples/${selectionId}?limit=${limit}`),
  write: (payload) => request('/api/write', payload),
  config: () => request('/api/config'),
};
