// OPC UA session facade used by the gateway.
//
// Responsibilities:
//  - one client/session per connected endpoint, with the namespace array
//  - browse results converted to stable identities (URI + identifier), with
//    reference metadata for path display
//  - subscription management for value collection with full DataValue info
//  - structure fingerprints for change detection on (re)connect
import {
  OPCUAClient,
  AttributeIds,
  BrowseDirection,
  NodeClass,
  TimestampsToReturn,
  NodeIdType,
} from 'node-opcua';
import { stableIdFromNodeId, resolveStableId, stableIdKey, sameStableId } from './identity.js';
import { readStructureAttributes, computeFingerprint, sameFingerprint } from './fingerprint.js';
import { serializeDataValue } from './serialize.js';

const NODE_CLASS_NAME = Object.fromEntries(
  Object.entries(NodeClass).filter(([k, v]) => typeof v === 'number').map(([k, v]) => [v, k]),
);

export class OpcuaSession {
  constructor(endpointUrl) {
    this.endpointUrl = endpointUrl;
    this.client = null;
    this.session = null;
    this.namespaceArray = [];
    this.subscription = null;
    this.monitoredItems = new Map(); // stableIdKey -> { item, handlers }
  }

  async connect() {
    this.client = OPCUAClient.create({ endpointMustExist: false });
    await this.client.connect(this.endpointUrl);
    this.session = await this.client.createSession();
    this.namespaceArray = await this.session.readNamespaceArray();
  }

  get namespaceUris() {
    return [...this.namespaceArray];
  }

  async disconnect() {
    const errors = [];
    try {
      if (this.subscription) await this.subscription.terminate().catch((e) => errors.push(e));
    } finally {
      this.subscription = null;
      this.monitoredItems.clear();
      if (this.session) await this.session.close().catch((e) => errors.push(e));
      if (this.client) await this.client.disconnect().catch((e) => errors.push(e));
      this.session = null;
      this.client = null;
    }
    return errors;
  }

  /**
   * Browse the forward hierarchical references of a node.
   * Cycle/multi-path safety is the caller's responsibility via a known-key
   * set; this method always returns the raw references so shared nodes remain
   * reachable through every path.
   */
  async browse(stableId) {
    const { nodeId, mismatch } = resolveStableId(stableId, this.namespaceArray);
    if (mismatch) return { references: [], mismatch };
    const result = await this.session.browse({
      nodeId,
      browseDirection: BrowseDirection.Forward,
      referenceTypeId: 'HierarchicalReferences',
      includeSubtypes: true,
      nodeClassMask: NodeClass.Object | NodeClass.Variable | NodeClass.Method | NodeClass.View,
      resultMask: 63,
    });
    if (result.statusCode?.isGood?.() === false) {
      return { references: [], mismatch: { reason: 'browse-failed', statusCode: result.statusCode.toString() } };
    }
    const references = (result.references ?? []).map((ref) => this.#serializeReference(ref));
    return { references, mismatch: null };
  }

  #serializeReference(ref) {
    const targetStable = stableIdFromNodeId(ref.nodeId, this.namespaceArray);
    const typeDefStable = ref.typeDefinition
      ? stableIdFromNodeId(ref.typeDefinition, this.namespaceArray)
      : null;
    return {
      stableId: targetStable,
      key: stableIdKey(targetStable),
      browseName: ref.browseName?.name ?? ref.displayName?.text ?? '?',
      displayName: ref.displayName?.text ?? ref.browseName?.name ?? '?',
      nodeClass: NODE_CLASS_NAME[ref.nodeClass] ?? `Unknown(${ref.nodeClass})`,
      isVariable: ref.nodeClass === NodeClass.Variable,
      isMethod: ref.nodeClass === NodeClass.Method,
      referenceTypeId: ref.referenceTypeId?.toString?.() ?? null,
      referenceType: this.#referenceLabel(ref.referenceTypeId),
      typeDefinition: typeDefStable,
      nodeIdText: ref.nodeId.toString(),
    };
  }

