// src/routes/index.js — CaissePro v2 — Routes complètes
const router = require('express').Router();
const { authGuard, requireRole } = require('../middleware/auth');
const { tenantGuard }             = require('../middleware/tenant');
const { query }                   = require('../config/database');

// ── Auth ──────────────────────────────────────────────────────────────────
const authCtrl = require('../controllers/auth.controller');
router.post('/auth/login',           authCtrl.login);
router.get ('/auth/me',              authGuard, authCtrl.me);
router.post('/auth/change-password', authGuard, authCtrl.changePassword);

// ── Journaux (dynamique) ──────────────────────────────────────────────────
const jxCtrl = require('../controllers/journaux.controller');
router.get   ('/journaux/next-code', authGuard, tenantGuard, jxCtrl.getNextCode);
router.get   ('/journaux',      authGuard, tenantGuard, jxCtrl.getJournaux);
router.post  ('/journaux',      authGuard, tenantGuard, jxCtrl.createJournal);
router.put   ('/journaux/:id',  authGuard, tenantGuard, jxCtrl.updateJournal);
router.delete('/journaux/:id',  authGuard, tenantGuard, jxCtrl.deleteJournal);

// Arrêt de caisse
router.post('/journaux/:id/arreter', authGuard, tenantGuard, async (req, res) => {
  const { mois, annee, commentaire, solde_final } = req.body;
  if (!mois || !annee) return res.status(400).json({ error: 'mois et annee requis.' });
  const journalId = parseInt(req.params.id);
  // Vérifier que l'utilisateur est responsable_arret du journal OU directeur/super_admin
  try {
    const { rows: jRows } = await query(
      'SELECT responsable_arret FROM journaux WHERE id=$1 AND tenant_id=$2',
      [journalId, req.tenantId]
    );
    if (!jRows.length) return res.status(404).json({ error: 'Journal introuvable.' });
    const isResponsable = jRows[0].responsable_arret === req.user.id;
    const isAdmin = ['directeur','super_admin','comptable_cabinet'].includes(req.user.role);
    if (!isResponsable && !isAdmin) {
      return res.status(403).json({ error: "Vous n'êtes pas le responsable d'arrêt de ce journal." });
    }
    const { rows } = await query(
      `INSERT INTO arrets_caisse(tenant_id,journal_id,mois,annee,solde_final,arrete_par,commentaire)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(tenant_id,journal_id,mois,annee) DO UPDATE
         SET arrete_le=NOW(), arrete_par=EXCLUDED.arrete_par,
             solde_final=EXCLUDED.solde_final, commentaire=EXCLUDED.commentaire
       RETURNING *`,
      [req.tenantId, journalId, mois, parseInt(annee),
       parseFloat(solde_final)||0, req.user.id, commentaire||'']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[Arrêt caisse]', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.delete('/journaux/:id/arreter', authGuard, tenantGuard, async (req, res) => {
  if (!['directeur','super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Réouverture réservée au directeur.' });
  }
  const mois  = req.query.mois  || req.body.mois;
  const annee = req.query.annee || req.body.annee;
  try {
    await query(
      'DELETE FROM arrets_caisse WHERE tenant_id=$1 AND journal_id=$2 AND mois=$3 AND annee=$4',
      [req.tenantId, parseInt(req.params.id), mois, parseInt(annee)]
    );
    res.json({ message: 'Caisse réouverte.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ── Journal des mouvements ────────────────────────────────────────────────
const jCtrl = require('../controllers/journal.controller');
router.get   ('/journal',         authGuard, tenantGuard, jCtrl.getJournal);
router.post  ('/journal',         authGuard, tenantGuard, jCtrl.createMouvement);
router.put   ('/journal/:id',     authGuard, tenantGuard, jCtrl.updateMouvement);
router.delete('/journal/:id',     authGuard, tenantGuard, jCtrl.deleteMouvement);
router.get   ('/journal/soldes',  authGuard, tenantGuard, jCtrl.getSoldes);
router.get   ('/journal/cumuls',  authGuard, tenantGuard, jCtrl.getCumuls);
router.get   ('/journal/ran',     authGuard, tenantGuard, jCtrl.getRan);
router.get   ('/journal/recap',   authGuard, tenantGuard, jCtrl.getJournauxRecap);
router.get   ('/journal/controle-context', authGuard, tenantGuard, jCtrl.getControleContext);
router.post  ('/journal/ran',     authGuard, tenantGuard, jCtrl.setRan);

// ── Mouvements en attente (RG-03 / RG-04 — autorisation directeur) ─────────
const maCtrl = require('../controllers/mouvements_attente.controller');
router.get   ('/mouvements-attente',               authGuard, tenantGuard, maCtrl.list);
router.get   ('/mouvements-attente/count',         authGuard, tenantGuard, maCtrl.count);
router.patch ('/mouvements-attente/:id/approuver', authGuard, tenantGuard, maCtrl.approuver);
router.patch ('/mouvements-attente/:id/rejeter',   authGuard, tenantGuard, maCtrl.rejeter);

// ── Notifications (cloche in-app) ──────────────────────────────────────────
const notifCtrl = require('../controllers/notifications.controller');
router.get   ('/notifications',        authGuard, tenantGuard, notifCtrl.list);
router.get   ('/notifications/count',  authGuard, tenantGuard, notifCtrl.count);
router.patch ('/notifications/lu-tout',authGuard, tenantGuard, notifCtrl.markAllRead);
router.patch ('/notifications/:id/lu', authGuard, tenantGuard, notifCtrl.markRead);

// ── Budget Caisse (budget de dépense par journal + dépassements) ──────────
const bcCtrl = require('../controllers/budget_caisse.controller');
router.get   ('/budget-caisse',                          authGuard, tenantGuard, bcCtrl.getBudgetCaisse);
router.put   ('/budget-caisse',                          authGuard, tenantGuard, bcCtrl.setBudgetCaisse);
router.delete('/budget-caisse',                          authGuard, tenantGuard, bcCtrl.deleteBudgetCaisse);
router.get   ('/budget-caisse/depassements/count',       authGuard, tenantGuard, bcCtrl.countDepassements);
router.get   ('/budget-caisse/depassements',             authGuard, tenantGuard, bcCtrl.getDepassements);
router.post  ('/budget-caisse/demande',                  authGuard, tenantGuard, bcCtrl.createDemande);
router.patch ('/budget-caisse/demande/:id/statut',       authGuard, tenantGuard, bcCtrl.validerDemande);
router.delete('/budget-caisse/demande/:id',              authGuard, tenantGuard, bcCtrl.deleteDemande);

// ── Budget & Réalisations ─────────────────────────────────────────────────
const bCtrl = require('../controllers/budget.controller');
router.get   ('/budget',                          authGuard, tenantGuard, bCtrl.getBudget);
router.put   ('/budget',                          authGuard, tenantGuard, bCtrl.setBudgetLine);
router.delete('/budget/:id',                      authGuard, tenantGuard, async (req,res) => {
  await query('DELETE FROM budget WHERE id=$1 AND tenant_id=$2',[req.params.id,req.tenantId]);
  res.json({message:'Ligne budget supprimée.'});
});
router.post  ('/budget/validation',               authGuard, tenantGuard, bCtrl.setValidation);
router.post  ('/budget/depenses-attente',         authGuard, tenantGuard, bCtrl.addDepenseAttente);
router.put   ('/budget/depenses-attente/batch',   authGuard, tenantGuard, bCtrl.batchDepenseAttente);
router.delete('/budget/depenses-attente/:id',     authGuard, tenantGuard, bCtrl.deleteDepenseAttente);
router.post  ('/budget/ressources-attente',       authGuard, tenantGuard, bCtrl.addRessourceAttente);
router.put   ('/budget/ressources-attente/batch', authGuard, tenantGuard, bCtrl.batchRessourceAttente);
router.delete('/budget/ressources-attente/:id',   authGuard, tenantGuard, bCtrl.deleteRessourceAttente);

// ── Appel de Fonds ────────────────────────────────────────────────────────
const afCtrl = require('../controllers/appel_fonds.controller');
router.get   ('/appel-fonds',            authGuard, tenantGuard, afCtrl.getAppelFonds);
router.post  ('/appel-fonds',            authGuard, tenantGuard, afCtrl.createAppelFonds);
router.patch ('/appel-fonds/:id/statut', authGuard, tenantGuard, afCtrl.updateStatut);
router.delete('/appel-fonds/:id',        authGuard, tenantGuard, afCtrl.deleteAppelFonds);

// ── Appel de Fonds — Synthèse Demande de Fonds ────────────────────────────
const afSynthCtrl = require('../controllers/appel_fonds_synthese.controller');
router.get('/appel-fonds/synthese', authGuard, tenantGuard, afSynthCtrl.getSynthese);

// ── Rubriques ─────────────────────────────────────────────────────────────
const rCtrl = require('../controllers/rubriques.controller');
router.get   ('/rubriques',      authGuard, tenantGuard, rCtrl.getRubriques);
router.post  ('/rubriques',      authGuard, tenantGuard, rCtrl.createRubrique);
router.put   ('/rubriques/:id',  authGuard, tenantGuard, rCtrl.updateRubrique);
router.delete('/rubriques/:id',  authGuard, tenantGuard, async (req, res) => {
  await query('UPDATE rubriques SET actif=false WHERE id=$1 AND tenant_id=$2',
              [req.params.id, req.tenantId]);
  res.json({ message: 'Rubrique désactivée.' });
});

// ── Utilisateurs ──────────────────────────────────────────────────────────
const uCtrl = require('../controllers/users.controller');
router.get   ('/users',               authGuard, tenantGuard, uCtrl.getUsers);
router.post  ('/users',               authGuard, tenantGuard, uCtrl.createUser);
router.put   ('/users/:id',           authGuard, tenantGuard, uCtrl.updateUser);
router.patch ('/users/:id/actif',     authGuard, tenantGuard, uCtrl.toggleActif);
router.post  ('/users/:id/password',  authGuard, tenantGuard, uCtrl.resetPassword);
router.delete('/users/:id',           authGuard, tenantGuard, uCtrl.deleteUser);

// ── Configuration Entité ──────────────────────────────────────────────────
const cfgCtrl = require('../controllers/config.controller');
router.get('/config',             authGuard, tenantGuard, cfgCtrl.getConfig);
router.put('/config',             authGuard, tenantGuard, cfgCtrl.updateConfig);
router.get('/config/referentiel', authGuard,              cfgCtrl.getReferentiel);

// ── Banque ────────────────────────────────────────────────────────────────
router.get('/banque', authGuard, tenantGuard, async (req, res) => {
  const { mois, annee, journal_id } = req.query;
  const where = journal_id ? 'AND journal_id=$4' : '';
  const params = [req.tenantId, mois, parseInt(annee), ...(journal_id ? [parseInt(journal_id)] : [])];
  try {
    const { rows } = await query(
      `SELECT * FROM banque WHERE tenant_id=$1 AND mois=$2 AND annee=$3 ${where}`, params
    );
    res.json(rows[0] || { solde_initial:0, fonds_recus:0, solde_final:0 });
  } catch (err) {
    console.error('[Banque] GET :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});
router.put('/banque', authGuard, tenantGuard, async (req, res) => {
  const { mois, annee, solde_initial, fonds_recus, solde_final } = req.body;
  try {
    await query(
      `INSERT INTO banque(tenant_id,mois,annee,solde_initial,fonds_recus,solde_final)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(tenant_id,mois,annee) DO UPDATE SET
         solde_initial = COALESCE($4, banque.solde_initial),
         fonds_recus   = COALESCE($5, banque.fonds_recus),
         solde_final   = COALESCE($6, banque.solde_final)`,
      [req.tenantId, mois, parseInt(annee),
       solde_initial!=null?parseFloat(solde_initial):null,
       fonds_recus  !=null?parseFloat(fonds_recus)  :null,
       solde_final  !=null?parseFloat(solde_final)  :null]
    );
    res.json({ message: 'Banque mise à jour.' });
  } catch (err) {
    console.error('[Banque] PUT :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ── Rapports ──────────────────────────────────────────────────────────────
const rapportCtrl = require('../controllers/rapport.controller');
router.get('/rapport/compte-emploi',     authGuard, tenantGuard, rapportCtrl.getCompteEmploi);
router.get('/rapport/synthese-annuelle', authGuard, tenantGuard, rapportCtrl.getSyntheseAnnuelle);

// ── Dashboard ─────────────────────────────────────────────────────────────
router.get('/dashboard/stats', authGuard, tenantGuard, async (req, res) => {
  const yr = parseInt(req.query.annee) || new Date().getFullYear();
  try {
    const [totalEntrees, totalSorties, nbMvt] = await Promise.all([
      query(`SELECT COALESCE(SUM(entree),0) AS val FROM journal WHERE tenant_id=$1 AND annee=$2`,[req.tenantId,yr]),
      query(`SELECT COALESCE(SUM(sortie),0) AS val FROM journal WHERE tenant_id=$1 AND annee=$2`,[req.tenantId,yr]),
      query(`SELECT COUNT(*) AS val FROM journal WHERE tenant_id=$1 AND annee=$2`,[req.tenantId,yr]),
    ]);
    // Soldes par journal
    const { rows: soldesJournaux } = await query(
      `SELECT jx.id, jx.nom, jx.type, jx.code,
              COALESCE(SUM(j.entree - j.sortie),0) AS solde
       FROM journaux jx
       LEFT JOIN journal j ON j.journal_id=jx.id AND j.tenant_id=jx.tenant_id
       WHERE jx.tenant_id=$1 AND jx.actif=true
       GROUP BY jx.id, jx.nom, jx.type, jx.code ORDER BY jx.ordre`,
      [req.tenantId]
    );
    const { rows: tendance } = await query(
      `SELECT mois, COALESCE(SUM(entree),0) AS entrees, COALESCE(SUM(sortie),0) AS sorties
       FROM journal WHERE tenant_id=$1 AND annee=$2
       GROUP BY mois ORDER BY MIN(date)`,
      [req.tenantId, yr]
    );
    res.json({
      totalEntrees:   parseFloat(totalEntrees.rows[0].val),
      totalSorties:   parseFloat(totalSorties.rows[0].val),
      nbMouvements:   parseInt(nbMvt.rows[0].val),
      soldesJournaux,
      tendance,
    });
  } catch (err) {
    console.error('[Dashboard]', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ── Permissions ───────────────────────────────────────────────────────────
const permCtrl = require('../controllers/permissions.controller');
router.get   ('/permissions',                        authGuard, requireRole('super_admin','comptable_cabinet'), permCtrl.getPermissions);
router.post  ('/permissions',                        authGuard, requireRole('super_admin'),                    permCtrl.createPermission);
router.put   ('/permissions/:code',                  authGuard, requireRole('super_admin'),                    permCtrl.updatePermission);
router.delete('/permissions/:code',                  authGuard, requireRole('super_admin'),                    permCtrl.deletePermission);
router.get   ('/tenants/:tenantId/permissions',      authGuard, requireRole('super_admin','comptable_cabinet'), permCtrl.getTenantPermissions);
router.post  ('/tenants/:tenantId/permissions',      authGuard, requireRole('super_admin'),                    permCtrl.setTenantPermissions);
router.get   ('/users/:userId/permissions',          authGuard, requireRole('super_admin','comptable_cabinet'), permCtrl.getUserPermissions);
router.post  ('/users/:userId/permissions',          authGuard, requireRole('super_admin'),                    permCtrl.setUserPermissions);

// ── Rôles personnalisés ───────────────────────────────────────────────────
const rolesCtrl = require('../controllers/roles.controller');
router.get   ('/roles',                    authGuard, tenantGuard, requireRole('super_admin','directeur'), rolesCtrl.getRoles);
router.post  ('/roles',                    authGuard, tenantGuard, requireRole('super_admin'),             rolesCtrl.createRole);
router.put   ('/roles/:id',                authGuard, tenantGuard, requireRole('super_admin'),             rolesCtrl.updateRole);
router.delete('/roles/:id',                authGuard, tenantGuard, requireRole('super_admin'),             rolesCtrl.deleteRole);
router.get   ('/roles/:id/permissions',    authGuard, tenantGuard, requireRole('super_admin','directeur'), rolesCtrl.getRolePermissions);
router.post  ('/roles/:id/permissions',    authGuard, tenantGuard, requireRole('super_admin'),             rolesCtrl.setRolePermissions);

// ── Tenants ───────────────────────────────────────────────────────────────
const { seedRubriquesDefaut } = require('../controllers/rubriques.controller');
const { seedJournauxDefaut }  = require('../controllers/journaux.controller');

router.get('/tenants', authGuard, requireRole('super_admin','comptable_cabinet'), async (req, res) => {
  try {
    const { rows } = await query('SELECT id,slug,nom,actif,created_at FROM tenants ORDER BY nom');
    res.json(rows);
  } catch (err) {
    console.error('[Tenants] GET :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});
router.post('/tenants', authGuard, requireRole('super_admin'), async (req, res) => {
  const { slug, nom, caissier_nom, directeur_nom, devise } = req.body;
  if (!slug || !nom) return res.status(400).json({ error: 'Nom et slug obligatoires.' });
  if (!/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'Slug invalide.' });
  try {
    const { rows } = await query(
      `INSERT INTO tenants(slug,nom,caissier_nom,directeur_nom,devise)
       VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [slug, nom, caissier_nom||'', directeur_nom||'', devise||'FCFA']
    );
    await seedRubriquesDefaut(rows[0].id);
    await seedJournauxDefaut(rows[0].id);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Slug déjà utilisé.' });
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});
router.patch('/tenants/:id/actif', authGuard, requireRole('super_admin'), async (req, res) => {
  const { actif } = req.body;
  try {
    await query('UPDATE tenants SET actif=$1 WHERE id=$2', [!!actif, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ── Pièces justificatives ─────────────────────────────────────────────────
const piecesCtrl = require('../controllers/pieces.controller');
router.get   ('/pieces/types',              authGuard, tenantGuard, piecesCtrl.getTypes);
router.post  ('/pieces/types',              authGuard, tenantGuard, piecesCtrl.createType);
router.put   ('/pieces/types/:id',          authGuard, tenantGuard, piecesCtrl.updateType);
router.delete('/pieces/types/:id',          authGuard, tenantGuard, piecesCtrl.deleteType);
router.get   ('/pieces/:mouvementId',       authGuard, tenantGuard, piecesCtrl.getByMouvement);
router.post  ('/pieces/upload/:mouvementId',authGuard, tenantGuard, piecesCtrl.upload);
router.delete('/pieces/item/:pieceId',      authGuard, tenantGuard, piecesCtrl.deletePiece);

// ── Plan Comptable SYSCOHADA ──────────────────────────────────────────────
const planCtrl = require('../controllers/plan_comptable.controller');
router.get('/plan-comptable/search',  authGuard, planCtrl.search);
router.get('/plan-comptable/classes', authGuard, planCtrl.getClasses);
router.get('/plan-comptable/list',    authGuard, planCtrl.list);
router.get('/plan-comptable/stats',   authGuard, planCtrl.getStats);
router.post  ('/plan-comptable',         authGuard, tenantGuard, planCtrl.createCompte);
router.delete('/plan-comptable/:compte', authGuard, tenantGuard, planCtrl.deleteCompte);

// ── Health ────────────────────────────────────────────────────────────────
module.exports = router;
