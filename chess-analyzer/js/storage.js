// IndexedDB para preferências e partidas salvas.
// Se o IndexedDB não estiver disponível (ex.: algumas janelas privadas), cai para
// memória e avisa a interface por `storage.persistent === false`.

const DB_NAME = 'chess-analyzer';
const DB_VERSION = 1;

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

class MemoryBackend {
  constructor() {
    this.settings = new Map();
    this.games = new Map();
    this.seq = 0;
  }
  async getSetting(k) { return this.settings.get(k); }
  async setSetting(k, v) { this.settings.set(k, v); }
  async listGames() { return [...this.games.values()].sort((a, b) => b.updatedAt - a.updatedAt); }
  async saveGame(g) {
    const id = g.id ?? ++this.seq;
    const rec = { ...g, id, updatedAt: Date.now() };
    this.games.set(id, rec);
    return id;
  }
  async deleteGame(id) { this.games.delete(id); }
}

class IdbBackend {
  constructor(db) { this.db = db; }
  _store(name, mode = 'readonly') { return this.db.transaction(name, mode).objectStore(name); }
  async getSetting(k) { return (await req(this._store('settings').get(k)))?.value; }
  async setSetting(k, value) { await req(this._store('settings', 'readwrite').put({ key: k, value })); }
  async listGames() {
    const all = await req(this._store('games').getAll());
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async saveGame(g) {
    const rec = { ...g, updatedAt: Date.now() };
    if (rec.id == null) delete rec.id;
    return req(this._store('games', 'readwrite').put(rec));
  }
  async deleteGame(id) { await req(this._store('games', 'readwrite').delete(id)); }
}

export async function openStorage() {
  try {
    if (!('indexedDB' in self)) throw new Error('sem IndexedDB');
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('games')) db.createObjectStore('games', { keyPath: 'id', autoIncrement: true });
    };
    const db = await Promise.race([
      req(open),
      new Promise((_, rej) => setTimeout(() => rej(new Error('IndexedDB não respondeu')), 4000)),
    ]);
    const backend = new IdbBackend(db);
    backend.persistent = true;
    return backend;
  } catch (e) {
    const mem = new MemoryBackend();
    mem.persistent = false;
    mem.reason = e.message;
    return mem;
  }
}

/** Pede ao navegador para não apagar os dados (no iOS pode ser recusado). */
export async function requestPersistence() {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
