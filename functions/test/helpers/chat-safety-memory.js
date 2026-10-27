const assert = require('node:assert/strict');
const DELETE = Symbol('delete');
const FieldValue = { serverTimestamp: () => new Date(), increment: value => ({ incrementBy: value }), delete: () => DELETE };
const comparable = value => value instanceof Date ? value.getTime() : value?.toMillis?.() ?? value;
class Ref {
  constructor(db, path) { this.db = db; this.path = path; this.id = path.split('/').at(-1); }
  collection(name) { return new Query(this.db, `${this.path}/${name}`); }
  async get() { const data = this.db.documents.get(this.path); return { ref: this, id: this.id, exists: data !== undefined, data: () => data }; }
  async set(value, options = {}) { this.db.apply('set', this, value, options); }
  async update(value) { this.db.apply('update', this, value); }
  async delete() { this.db.documents.delete(this.path); }
}
class Query {
  constructor(db, path, filters = [], order = [], count = Infinity, anchor = null) { Object.assign(this, { db, path, filters, order, count, anchor }); }
  doc(id) { return new Ref(this.db, `${this.path}/${id}`); }
  where(field, op, value) { assert.ok(['==', 'in'].includes(op)); return new Query(this.db, this.path, [...this.filters, [field, op, value]], this.order, this.count, this.anchor); }
  orderBy(field, direction = 'asc') { return new Query(this.db, this.path, this.filters, [...this.order, [typeof field === 'string' ? field : '__name__', direction]], this.count, this.anchor); }
  limit(count) { return new Query(this.db, this.path, this.filters, this.order, count, this.anchor); }
  startAfter(...anchor) { return new Query(this.db, this.path, this.filters, this.order, this.count, anchor); }
  async get() {
    const prefix = `${this.path}/`;
    const refs = [...this.db.documents.keys()].filter(path => path.startsWith(prefix) && !path.slice(prefix.length).includes('/')).map(path => new Ref(this.db, path));
    const order = this.order.length ? this.order : [['__name__', 'asc']];
    const values = row => order.map(([field]) => field === '__name__' ? row.id : comparable(row.data()[field]));
    const compare = (left, right) => {
      for (let i = 0; i < order.length; i++) { const result = left[i] === right[i] ? 0 : left[i] < right[i] ? -1 : 1; if (result) return order[i][1] === 'desc' ? -result : result; }
      return 0;
    };
    let rows = (await Promise.all(refs.map(ref => ref.get()))).filter(row => this.filters.every(([field, op, value]) => op === 'in' ? value.includes(row.data()[field]) : row.data()[field] === value));
    rows.sort((a, b) => compare(values(a), values(b)));
    if (this.anchor) {
      const cursorValues = this.anchor[0]?.ref ? values(this.anchor[0]) : this.anchor.map(comparable);
      rows = rows.filter(row => compare(values(row), cursorValues) > 0);
    }
    rows = rows.slice(0, this.count);
    return { docs: rows, size: rows.length, empty: !rows.length };
  }
}
class MemoryFirestore {
  constructor(seed) { this.documents = new Map(Object.entries(seed)); }
  collection(name) { return new Query(this, name); }
  apply(type, ref, value, options = {}) {
    if (type === 'delete') { this.documents.delete(ref.path); return; }
    if (type === 'create') assert.equal(this.documents.has(ref.path), false);
    if (type === 'update') assert.ok(this.documents.has(ref.path), `Missing update ${ref.path}`);
    const previous = this.documents.get(ref.path) || {};
    const next = type === 'update' || options.merge ? { ...previous } : {};
    for (const [key, item] of Object.entries(value)) {
      assert.notEqual(item, undefined, `Undefined field ${key}`);
      if (item === DELETE) delete next[key];
      else next[key] = typeof item?.incrementBy === 'number' ? Number(previous[key] || 0) + item.incrementBy : item;
    }
    this.documents.set(ref.path, next);
  }
  batch() {
    const pending = [];
    const batch = { pending, commit: async () => pending.forEach(args => this.apply(...args)) };
    for (const type of ['set', 'create', 'update', 'delete']) batch[type] = (...args) => pending.push([type, ...args]);
    return batch;
  }
  async runTransaction(fn) {
    const batch = this.batch();
    const get = async ref => { assert.equal(batch.pending.length, 0, 'Read after write'); return ref.get(); };
    const result = await fn({ ...batch, get, getAll: async (...refs) => Promise.all(refs.map(get)) });
    await batch.commit(); return result;
  }
  async recursiveDelete(ref) { for (const path of this.documents.keys()) if (path === ref.path || path.startsWith(`${ref.path}/`)) this.documents.delete(path); }
}
class MemoryBucket {
  constructor(files = {}) { this.name = 'demo.firebasestorage.app'; this.files = new Map(Object.entries(files)); this.failDeletes = 0; this.publicMissingStatus = 403; this.forcePublicStatus = null; this.requests = []; }
  file(name) {
    return { name, getMetadata: async () => { if (!this.files.has(name)) throw { code: 404 }; return [this.files.get(name)]; },
      setMetadata: async value => { const file = this.files.get(name); if (!file) throw { code: 404 }; if (value.metadata.firebaseStorageDownloadTokens === null) delete file.metadata.firebaseStorageDownloadTokens; },
      delete: async () => { if (this.failDeletes > 0) { this.failDeletes--; throw Error('injected delete failure'); } this.files.delete(name); } };
  }
  async getFiles({ prefix }) { return [[...this.files.keys()].filter(name => name.startsWith(prefix)).map(name => this.file(name))]; }
  fetch = async url => { this.requests.push(url); const path = decodeURIComponent(new URL(url).pathname.split('/o/')[1]); return { status: this.forcePublicStatus ?? (this.files.has(path) ? 200 : this.publicMissingStatus) }; };
}
module.exports = { MemoryFirestore, MemoryBucket, FieldValue };
