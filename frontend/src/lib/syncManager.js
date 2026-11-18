// Port ES module de legacy/js/sync.js — file FIFO des opérations offline et
// leur replay serveur. Même logique métier ; les seules différences sont
// d'intégration : pas de manipulation DOM directe (#sync-badge,
// #offline-indicator) — on notifie des abonnés à la place, branchés par les
// composants React (voir components/PwaBootstrap.jsx).
import { idb } from './idb';
import { sessionCourante } from './api';

const unwrapSyncResponse = (body) => (body && typeof body.success === 'boolean')
  ? (body.data ?? (body.success ? {} : { error: body.message }))
  : body;

let isSyncing = false;
let toastFn = null; // branché par PwaBootstrap via setToast()

const badgeListeners = new Set();
const offlineListeners = new Set();

const notifyBadge = (count) => badgeListeners.forEach((cb) => cb(count));
const notifyOffline = (isOnline) => offlineListeners.forEach((cb) => cb(isOnline));

const showSyncToast = (msg, type = '') => {
  if (typeof toastFn === 'function') toastFn(msg, type);
  else console.log('[Sync]', msg);
};

// ── Ajouter une opération à la file ──────────────────────────────────────
const enqueue = async (operation) => {
  const item = {
    method: operation.method,
    url: operation.url,
    body: operation.body || null,
    headers: operation.headers || {},
    user_id: operation.user_id || null,   // 067 : rejouée seulement pour ce compte
    statut: 'pending',
    tentatives: 0,
    local_id: operation.local_id || null,
    created_at: new Date().toISOString(),
  };
  const id = await idb.add('sync_queue', item);
  console.log(`[Sync] Opération mise en file (id=${id}) : ${item.method} ${item.url}`);
  await updateBadge();
  return id;
};

// ── Rejouer toute la file quand le réseau revient ────────────────────────
const replayAll = async () => {
  if (isSyncing) return;
  isSyncing = true;

  // 067 (lot D) : on rejoue avec la session EN COURS (jeton actuel), et
  // uniquement les saisies du compte connecté. Personne connecté : on attend.
  const courante = sessionCourante();
  if (!courante.token) { isSyncing = false; return; }
  const pending = (await idb.getAllByIndex('sync_queue', 'statut', 'pending'))
    .filter((op) => !op.user_id || !courante.userId || op.user_id === courante.userId);
  if (pending.length === 0) { isSyncing = false; return; }

  console.log(`[Sync] ${pending.length} opération(s) à synchroniser…`);
  showSyncToast(`Synchronisation de ${pending.length} opération(s)…`);

  let success = 0;
  let errors = 0;
  const blocked = [];

  for (const op of pending) {
    try {
      const res = await fetch(op.url, {
        method: op.method,
        headers: { 'Content-Type': 'application/json', ...op.headers, Authorization: `Bearer ${courante.token}` },
        body: op.body ? JSON.stringify(op.body) : undefined,
      });

      if (res.ok) {
        const data = await res.json().then(unwrapSyncResponse).catch(() => ({}));

        if (data && (data.en_attente || data.refus_modification)) {
          if (op.local_id) {
            try { await idb.delete('journal_cache', op.local_id); } catch (_) { /* déjà absent */ }
          }
          await idb.put('sync_queue', {
            ...op,
            statut: data.en_attente ? 'en_attente' : 'refuse',
            server_msg: data.message || '',
            synced_at: new Date().toISOString(),
          });
          blocked.push(data.message || (data.en_attente
            ? 'Sortie mise en attente de validation du directeur.'
            : 'Modification refusée (dépassement).'));
        } else {
          if (op.local_id && data.id) {
            await updateLocalId(op.local_id, data.id);
          }
          await idb.put('sync_queue', { ...op, statut: 'done', synced_at: new Date().toISOString() });
          success++;
        }
      } else if (res.status === 401) {
        // Session terminée (remplacée, expirée…) : la saisie n'est PAS perdue.
        // Elle reste en file et repartira après la reconnexion du même compte.
        await idb.put('sync_queue', { ...op, tentatives: op.tentatives + 1, last_error: 'Session terminée : reconnectez-vous pour envoyer cette saisie' });
        errors++;
        break;
      } else if (res.status >= 500) {
        await idb.put('sync_queue', { ...op, tentatives: op.tentatives + 1, last_error: `HTTP ${res.status}` });
        errors++;
      } else if (res.status === 403 && (await res.clone().json().then(unwrapSyncResponse).catch(() => ({}))).code === 'MODULE_INACTIF') {
        // NJ BUSINESS (048) : module désactivé pour l'espace. La saisie n'est
        // NI supprimée NI marquée en erreur : elle reste en file et repartira
        // après réactivation. Inutile d'envoyer les suivantes.
        await idb.put('sync_queue', { ...op, tentatives: op.tentatives + 1, last_error: 'Module désactivé pour votre espace' });
        errors++;
        break;
      } else {
        const errData = await res.json().then(unwrapSyncResponse).catch(() => ({}));
        await idb.put('sync_queue', {
          ...op,
          statut: 'error',
          tentatives: op.tentatives + 1,
          error_msg: errData.error || `HTTP ${res.status}`,
        });
        errors++;
      }
    } catch (netErr) {
      await idb.put('sync_queue', { ...op, tentatives: op.tentatives + 1, last_error: netErr.message });
      errors++;
      console.warn(`[Sync] Erreur réseau pour ${op.method} ${op.url} :`, netErr.message);
      break;
    }
  }

  isSyncing = false;
  await updateBadge();

  const parts = [];
  if (success > 0) parts.push(`✅ ${success} synchronisée(s)`);
  if (blocked.length > 0) parts.push(`⏳ ${blocked.length} en attente/refusée(s) du directeur`);
  if (errors > 0) parts.push(`⚠️ ${errors} erreur(s)`);
  if (parts.length) {
    showSyncToast(parts.join(' · '), (errors > 0 || blocked.length > 0) ? 'warning' : 'success');
  }
  blocked.forEach((msg, i) => setTimeout(() => showSyncToast(`⚠ ${msg}`, 'warning'), (i + 1) * 400));
};

