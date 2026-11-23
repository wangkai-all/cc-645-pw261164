// Manages the OPC UA connection and reconciles persisted selections with
// whatever the (possibly restarted, possibly re-structured) server exposes.
//
// On every connect each persisted stable identity is re-resolved:
//   - namespace URI missing      -> namespace mismatch
//   - identifier absent on server -> node mismatch (never re-bound by name)
//   - structure fingerprint differs -> structure mismatch (confirm before accepting)
import { startTestServer, DEFAULT_PORT } from '../test-server/factory.js';
import { OpcuaSession } from './session.js';
import { sameFingerprint } from './fingerprint.js';

export class ConnectionManager {
  constructor(configStore) {
    this.config = configStore;
    this.opc = null;
    this.embedded = null;
    this.status = 'disconnected'; // disconnected | connecting | connected | error
    this.lastError = null;
    this.endpointUrl = null;
  }

  isEmbedded() {
    return !!this.embedded;
  }

  /**
   * Connect to an endpoint, starting (or restarting) the embedded demo server
   * when requested. `variant` only applies to the embedded server.
   */
  async connect({ endpointUrl, embeddedDemo, variant }) {
    await this.disconnect();
    this.status = 'connecting';
    this.lastError = null;
    try {
      let url = endpointUrl;
      if (embeddedDemo) {
        const port = DEFAULT_PORT;
        this.embedded = await startTestServer({ port, variant: variant ?? 'V1' });
        url = this.embedded.endpointUrl;
      }
      if (!url) throw new Error('No endpoint URL provided and embedded demo disabled');
      this.opc = new OpcuaSession(url);
      await this.opc.connect();
      this.endpointUrl = url;
      this.status = 'connected';
      this.config.patch({
        endpointUrl: embeddedDemo ? null : url,
        embeddedDemo: !!embeddedDemo,
        demoVariant: embeddedDemo ? (variant ?? 'V1') : this.config.data.demoVariant,
      });
      return await this.reconcileSelections();
    } catch (err) {
      this.status = 'error';
      this.lastError = err.message;
      // roll back a half-started embedded server
      if (this.embedded) {
        await this.embedded.shutdown().catch(() => {});
        this.embedded = null;
      }
      throw err;
    }
  }

  /**
   * Re-evaluate every persisted selection against the live server.
   * Does not mutate fingerprints: structure changes stay pending until the
   * user explicitly confirms them.
   */
  async reconcileSelections() {
    const snapshot = this.config.snapshot();
    const results = [];
    for (const selection of snapshot.selections) {
      const result = { selectionId: selection.id, state: 'ok', detail: null };
      // 1) namespace / node existence
      const verification = await this.opc.verifyNode(selection.stableId);
      if (verification.mismatch) {
        result.state = 'mismatch';
        result.detail = verification.mismatch;
        results.push(result);
        continue;
      }
      // 2) structure change
      if (selection.fingerprint) {
        const inspection = await this.opc.inspectStructure(selection.stableId, selection.fingerprint);
        if (inspection.mismatch) {
          result.state = 'mismatch';
          result.detail = inspection.mismatch;
        } else if (inspection.changed) {
          result.state = 'structure-changed';
          result.detail = {
            stored: selection.fingerprint,
            current: inspection.fingerprint,
          };
        }
      }
      results.push(result);
    }
    return {
      status: this.status,
      endpointUrl: this.endpointUrl,
      namespaceUris: this.opc?.namespaceUris ?? [],
      embedded: this.isEmbedded(),
      variant: this.embedded?.variant ?? null,
      reconciliation: results,
    };
  }

  /** User accepted the new structure definition for one selection. */
  async confirmStructure(selectionId) {
    const snapshot = this.config.snapshot();
    const selection = snapshot.selections.find((s) => s.id === selectionId);
    if (!selection) throw new Error(`Unknown selection ${selectionId}`);
    const inspection = await this.opc.inspectStructure(selection.stableId, selection.fingerprint);
    if (inspection.mismatch) throw new Error(inspection.mismatch.reason);
    // Old samples keep their old fingerprint; the selection now points at the
    // new definition and subsequent samples are interpreted under it.
    this.config.updateSelection(selectionId, {
      fingerprint: inspection.fingerprint,
      structureConfirmedAt: new Date().toISOString(),
      previousFingerprint: selection.fingerprint,
    });
    return inspection.fingerprint;
  }

  /** Remove a selection that cannot be matched on the current server. */
  forgetSelection(selectionId) {
    this.config.removeSelection(selectionId);
  }

  async disconnect() {
    if (this.opc) {
      await this.opc.disconnect().catch(() => {});
      this.opc = null;
    }
    if (this.embedded) {
      await this.embedded.shutdown().catch(() => {});
      this.embedded = null;
    }
    this.status = 'disconnected';
    this.endpointUrl = null;
  }

  connectionInfo() {
    return {
      status: this.status,
      endpointUrl: this.endpointUrl,
      lastError: this.lastError,
      embedded: this.isEmbedded(),
      variant: this.embedded?.variant ?? null,
      namespaceUris: this.opc?.namespaceUris ?? [],
    };
  }

  requireSession() {
    if (!this.opc || this.status !== 'connected') {
      throw Object.assign(new Error('Not connected to an OPC UA server'), { code: 'not-connected' });
    }
    return this.opc;
  }
}

export { sameFingerprint, DEFAULT_PORT };
