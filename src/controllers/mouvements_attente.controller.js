// src/controllers/mouvements_attente.controller.js
// File des dépenses (sorties) bloquées en attente d'autorisation (RG-03 / RG-04).
// L'approbation bascule la ligne en écriture réelle dans `journal` (transaction atomique).
const { query, getClient } = require('../config/database');
const notif = require('../services/notification.service');

const PEUT_DECIDER = ['directeur', 'super_admin'];

// ── GET /api/mouvements-attente?mois=&annee=&statut= ────────────────────────
const list = async (req, res) => {
  const { mois, annee, statut } = req.query;
  try {
    const conditions = ['ma.tenant_id=$1'];
    const params     = [req.tenantId];
    if (mois)  { params.push(mois);            conditions.push(`ma.mois=$${params.length}`); }
    if (annee) { params.push(parseInt(annee)); conditions.push(`ma.annee=$${params.length}`); }
    if (statut && statut !== 'all') {
      params.push(statut);                     conditions.push(`ma.statut=$${params.length}`);
    }
    const { rows } = await query(
      `SELECT ma.*, r.intitule AS rubrique_intitule,
              jx.nom AS journal_nom, jx.code AS journal_code,
              u.username AS created_by_nom, ud.username AS decided_by_nom
         FROM mouvements_attente ma
         LEFT JOIN rubriques r  ON r.tenant_id=ma.tenant_id AND r.code=ma.rubrique_code
         LEFT JOIN journaux  jx ON jx.id=ma.journal_id
         LEFT JOIN users     u  ON u.id=ma.created_by
         LEFT JOIN users     ud ON ud.id=ma.decided_by
        WHERE ${conditions.join(' AND ')}
        ORDER BY ma.created_at DESC`,
      params
    );
    const total_en_attente = rows
      .filter(r => r.statut === 'en_attente')
      .reduce((s, r) => s + (parseFloat(r.sortie) || 0), 0);
    res.json({ mouvements: rows, total_en_attente });
  } catch (err) {
    console.error('[MvtAttente] list :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── GET /api/mouvements-attente/count?mois=&annee= ──────────────────────────
const count = async (req, res) => {
  const { mois, annee } = req.query;
  try {
    const conditions = ['tenant_id=$1', "statut='en_attente'"];
    const params     = [req.tenantId];
    if (mois)  { params.push(mois);            conditions.push(`mois=$${params.length}`); }
    if (annee) { params.push(parseInt(annee)); conditions.push(`annee=$${params.length}`); }
    const { rows } = await query(
      `SELECT COUNT(*)::int AS nb FROM mouvements_attente WHERE ${conditions.join(' AND ')}`,
      params
    );
    res.json({ nb: rows[0].nb });
  } catch (err) {
    console.error('[MvtAttente] count :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── PATCH /api/mouvements-attente/:id/approuver ──────────────────────────────
// Transaction : lit la ligne (FOR UPDATE), INSERT dans journal, marque 'approuve'.
const approuver = async (req, res) => {
  if (!PEUT_DECIDER.includes(req.user.role)) {
    return res.status(403).json({ error: 'Approbation réservée au directeur.' });
  }
  const id = parseInt(req.params.id);
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows: [m] } = await client.query(
      `SELECT * FROM mouvements_attente
        WHERE id=$1 AND tenant_id=$2 AND statut='en_attente'
        FOR UPDATE`,
      [id, req.tenantId]
    );
    if (!m) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Dépense en attente introuvable ou déjà traitée.' });
    }

    const { rows: [j] } = await client.query(
      `INSERT INTO journal (tenant_id, date, mois, annee, journal_id, type_caisse,
         rubrique_code, intitule, objet, beneficiaire, piece_identite, telephone,
         entree, sortie, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0,$13,$14)
       RETURNING *`,
      [m.tenant_id, m.date, m.mois, m.annee, m.journal_id, m.type_caisse,
       m.rubrique_code, m.intitule, m.objet, m.beneficiaire, m.piece_identite,
       m.telephone, m.sortie, req.user.id]
    );

    await client.query(
      `UPDATE mouvements_attente
          SET statut='approuve', decided_by=$1, decided_at=NOW(),
              commentaire_dir=$2
        WHERE id=$3`,
      [req.user.id, req.body.commentaire || '', id]
    );

    await client.query('COMMIT');

    // Notifier le créateur de la dépense (cloche) — best-effort, hors transaction
    notif.notifyDecisionMouvement({
      tenantId: req.tenantId, mouvement: m, decision: 'approuvee',
      directeurNom: req.user.username,
    }).catch(e => console.warn('[MvtAttente] notif approbation :', e.message));

    res.json({ ok: true, journal: j });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[MvtAttente] approuver :', err.message);
    res.status(500).json({ error: `Erreur serveur : ${err.message}` });
  } finally {
    client.release();
  }
};

// ── PATCH /api/mouvements-attente/:id/rejeter ────────────────────────────────
const rejeter = async (req, res) => {
  if (!PEUT_DECIDER.includes(req.user.role)) {
    return res.status(403).json({ error: 'Rejet réservé au directeur.' });
  }
  try {
    const { rows } = await query(
      `UPDATE mouvements_attente
          SET statut='rejete', decided_by=$1, decided_at=NOW(), commentaire_dir=$2
        WHERE id=$3 AND tenant_id=$4 AND statut='en_attente'
        RETURNING *`,
      [req.user.id, req.body.commentaire || '', parseInt(req.params.id), req.tenantId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Dépense en attente introuvable ou déjà traitée.' });
    }

    // Notifier le créateur de la dépense du refus (cloche) — best-effort
    notif.notifyDecisionMouvement({
      tenantId: req.tenantId, mouvement: rows[0], decision: 'rejetee',
      commentaire: req.body.commentaire || '', directeurNom: req.user.username,
    }).catch(e => console.warn('[MvtAttente] notif rejet :', e.message));

    res.json({ ok: true, mouvement: rows[0] });
  } catch (err) {
    console.error('[MvtAttente] rejeter :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = { list, count, approuver, rejeter };
