// Port ES module de legacy/js/idb.js — wrapper IndexedDB pour le stockage
// offline PWA (mêmes stores, mêmes clés, même schéma). Remplace SQLite local.
const IDB_NAME = 'caissepro_offline';
const IDB_VERSION = 1;

const openDB = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(IDB_NAME, IDB_VERSION);

  req.onupgradeneeded = (e) => {
    const db = e.target.result;

    if (!db.objectStoreNames.contains('sync_queue')) {
      const sq = db.createObjectStore('sync_queue', { keyPath: 'id', autoIncrement: true });
      sq.createIndex('statut', 'statut', { unique: false });
      sq.createIndex('created_at', 'created_at', { unique: false });
    }

    if (!db.objectStoreNames.contains('journal_cache')) {
      const jc = db.createObjectStore('journal_cache', { keyPath: 'local_id' });
      jc.createIndex('mois_annee_caisse', ['mois', 'annee', 'type_caisse'], { unique: false });
      jc.createIndex('synced', 'synced', { unique: false });
    }

    if (!db.objectStoreNames.contains('rubriques_cache')) {
      db.createObjectStore('rubriques_cache', { keyPath: 'id' });
    }

    if (!db.objectStoreNames.contains('meta')) {
      db.createObjectStore('meta', { keyPath: 'key' });
    }
  };

  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export const idb = {
  add: async (storeName, data) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).add(data);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  put: async (storeName, data) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).put(data);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  get: async (storeName, key) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  getAll: async (storeName) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  getAllByIndex: async (storeName, indexName, value) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const req = index.getAll(value);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  delete: async (storeName, key) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },

  clear: async (storeName) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },

  count: async (storeName, indexName, value) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = indexName ? store.index(indexName).count(value) : store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
};
