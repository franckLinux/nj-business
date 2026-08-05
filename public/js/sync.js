// =====================================================================
// CaissePro v2 — Sync Queue Manager (PWA Offline → Online Sync)
// Gère la file FIFO des opérations offline et leur replay serveur
// =====================================================================

'use strict';

const SyncManager = (() => {
  let isSyncing  = false;
  let syncBadge  = null; // référence à l'élément UI du badge

  // ── Ajouter une opération à la file ──────────────────────────────────
  const enqueue = async (operation) => {
    const item = {
      method:     operation.method,    // POST | PUT | DELETE | PATCH
      url:        operation.url,       // ex: /api/journal
      body:       operation.body || null,
      headers:    operation.headers || {},
      statut:     'pending',
      tentatives: 0,
      local_id:   operation.local_id || null, // id local si créé offline
      created_at: new Date().toISOString(),
    };
    const id = await idb.add('sync_queue', item);
    console.log(`[Sync] Opération mise en file (id=${id}) : ${item.method} ${item.url}`);
    await updateBadge();
    return id;
  };

  // ── Rejouer toute la file quand le réseau revient ─────────────────────
  const replayAll = async () => {
    if (isSyncing) return;
    isSyncing = true;

    const pending = await idb.getAllByIndex('sync_queue', 'statut', 'pending');
    if (pending.length === 0) { isSyncing = false; return; }

    console.log(`[Sync] ${pending.length} opération(s) à synchroniser…`);
    showSyncToast(`Synchronisation de ${pending.length} opération(s)…`);

    let success = 0;
    let errors  = 0;
    const blocked = []; // sorties revenues "en attente" ou "refusées" par le serveur

    for (const op of pending) {
      try {
        const res = await fetch(op.url, {
          method:  op.method,
          headers: { 'Content-Type': 'application/json', ...op.headers },
          body:    op.body ? JSON.stringify(op.body) : undefined,
        });

        if (res.ok) {
          const data = await res.json().catch(() => ({}));

          // ── Le serveur a répondu 200 mais la sortie n'est PAS écrite ──────
          // (RG-03/RG-06/RG-04 → mise en attente directeur, ou modif refusée)
          if (data && (data.en_attente || data.refus_modification)) {
            // Retirer l'écriture optimiste locale (pas un vrai mouvement de journal)
            if (op.local_id) {
              try { await idb.delete('journal_cache', op.local_id); } catch (_) {}
            }
            await idb.put('sync_queue', {
              ...op,
              statut:     data.en_attente ? 'en_attente' : 'refuse',
              server_msg: data.message || '',
              synced_at:  new Date().toISOString(),
            });
            blocked.push(data.message || (data.en_attente
              ? 'Sortie mise en attente de validation du directeur.'
              : 'Modification refusée (dépassement).'));
          } else {
            // Vraie écriture acceptée
            if (op.local_id && data.id) {
              await updateLocalId(op.local_id, data.id);
            }
            await idb.put('sync_queue', { ...op, statut: 'done', synced_at: new Date().toISOString() });
            success++;
          }
        } else if (res.status >= 500) {
          // 5xx (ex. 503 fail-closed transitoire) → réessayable, on garde 'pending'
          await idb.put('sync_queue', {
            ...op,
            tentatives: op.tentatives + 1,
            last_error: `HTTP ${res.status}`,
          });
          errors++;
        } else {
          // 4xx → erreur définitive
          const errData = await res.json().catch(() => ({}));
          await idb.put('sync_queue', {
            ...op,
            statut:     'error',
            tentatives: op.tentatives + 1,
            error_msg:  errData.error || `HTTP ${res.status}`,
          });
          errors++;
        }
      } catch (netErr) {
        // Erreur réseau → incrémenter tentatives, réessayer plus tard
        await idb.put('sync_queue', {
          ...op,
          tentatives: op.tentatives + 1,
          last_error: netErr.message,
        });
        errors++;
        console.warn(`[Sync] Erreur réseau pour ${op.method} ${op.url} :`, netErr.message);
        break; // Arrêter si pas de réseau
      }
    }

    isSyncing = false;
    await updateBadge();

    const parts = [];
    if (success > 0)        parts.push(`✅ ${success} synchronisée(s)`);
    if (blocked.length > 0) parts.push(`⏳ ${blocked.length} en attente/refusée(s) du directeur`);
    if (errors > 0)         parts.push(`⚠️ ${errors} erreur(s)`);
    if (parts.length) {
      showSyncToast(parts.join(' · '), (errors > 0 || blocked.length > 0) ? 'warning' : 'success');
    }
    // Détail des sorties bloquées, pour que la caissière soit informée
    blocked.forEach((msg, i) => setTimeout(() => showSyncToast(`⚠ ${msg}`, 'warning'), (i + 1) * 400));

    if ((success > 0 || blocked.length > 0)
        && typeof showPage === 'function' && typeof state !== 'undefined') {
      await showPage(state.currentPage);
    }
  };

  // ── Mise à jour id local → id serveur dans journal_cache ─────────────
  const updateLocalId = async (localId, serverId) => {
    const cached = await idb.get('journal_cache', localId);
    if (cached) {
      await idb.delete('journal_cache', localId);
      await idb.put('journal_cache', { ...cached, local_id: serverId, server_id: serverId, synced: true });
    }
  };

  // ── Compter les opérations en attente ────────────────────────────────
  const countPending = async () => {
    return await idb.count('sync_queue', 'statut', 'pending');
  };

  // ── Obtenir toutes les opérations (pour la page de suivi) ─────────────
  const getAll = async () => {
    return await idb.getAll('sync_queue');
  };

  // ── Vider les opérations terminées ────────────────────────────────────
  const clearDone = async () => {
    const all = await idb.getAll('sync_queue');
    for (const op of all) {
      if (op.statut === 'done') await idb.delete('sync_queue', op.id);
    }
    await updateBadge();
  };

  // ── Mettre à jour le badge visuel ─────────────────────────────────────
  const updateBadge = async () => {
    const count = await countPending();
    const badge = document.getElementById('sync-badge');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  };

  // ── Toast de synchronisation ──────────────────────────────────────────
  const showSyncToast = (msg, type = '') => {
    if (typeof toast === 'function') {
      toast(msg, type);
    } else {
      console.log('[Sync]', msg);
    }
  };

  // ── Cache des rubriques pour saisie offline ───────────────────────────
  const cacheRubriques = async (rubriques) => {
    await idb.clear('rubriques_cache');
    const all = [...(rubriques.entrees || []), ...(rubriques.depenses || [])];
    for (const r of all) {
      await idb.put('rubriques_cache', r);
    }
    await idb.put('meta', { key: 'rubriques_cached_at', value: new Date().toISOString() });
  };

  const getCachedRubriques = async () => {
    const all = await idb.getAll('rubriques_cache');
    return {
      entrees:  all.filter(r => r.type === 'entree'),
      depenses: all.filter(r => r.type === 'depense'),
    };
  };

  // ── Cache du journal offline ──────────────────────────────────────────
  const cacheJournalEntry = async (entry) => {
    const localId = entry.id || `local_${Date.now()}_${Math.random().toString(36).substr(2,6)}`;
    await idb.put('journal_cache', {
      ...entry,
      local_id: localId,
      synced:   false,
      created_offline: true,
    });
    return localId;
  };

  const getCachedJournal = async (mois, annee, typeCaisse) => {
    return await idb.getAllByIndex('journal_cache', 'mois_annee_caisse', [mois, annee, typeCaisse]);
  };

  // ── Contexte de contrôle budgétaire (pour pré-contrôle hors-ligne) ────
  // Stocké dans le store générique 'meta' (pas de bump du schéma IndexedDB).
  const ctxKey = (jid, mois, annee) => `ctx_${jid || 'null'}_${mois}_${annee}`;

  const cacheControleContext = async (ctx) => {
    if (!ctx || ctx.error) return;
    await idb.put('meta', { key: ctxKey(ctx.journal_id, ctx.mois, ctx.annee), value: ctx });
  };

  const getCachedControleContext = async (jid, mois, annee) => {
    const m = await idb.get('meta', ctxKey(jid, mois, annee));
    return m ? m.value : null;
  };

  // Somme des sorties saisies offline (non encore synchronisées) pour affiner les cumuls
  const sommeSortiesOffline = async (jid, mois, annee, rubriqueCode) => {
    let sj = 0, sr = 0;
    try {
      const all = await idb.getAll('journal_cache');
      for (const e of all) {
        if (e.synced || !e.created_offline) continue;
        if (e.mois !== mois || String(e.annee) !== String(annee)) continue;
        const sortie = parseFloat(e.sortie) || 0;
        if (sortie <= 0) continue;
        if ((e.journal_id || null) == (jid || null)) sj += sortie;
        if (e.rubrique_code === rubriqueCode)        sr += sortie;
      }
    } catch (_) {}
    return { sj, sr };
  };

  // Pré-contrôle budgétaire local (miroir de controleBudgetSortie côté serveur).
  // Référence = montant APPROUVÉ de la rubrique dans la demande de fonds.
  // Retourne { bloque, connu, motif, message }. connu=false → pas de contexte caché
  // (contrôle impossible localement, le serveur tranchera à la synchronisation).
  const controleBudgetLocal = async (body) => {
    const montant = parseFloat(body.sortie) || 0;
    if (montant <= 0) return { bloque: false, connu: true };

    const jid = body.journal_id || null;
    const ctx = await getCachedControleContext(jid, body.mois, body.annee);
    if (!ctx) return { bloque: false, connu: false };

    const off = await sommeSortiesOffline(jid, body.mois, body.annee, body.rubrique_code);
    const fmt = n => (parseFloat(n) || 0).toLocaleString('fr-FR');

    const approuve = parseFloat(ctx.approuve_by_rubrique?.[body.rubrique_code]) || 0;
    const sr = (parseFloat(ctx.sorties_by_rubrique?.[body.rubrique_code]) || 0) + off.sr + montant;

    // 1. Rubrique sans budget approuvé
    if (approuve <= 0) {
      return { bloque: true, connu: true, motif: 'rubrique_non_approuvee',
        message: `la rubrique "${body.rubrique_code}" n'a pas de budget approuvé dans la demande de fonds.` };
    }
    // 2. Dépassement du montant approuvé de la rubrique
    if (sr > approuve) {
      return { bloque: true, connu: true, motif: 'depassement_rubrique',
        message: `la rubrique "${body.rubrique_code}" dépasserait le budget approuvé de ${fmt(sr - approuve)} FCFA.` };
    }
    // 3. Plafond du journal (secondaire)
    const plafond = parseFloat(ctx.plafond) || 0;
    if (plafond > 0) {
      const apres = (parseFloat(ctx.sorties_journal) || 0) + off.sj + montant;
      if (apres > plafond) {
        return { bloque: true, connu: true, motif: 'depassement_journal',
          message: `le plafond de caisse serait dépassé de ${fmt(apres - plafond)} FCFA.` };
      }
    }
    return { bloque: false, connu: true };
  };

  // ── Initialisation (écoute les événements réseau) ─────────────────────
  const init = () => {
    window.addEventListener('online',  () => {
      updateOfflineIndicator(true);
      console.log('[Sync] Retour en ligne → replay queue');
      setTimeout(replayAll, 1500); // petit délai pour stabiliser la connexion
    });

    window.addEventListener('offline', () => {
      updateOfflineIndicator(false);
      console.log('[Sync] Hors ligne → mode offline activé');
    });

    // Init état courant
    updateOfflineIndicator(navigator.onLine);
    updateBadge();
  };

  const updateOfflineIndicator = (isOnline) => {
    const ind = document.getElementById('offline-indicator');
    if (!ind) return;
    if (isOnline) {
      ind.style.display = 'none';
    } else {
      ind.style.display = 'flex';
    }
  };

  return {
    enqueue,
    replayAll,
    countPending,
    getAll,
    clearDone,
    updateBadge,
    cacheRubriques,
    getCachedRubriques,
    cacheJournalEntry,
    getCachedJournal,
    cacheControleContext,
    getCachedControleContext,
    controleBudgetLocal,
    init,
  };
})();
