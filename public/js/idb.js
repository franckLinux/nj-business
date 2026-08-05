// =====================================================================
// CaissePro v2 — IndexedDB Wrapper (PWA Offline Storage)
// Remplace SQLite local — plus léger, natif navigateur
// =====================================================================

const IDB_NAME    = 'caissepro_offline';
const IDB_VERSION = 1;

// Ouverture de la base IndexedDB
const openDB = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(IDB_NAME, IDB_VERSION);

  req.onupgradeneeded = (e) => {
    const db = e.target.result;

    // ── sync_queue : opérations en attente de sync ────────────────────
    if (!db.objectStoreNames.contains('sync_queue')) {
      const sq = db.createObjectStore('sync_queue', {
        keyPath: 'id', autoIncrement: true
      });
      sq.createIndex('statut',     'statut',     { unique: false });
      sq.createIndex('created_at', 'created_at', { unique: false });
    }

    // ── journal_cache : mouvements lus/créés offline ──────────────────
    if (!db.objectStoreNames.contains('journal_cache')) {
      const jc = db.createObjectStore('journal_cache', { keyPath: 'local_id' });
      jc.createIndex('mois_annee_caisse', ['mois','annee','type_caisse'], { unique: false });
      jc.createIndex('synced',            'synced',                       { unique: false });
    }

    // ── rubriques_cache : rubriques du tenant ─────────────────────────
    if (!db.objectStoreNames.contains('rubriques_cache')) {
      db.createObjectStore('rubriques_cache', { keyPath: 'id' });
    }

    // ── meta : infos tenant, dernière sync ───────────────────────────
    if (!db.objectStoreNames.contains('meta')) {
      db.createObjectStore('meta', { keyPath: 'key' });
    }
  };

  req.onsuccess = () => resolve(req.result);
  req.onerror   = () => reject(req.error);
});

// ── CRUD générique ────────────────────────────────────────────────────
const idb = {
  // Ajouter un enregistrement
  add: async (storeName, data) => {
    const db  = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).add(data);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  },

  // Mettre à jour
  put: async (storeName, data) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).put(data);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  },

  // Lire par clé
  get: async (storeName, key) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  },

  // Lire tous
  getAll: async (storeName) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = () => reject(req.error);
    });
  },

  // Lire par index
  getAllByIndex: async (storeName, indexName, value) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const req   = index.getAll(value);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = () => reject(req.error);
    });
  },

  // Supprimer par clé
  delete: async (storeName, key) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).delete(key);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  },

  // Vider un store
  clear: async (storeName) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).clear();
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  },

  // Compter les enregistrements
  count: async (storeName, indexName, value) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req   = indexName
        ? store.index(indexName).count(value)
        : store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  },
};
