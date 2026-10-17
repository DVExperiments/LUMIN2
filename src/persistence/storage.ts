/**
 * Key-value persistence with graceful degradation:
 *   IndexedDB  →  localStorage  →  in-memory (session only, reported to the UI).
 */

export interface KeyValueStore {
  readonly kind: 'indexeddb' | 'localstorage' | 'memory';
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

export class MemoryStore implements KeyValueStore {
  readonly kind = 'memory' as const;
  private map = new Map<string, string>();
  async get<T>(key: string): Promise<T | undefined> {
    const v = this.map.get(key);
    return v === undefined ? undefined : (JSON.parse(v) as T);
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.map.set(key, JSON.stringify(value));
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}

class LocalStore implements KeyValueStore {
  readonly kind = 'localstorage' as const;
  constructor(private prefix = 'lumin:') {}
  async get<T>(key: string): Promise<T | undefined> {
    const v = localStorage.getItem(this.prefix + key);
    return v === null ? undefined : (JSON.parse(v) as T);
  }
  async set<T>(key: string, value: T): Promise<void> {
    localStorage.setItem(this.prefix + key, JSON.stringify(value));
  }
  async delete(key: string): Promise<void> {
    localStorage.removeItem(this.prefix + key);
  }
}

class IdbStore implements KeyValueStore {
  readonly kind = 'indexeddb' as const;
  constructor(private db: IDBDatabase) {}
  private tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const t = this.db.transaction('kv', mode);
      const req = fn(t.objectStore('kv'));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      t.onabort = () => reject(t.error ?? new Error('Transaction aborted'));
    });
  }
  async get<T>(key: string): Promise<T | undefined> {
    return (await this.tx('readonly', (s) => s.get(key))) as T | undefined;
  }
  async set<T>(key: string, value: T): Promise<void> {
    await this.tx('readwrite', (s) => s.put(value, key));
  }
  async delete(key: string): Promise<void> {
    await this.tx('readwrite', (s) => s.delete(key));
  }
}

function openIdb(name = 'lumin', version = 1): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

export async function openBestStore(): Promise<KeyValueStore> {
  try {
    if (typeof indexedDB !== 'undefined') {
      const db = await Promise.race([
        openIdb(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('IndexedDB timeout')), 3000)),
      ]);
      const store = new IdbStore(db);
      await store.set('__probe', 1);
      return store;
    }
  } catch {
    /* fall through */
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('lumin:__probe', '1');
      localStorage.removeItem('lumin:__probe');
      return new LocalStore();
    }
  } catch {
    /* fall through */
  }
  return new MemoryStore();
}
