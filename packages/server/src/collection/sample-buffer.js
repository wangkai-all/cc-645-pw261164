// In-memory sample buffers, one per selection.
//
// Every sample is tagged with the structure signature it was collected under.
// When a selection's structure changes and the user confirms the new
// definition, new samples simply carry the new signature: historical samples
// keep theirs and therefore keep their original interpretation forever.
export class SampleBuffer {
 constructor(maxSize = 500) {
    this.maxSize = maxSize;
    this.buffers = new Map(); // selectionId -> { samples, unsub }
  }

  ensure(selectionId) {
    if (!this.buffers.has(selectionId)) {
      this.buffers.set(selectionId, { samples: [] });
    }
    return this.buffers.get(selectionId);
  }

  push(selectionId, sample, structureSignature) {
    const buffer = this.ensure(selectionId);
    const record = {
      sequence: buffer.samples.length + 1,
      receivedAt: new Date().toISOString(),
      structureSignature,
      ...sample,
    };
    buffer.samples.push(record);
    if (buffer.samples.length > this.maxSize) {
      buffer.samples.splice(0, buffer.samples.length - this.maxSize);
    }
    return record;
  }

  list(selectionId, limit) {
    const buffer = this.buffers.get(selectionId);
    if (!buffer) return [];
    const samples = buffer.samples;
    return limit ? samples.slice(Math.max(0, samples.length - limit)) : [...samples];
  }

  clear(selectionId) {
    const buffer = this.buffers.get(selectionId);
    if (buffer) buffer.samples = [];
  }

  clearAll() {
    this.buffers.clear();
  }

  stats() {
    const out = {};
    for (const [id, buffer] of this.buffers) {
      out[id] = { count: buffer.samples.length, last: buffer.samples.at(-1) ?? null };
    }
    return out;
  }
}