const updateLocalId = async (localId, serverId) => {
  const cached = await idb.get('journal_cache', localId);
  if (cached) {
    await idb.delete('journal_cache', localId);
    await idb.put('journal_cache', { ...cached, local_id: serverId, server_id: serverId, synced: true });
  }
};

const countPending = () => idb.count('sync_queue', 'statut', 'pending');
const getAll = () => idb.getAll('sync_queue');

const clearDone = async () => {
  const all = await idb.getAll('sync_queue');
  for (const op of all) {
    if (op.statut === 'done') await idb.delete('sync_queue', op.id);
  }
  await updateBadge();
};

const updateBadge = async () => {
  const count = await countPending();
  notifyBadge(count);
};

// ── Cache des rubriques pour saisie offline ──────────────────────────────
const cacheRubriques = async (rubriques) => {
  await idb.clear('rubriques_cache');
  const all = [...(rubriques.entrees || []), ...(rubriques.depenses || [])];
  for (const r of all) await idb.put('rubriques_cache', r);
  await idb.put('meta', { key: 'rubriques_cached_at', value: new Date().toISOString() });
};

const getCachedRubriques = async () => {
  const all = await idb.getAll('rubriques_cache');
  return {
    entrees: all.filter((r) => r.type === 'entree'),
    depenses: all.filter((r) => r.type === 'depense'),
  };
};