  #referenceLabel(referenceTypeId) {
    const known = {
      'ns=0;i=35': 'Organizes',
      'ns=0;i=46': 'HasProperty',
      'ns=0;i=47': 'HasComponent',
      'ns=0;i=40': 'HasTypeDefinition',
    };
    return known[referenceTypeId?.toString?.()] ?? referenceTypeId?.toString?.() ?? '?';
  }

  /** Read a node's basic attributes (used by the tree and detail panel). */
  async readNodeInfo(stableId) {
    const { nodeId, mismatch } = resolveStableId(stableId, this.namespaceArray);
    if (mismatch) return { mismatch };
    const attrs = [
      AttributeIds.NodeId, AttributeIds.BrowseName, AttributeIds.DisplayName,
      AttributeIds.NodeClass, AttributeIds.Description, AttributeIds.DataType,
      AttributeIds.ValueRank, AttributeIds.ArrayDimensions, AttributeIds.AccessLevel,
    ];
    const values = await this.session.read(attrs.map((attributeId) => ({ nodeId, attributeId })));
    const get = (i) => (values[i].statusCode.isGood() ? values[i].value?.value : null);
    const nodeClass = get(3);
    return {
      mismatch: null,
      nodeIdText: values[0].statusCode.isGood() ? values[0].value.value : nodeId.toString(),
      browseName: get(1)?.name ?? null,
      displayName: get(2)?.text ?? null,
      nodeClass: NODE_CLASS_NAME[nodeClass] ?? null,
      description: get(4)?.text ?? null,
      dataType: get(5) ? stableIdFromNodeId(get(5), this.namespaceArray) : null,
      valueRank: get(6) ?? -1,
      arrayDimensions: Array.isArray(get(7)) ? [...get(7)] : null,
      accessLevel: get(8) ?? null,
    };
  }

  /** One-shot read, serialized for the UI. */
  async readValue(stableId) {
    const { nodeId, mismatch } = resolveStableId(stableId, this.namespaceArray);
    if (mismatch) return { mismatch };
    const dataValue = await this.session.read({ nodeId, attributeId: AttributeIds.Value });
    return { mismatch: null, sample: serializeDataValue(dataValue) };
  }

  /**
   * Compute the current structure fingerprint and compare against a stored one.
   * Returns the fresh fingerprint plus a change classification.
   */
  async inspectStructure(stableId, storedFingerprint) {
    const { nodeId, mismatch } = resolveStableId(stableId, this.namespaceArray);
    if (mismatch) return { mismatch, fingerprint: null, changed: null };
    const attrs = await readStructureAttributes(this.session, nodeId);
    const fingerprint = computeFingerprint(attrs, this.namespaceArray);
    return {
      mismatch: null,
      fingerprint,
      changed: storedFingerprint ? !sameFingerprint(fingerprint, storedFingerprint) : false,
    };
  }

  /** Verify that a node with this stable identity actually exists on the server. */
  async verifyNode(stableId) {
    const { nodeId, mismatch } = resolveStableId(stableId, this.namespaceArray);
    if (mismatch) return { exists: false, mismatch };
    const dv = await this.session.read({ nodeId, attributeId: AttributeIds.NodeClass });
    if (dv.statusCode.isGood()) return { exists: true, mismatch: null, nodeClass: NODE_CLASS_NAME[dv.value.value] ?? null };
    return {
      exists: false,
      mismatch: { reason: 'node-id-unknown-on-server', stableId, statusCode: dv.statusCode.toString() },
    };
  }

  async #ensureSubscription() {
    if (this.subscription) return this.subscription;
    this.subscription = await this.session.createSubscription2({
      requestedPublishingInterval: 250,
      requestedLifetimeCount: 100,
      requestedMaxKeepAliveCount: 10,
      maxNotificationsPerPublish: 100,
      publishingEnabled: true,
      priority: 1,
    });
    this.subscription.on('terminated', () => {
      this.subscription = null;
      this.monitoredItems.clear();
    });
    return this.subscription;
  }

  /**
   * Start collecting a node. `onSample` receives serialized DataValues,
   * including Bad/Uncertain samples (never silently dropped).
   */
  async monitor(stableId, { samplingInterval = 500, onSample, onError }) {
    const key = stableIdKey(stableId);
    if (this.monitoredItems.has(key)) {
      this.monitoredItems.get(key).handlers.push({ onSample, onError });
      return () => this.#detachHandler(key, onSample);
    }
    const { nodeId, mismatch } = resolveStableId(stableId, this.namespaceArray);
    if (mismatch) throw Object.assign(new Error(mismatch.reason), { mismatch });
    const subscription = await this.#ensureSubscription();
    const item = await subscription.monitor(
      { nodeId, attributeId: AttributeIds.Value },
      { samplingInterval, queueSize: 10, discardOldest: true },
      TimestampsToReturn.Both,
    );
    const entry = { item, detached: false, handlers: [{ onSample, onError }] };
    this.monitoredItems.set(key, entry);
    item.on('changed', (dataValue) => {
      // A terminate() request is async; a notification already queued on the
      // event loop can arrive after the item was detached. Drop it so no sample
      // is recorded for a collection the caller has already stopped.
      if (entry.detached) return;
      let serialized;
      try {
        serialized = serializeDataValue(dataValue);
      } catch (err) {
        entry.handlers.forEach((h) => h.onError?.(err));
        return;
      }
      entry.handlers.forEach((h) => h.onSample?.(serialized));
    });
    item.on('err', (err) => { if (!entry.detached) entry.handlers.forEach((h) => h.onError?.(err)); });
    return () => this.#detachHandler(key, onSample);
  }

  #detachHandler(key, onSample) {
    const entry = this.monitoredItems.get(key);
    if (!entry) return;
    entry.handlers = entry.handlers.filter((h) => h.onSample !== onSample);
    if (entry.handlers.length === 0) {
      // Flip the guard synchronously: late in-flight notifications are ignored
      // even before the (awaited-nowhere) termination completes.
      entry.detached = true;
      entry.item.terminate?.().catch(() => {});
      this.monitoredItems.delete(key);
    }
  }

  async setSamplingInterval(stableId, samplingInterval) {
    const entry = this.monitoredItems.get(stableIdKey(stableId));
    if (!entry) return;
    await entry.item.setMonitoringParameters({ samplingInterval }).catch(() => {});
  }

  async writeValue(stableId, variantOptions) {
    const { Variant, DataType, DataValue } = await import('node-opcua');
    const { nodeId, mismatch } = resolveStableId(stableId, this.namespaceArray);
    if (mismatch) return { mismatch };
    const result = await this.session.write({
      nodeId,
      attributeId: AttributeIds.Value,
      value: new DataValue({ value: new Variant(variantOptions) }),
    });
    return { mismatch: null, statusCode: result.toString() };
  }

  isMonitoring(stableId) {
    return this.monitoredItems.has(stableIdKey(stableId));
  }
}

export { sameStableId, NodeIdType };
