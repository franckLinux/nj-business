// src/services/notification.service.js
// Notification du directeur, pluggable par canal (users.canal_notif).
//
//   'email'      — e-mail uniquement
//   'plateforme' — in-app uniquement (la file « Dépenses en attente » sert de canal)
//   'les_deux'   — e-mail + in-app
//   'aucun'      — aucune notification
//
// Le canal « plateforme » ne nécessite pas d'envoi actif : la dépense est déjà
// persistée dans mouvements_attente et remonte dans l'écran directeur + le compteur.
// Ce service reste best-effort : il n'interrompt jamais le flux de saisie caisse.

const { query } = require('../config/database');
const { sendMouvementAttenteAlert } = require('./email.service');

/**
 * Crée une notification in-app pour UN destinataire (best-effort).
 * @returns {Promise<Object|null>} la ligne créée, ou null en cas d'échec.
 */
const creerNotification = async (o) => {
  try {
    const { rows: [row] } = await query(
      `INSERT INTO notifications(tenant_id, destinataire_id, type, titre, message, ref_type, ref_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [o.tenantId, o.destinataireId, o.type, o.titre, o.message || '',
       o.refType || '', o.refId != null ? String(o.refId) : '']
    );
    return row;
  } catch (e) {
    console.warn('[Notif] creerNotification :', e.message);
    return null;
  }
};

/**
 * Notifie tous les destinataires d'un rôle donné (in-app), une ligne par utilisateur.
 * @returns {Promise<number>} nombre de notifications créées.
 */
const notifierRole = async (o) => {
  let n = 0;
  try {
    const { rows: users } = await query(
      `SELECT id FROM users WHERE tenant_id=$1 AND role=$2 AND actif=true`,
      [o.tenantId, o.role]
    );
    for (const u of users) {
      const r = await creerNotification({ ...o, destinataireId: u.id });
      if (r) n += 1;
    }
  } catch (e) {
    console.warn('[Notif] notifierRole :', e.message);
  }
  return n;
};

/**
 * Notifie le(s) directeur(s) d'une dépense mise en attente (RG-03 / RG-04).
 * Canal e-mail (selon users.canal_notif) + notification in-app (cloche).
 * @param {Object} p
 * @param {string} p.tenantId
 * @param {Object} p.mouvement   — ligne mouvements_attente (contient motif_attente, sortie, etc.)
 * @param {string} p.caissierNom
 * @returns {Promise<{notified:number, emails:Array}>}
 */
const notifyMouvementEnAttente = async (p) => {
  const result = { notified: 0, emails: [] };
  const m = p.mouvement;
  try {
    const { rows: tRows } = await query(
      'SELECT nom FROM tenants WHERE id=$1 LIMIT 1', [p.tenantId]
    );
    const tenantNom = tRows[0]?.nom || 'Entité';

    // ── Notification in-app (cloche) à chaque directeur actif ────────────────
    await notifierRole({
      tenantId: p.tenantId, role: 'directeur',
      type: 'attente_creee',
      titre: `Dépense à valider — ${m.rubrique_code}`,
      message: `${p.caissierNom || 'La caisse'} a soumis « ${m.intitule} » (${(parseFloat(m.sortie)||0).toLocaleString('fr-FR')} FCFA) en attente de votre autorisation.`,
      refType: 'mouvement_attente', refId: m.id,
    });

    // Destinataires e-mail : directeurs actifs du tenant
    const { rows: dirs } = await query(
      `SELECT username, email, COALESCE(canal_notif,'email') AS canal_notif
         FROM users
        WHERE tenant_id=$1 AND role='directeur' AND actif=true`,
      [p.tenantId]
    );

    for (const d of dirs) {
      const canal = d.canal_notif;
      if (canal === 'aucun' || canal === 'plateforme') {
        // Plateforme : rien à envoyer, la file d'attente fait office de notification.
        continue;
      }
      // canal 'email' ou 'les_deux'
      if (!d.email) {
        result.emails.push({ dir: d.username, sent: false, reason: 'pas d\'email' });
        continue;
      }
      const r = await sendMouvementAttenteAlert({
        dirEmail:     d.email,
        dirNom:       d.username,
        tenantNom,
        caissierNom:  p.caissierNom || '',
        motif:        m.motif_attente,
        mois:         m.mois,
        annee:        m.annee,
        rubriqueCode: m.rubrique_code,
        intitule:     m.intitule,
        beneficiaire: m.beneficiaire,
        sortie:       parseFloat(m.sortie) || 0,
        montantPrevu: parseFloat(m.montant_prevu) || 0,
        cumulSorties: parseFloat(m.cumul_sorties) || 0,
        mouvementId:  m.id,
      });
      result.emails.push({ dir: d.username, ...r });
      if (r.sent) result.notified += 1;
    }
  } catch (err) {
    console.warn('[Notif] notifyMouvementEnAttente :', err.message);
  }
  return result;
};

/**
 * Notifie le créateur d'une dépense après décision du directeur.
 * @param {Object} p { tenantId, mouvement, decision:'approuvee'|'rejetee', commentaire, directeurNom }
 */
const notifyDecisionMouvement = async (p) => {
  const m = p.mouvement;
  if (!m || !m.created_by) return null;
  const montant = (parseFloat(m.sortie) || 0).toLocaleString('fr-FR');
  const approuvee = p.decision === 'approuvee';
  const titre = approuvee
    ? `Dépense approuvée — ${m.rubrique_code}`
    : `Dépense refusée — ${m.rubrique_code}`;
  const base = approuvee
    ? `Votre dépense « ${m.intitule} » (${montant} FCFA) a été approuvée par ${p.directeurNom || 'le directeur'} et enregistrée dans le journal.`
    : `Votre dépense « ${m.intitule} » (${montant} FCFA) a été refusée par ${p.directeurNom || 'le directeur'}.`;
  const message = (!approuvee && p.commentaire) ? `${base} Motif : ${p.commentaire}` : base;

  return creerNotification({
    tenantId: p.tenantId,
    destinataireId: m.created_by,
    type: approuvee ? 'attente_approuvee' : 'attente_rejetee',
    titre, message,
    refType: 'mouvement_attente', refId: m.id,
  });
};

module.exports = { creerNotification, notifierRole, notifyMouvementEnAttente, notifyDecisionMouvement };
