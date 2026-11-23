// Drives subscriptions for enabled collections and feeds the sample buffer.
//
// A collection can only run when its selection's structure fingerprint still
// matches the live server. A pending structure change blocks collection until
// the user confirms it — old samples remain untouched meanwhile.
import { stableIdKey } from '../opcua/identity.js';
import { SampleBuffer } from './sample-buffer.js';

export class CollectionManager {
  constructor({ connectionManager, configStore, hub, bufferSize = 500 }) {
    this.connections = connectionManager;
    this.config = configStore;
    this.hub = hub;
    this.buffer = new SampleBuffer(bufferSize);
    this.unsubscribers = new Map(); // selectionId -> unsubscribe fn
    this.running = new Map();        // selectionId -> { samplingInterval, startedAt }
  }

  isRunning(selectionId) {
    return this.running.has(selectionId);
  }

  /**
   * Start collecting. Resolves with { status: 'started' } or a gating result
   * { status: 'structure-changed' | 'mismatch', detail } when collection must
   * wait for user action.
   */
  async start(selectionId, { samplingInterval = 500 } = {}) {
    const opc = this.connections.requireSession();
    const selection = this.config.snapshot().selections.find((s) => s.id === selectionId);
    if (!selection) throw Object.assign(new Error('Unknown selection'), { code: 'unknown-selection' });

    // Gate 1: node must exist.
    const verification = await opc.verifyNode(selection.stableId);
    if (verification.mismatch) {
      return { status: 'mismatch', detail: verification.mismatch };
    }

    // Gate 2: structure must match the confirmed fingerprint.
    if (selection.fingerprint) {
      const inspection = await opc.inspectStructure(selection.stableId, selection.fingerprint);
      if (inspection.mismatch) return { status: 'mismatch', detail: inspection.mismatch };
      if (inspection.changed) {
        return {
          status: 'structure-changed',
          detail: { stored: selection.fingerprint, current: inspection.fingerprint },
        };
      }
    }

    if (this.isRunning(selectionId)) {
      await opc.setSamplingInterval(selection.stableId, samplingInterval);
      this.running.set(selectionId, { ...this.running.get(selectionId), samplingInterval });
      this.config.upsertCollection({ selectionId, samplingInterval, enabled: true });
      return { status: 'started', alreadyRunning: true };
    }

    const structureSignature = selection.fingerprint?.signature ?? null;
    const unsubscribe = await opc.monitor(selection.stableId, {
      samplingInterval,
      onSample: (sample) => {
        const record = this.buffer.push(selectionId, sample, structureSignature);
        this.hub.broadcast({
          type: 'sample',
          selectionId,
          sample: record,
          quality: sample.quality,
        });
      },
      onError: (err) => {
        this.hub.broadcast({
          type: 'collection-error',
          selectionId,
          error: err?.message ?? String(err),
        });
      },
    });

    this.unsubscribers.set(selectionId, unsubscribe);
    this.running.set(selectionId, {
      samplingInterval,
      startedAt: new Date().toISOString(),
      structureSignature,
    });
    this.config.upsertCollection({ selectionId, samplingInterval, enabled: true });
    this.hub.broadcast({ type: 'collection-status', selectionId, running: true, samplingInterval });
    return { status: 'started' };
  }

  stop(selectionId) {
    const unsubscribe = this.unsubscribers.get(selectionId);
    if (unsubscribe) {
      try { unsubscribe(); } catch { /* ignore teardown errors */ }
    }
    this.unsubscribers.delete(selectionId);
    this.running.delete(selectionId);
    const collection = this.config.snapshot().collections.find((c) => c.selectionId === selectionId);
    if (collection) {
      this.config.upsertCollection({ selectionId, enabled: false, samplingInterval: collection.samplingInterval });
    }
    this.hub.broadcast({ type: 'collection-status', selectionId, running: false });
  }

  stopAll() {
    for (const selectionId of [...this.running.keys()]) this.stop(selectionId);
  }

  /**
   * Re-start everything that was enabled and whose selection still resolves
   * cleanly. Called after a successful (re)connect. Blocked selections are
   * reported rather than force-started.
   */
  async autoResume() {
    const snapshot = this.config.snapshot();
    const blocked = [];
    for (const collection of snapshot.collections.filter((c) => c.enabled)) {
      const result = await this.start(collection.selectionId, {
        samplingInterval: collection.samplingInterval,
      });
      if (result.status !== 'started') {
        blocked.push({ selectionId: collection.selectionId, ...result });
        this.config.upsertCollection({ selectionId: collection.selectionId, enabled: false });
      }
    }
    return blocked;
  }

  listSamples(selectionId, limit) {
    return this.buffer.list(selectionId, limit);
  }

  clearSamples(selectionId) {
    this.buffer.clear(selectionId);
    this.hub.broadcast({ type: 'samples-cleared', selectionId });
  }

  status() {
    return {
      running: Object.fromEntries(this.running.entries()),
      buffer: this.buffer.stats(),
    };
  }
}

export { stableIdKey };