// ── Cache du journal offline ─────────────────────────────────────────────
const cacheJournalEntry = async (entry) => {
  const localId = entry.id || `local_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  await idb.put('journal_cache', { ...entry, local_id: localId, synced: false, created_offline: true });
  return localId;
};

const getCachedJournal = (mois, annee, typeCaisse) => idb.getAllByIndex('journal_cache', 'mois_annee_caisse', [mois, annee, typeCaisse]);

// ── Contexte de contrôle budgétaire (pré-contrôle hors-ligne) ────────────
const ctxKey = (jid, mois, annee) => `ctx_${jid || 'null'}_${mois}_${annee}`;

const cacheControleContext = async (ctx) => {
  if (!ctx || ctx.error) return;
  await idb.put('meta', { key: ctxKey(ctx.journal_id, ctx.mois, ctx.annee), value: ctx });
};

const getCachedControleContext = async (jid, mois, annee) => {
  const m = await idb.get('meta', ctxKey(jid, mois, annee));
  return m ? m.value : null;
};

const sommeSortiesOffline = async (jid, mois, annee, rubriqueCode, jusqua = null) => {
  let sj = 0, sr = 0;
  try {
    const all = await idb.getAll('journal_cache');
    for (const e of all) {
      if (e.synced || !e.created_offline) continue;
      if (e.mois !== mois || String(e.annee) !== String(annee)) continue;
      if (jusqua && e.date && String(e.date).slice(0, 10) > jusqua) continue;
      const sortie = parseFloat(e.sortie) || 0;
      if (sortie <= 0) continue;
      if ((e.journal_id || null) == (jid || null)) sj += sortie;
      if (e.rubrique_code === rubriqueCode) sr += sortie;
    }
  } catch (_) { /* IndexedDB indisponible — pré-contrôle simplement ignoré */ }
  return { sj, sr };
};

// Pré-contrôle budgétaire local (miroir de controleBudgetSortie côté serveur).
const controleBudgetLocal = async (body) => {
  const montant = parseFloat(body.sortie) || 0;
  if (montant <= 0) return { bloque: false, connu: true };

  const jid = body.journal_id || null;
  const ctx = await getCachedControleContext(jid, body.mois, body.annee);
  if (!ctx) return { bloque: false, connu: false };

  const fmtN = (n) => (parseFloat(n) || 0).toLocaleString('fr-FR');

  // Budget hebdomadaire (040) : semaine k tirée de la date du mouvement,
  // contrôle sur le cumul des semaines 1..k (report du non-dépensé).
  if (ctx.hebdo && Array.isArray(ctx.hebdo.semaines) && body.date) {
    const d = String(body.date).slice(0, 10);
    const sem = ctx.hebdo.semaines.find((x) => d >= x.debut && d <= x.fin);
    if (sem) {
      const offH = await sommeSortiesOffline(jid, body.mois, body.annee, body.rubrique_code, sem.fin);
      if (!sem.valide) {
        return { bloque: true, connu: true, motif: 'semaine_non_validee',
          message: `la semaine ${sem.num} n'est pas encore validée par le directeur.` };
      }
      const appr = parseFloat(sem.approuve_cumul?.[body.rubrique_code]) || 0;
      const srH = (parseFloat(sem.sorties_cumul?.[body.rubrique_code]) || 0) + offH.sr + montant;
      if (appr <= 0) {
        return { bloque: true, connu: true, motif: 'rubrique_non_approuvee',
          message: `la rubrique "${body.rubrique_code}" n'a pas de budget validé jusqu'à la semaine ${sem.num}.` };
      }
      if (srH > appr) {
        return { bloque: true, connu: true, motif: 'depassement_rubrique',
          message: `la rubrique "${body.rubrique_code}" dépasserait de ${fmtN(srH - appr)} FCFA le budget cumulé des semaines 1 à ${sem.num}.` };
      }
      const plafH = parseFloat(sem.plafond_cumul) || 0;
      if (plafH > 0) {
        const apresH = (parseFloat(sem.sorties_journal_cumul) || 0) + offH.sj + montant;
        if (apresH > plafH) {
          return { bloque: true, connu: true, motif: 'depassement_journal',
            message: `le plafond de caisse cumulé (semaines 1 à ${sem.num}) serait dépassé de ${fmtN(apresH - plafH)} FCFA.` };
        }
      }
      return { bloque: false, connu: true };
    }
  }

  const off = await sommeSortiesOffline(jid, body.mois, body.annee, body.rubrique_code);

  const approuve = parseFloat(ctx.approuve_by_rubrique?.[body.rubrique_code]) || 0;
  const sr = (parseFloat(ctx.sorties_by_rubrique?.[body.rubrique_code]) || 0) + off.sr + montant;

  if (approuve <= 0) {
    return { bloque: true, connu: true, motif: 'rubrique_non_approuvee',
      message: `la rubrique "${body.rubrique_code}" n'a pas de budget approuvé dans la demande de fonds.` };
  }
  if (sr > approuve) {
    return { bloque: true, connu: true, motif: 'depassement_rubrique',
      message: `la rubrique "${body.rubrique_code}" dépasserait le budget approuvé de ${fmtN(sr - approuve)} FCFA.` };
  }
  const plafond = parseFloat(ctx.plafond) || 0;
  if (plafond > 0) {
    const apres = (parseFloat(ctx.sorties_journal) || 0) + off.sj + montant;
    if (apres > plafond) {
      return { bloque: true, connu: true, motif: 'depassement_journal',
        message: `le plafond de caisse serait dépassé de ${fmtN(apres - plafond)} FCFA.` };
    }
  }
  return { bloque: false, connu: true };
};

// ── Abonnements (remplace la manipulation DOM directe du legacy) ────────
const onBadgeChange = (cb) => { badgeListeners.add(cb); return () => badgeListeners.delete(cb); };
const onOfflineChange = (cb) => { offlineListeners.add(cb); return () => offlineListeners.delete(cb); };
const setToast = (fn) => { toastFn = fn; };

let initialized = false;
const init = () => {
  if (initialized) return;
  initialized = true;

  window.addEventListener('online', () => {
    notifyOffline(true);
    console.log('[Sync] Retour en ligne → replay queue');
    setTimeout(replayAll, 1500);
  });

  // 067 : après une (re)connexion, les saisies restées en file repartent.
  window.addEventListener('session-ouverte', () => { if (navigator.onLine) setTimeout(replayAll, 1500); });

  window.addEventListener('offline', () => {
    notifyOffline(false);
    console.log('[Sync] Hors ligne → mode offline activé');
  });

  notifyOffline(navigator.onLine);
  updateBadge();
};

export const syncManager = {
  enqueue, replayAll, countPending, getAll, clearDone, updateBadge,
  cacheRubriques, getCachedRubriques,
  cacheJournalEntry, getCachedJournal,
  cacheControleContext, getCachedControleContext,
  controleBudgetLocal,
  onBadgeChange, onOfflineChange, setToast,
  init,
};
