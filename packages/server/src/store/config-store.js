// File-backed configuration store.
//
// Persisted: endpoint, selections (with stable identities + browse paths +
// structure fingerprints), collection settings and UI options. Samples are
// live data and stay in memory; the configuration survives restarts.
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

const DEFAULTS = {
  version: 1,
  endpointUrl: null,
  embeddedDemo: true,
  demoVariant: 'V1',
  selections: [],     // { id, label, stableId, path: [...], fingerprint, createdAt }
  collections: [],    // { id, selectionId, samplingInterval, enabled }
  options: { sampleBufferSize: 500 },
};

export class ConfigStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = this.#load();
    this.listeners = new Set();
  }

  #load() {
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        ...structuredClone(DEFAULTS),
        ...parsed,
        options: { ...DEFAULTS.options, ...(parsed.options ?? {}) },
      };
    } catch (err) {
      if (err.code === 'ENOENT') return structuredClone(DEFAULTS);
      throw new Error(`Cannot read config ${this.filePath}: ${err.message}`);
    }
  }

  save() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.filePath);
    for (const listener of this.listeners) {
      try { listener(this.snapshot()); } catch { /* listener errors must not break saves */ }
    }
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot() {
    return structuredClone(this.data);
  }

  patch(partial) {
    Object.assign(this.data, partial);
    this.save();
    return this.snapshot();
  }

  // ---- selections -----------------------------------------------------------
  addSelection(entry) {
    const record = {
      id: entry.id ?? `sel_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      label: entry.label,
      stableId: entry.stableId,
      path: entry.path ?? [],
      fingerprint: entry.fingerprint ?? null,
      createdAt: new Date().toISOString(),
    };
    // De-duplicate by stable identity: selecting the same node again updates
    // label/path rather than creating a second entry.
    const existing = this.data.selections.findIndex(
      (s) => JSON.stringify(s.stableId) === JSON.stringify(record.stableId),
    );
    if (existing >= 0) {
      this.data.selections[existing] = { ...this.data.selections[existing], ...record, id: this.data.selections[existing].id };
    } else {
      this.data.selections.push(record);
    }
    this.save();
    return this.data.selections[existing >= 0 ? existing : this.data.selections.length - 1];
  }

  updateSelection(id, partial) {
    const idx = this.data.selections.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error(`Unknown selection ${id}`);
    this.data.selections[idx] = { ...this.data.selections[idx], ...partial };
    this.save();
    return this.data.selections[idx];
  }

  removeSelection(id) {
    this.data.selections = this.data.selections.filter((s) => s.id !== id);
    this.data.collections = this.data.collections.filter((c) => c.selectionId !== id);
    this.save();
  }

  // ---- collections ----------------------------------------------------------
  upsertCollection(entry) {
    const idx = this.data.collections.findIndex((c) => c.selectionId === entry.selectionId);
    if (idx >= 0) {
      this.data.collections[idx] = { ...this.data.collections[idx], ...entry };
    } else {
      this.data.collections.push({
        id: entry.id ?? `col_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        enabled: true,
        samplingInterval: 500,
        ...entry,
      });
    }
    this.save();
    return idx >= 0 ? this.data.collections[idx] : this.data.collections[this.data.collections.length - 1];
  }

  removeCollection(id) {
    this.data.collections = this.data.collections.filter((c) => c.id !== id);
    this.save();
  }
}
