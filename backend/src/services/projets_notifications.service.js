'use strict';
// Gestion des activités — notifications des demandes de fonds (26/11/2026).
// Décision de Franck : un mail à chaque étape (envoi au chef de projet, puis au
// directeur ; approbation à la caisse et au demandeur ; renvoi, rejet, annulation
// au demandeur ; décaissement au demandeur ; dépense déclarée au comptable ;
// dépense rejetée à son auteur ; sollicitation de la Demande de fonds au
// directeur, puis sa décision à la caisse et au demandeur).
//
// Chaque destinataire reçoit une notification dans l'application (cloche) et un
// mail selon son canal (users.canal_notif : email par défaut, les_deux, plateforme,
// aucun). Envoi APRÈS la transaction, sans jamais bloquer ni annuler l'action :
// un échec est journalisé (console + audit_log), jamais tu.
const { sequelize } = require('../models');
const { creerNotification } = require('./notification.service');
const { usersAvecPermission } = require('./permission.service');
const { envoyer } = require('./email.service');

const T = sequelize.QueryTypes;
const echapper = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const urlFront = () => (process.env.APP_URL || '').split(',')[0].trim().replace(/\/+$/, '');

const gabarit = (entite, titre, lignes, lien, rubrique = 'Gestion des activités') => `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,sans-serif;background:#f8fafc;margin:0;padding:0">
<div style="max-width:600px;margin:30px auto;background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden">
  <div style="background:#0f172a;padding:20px 28px">
    <div style="color:#fff;font-size:18px;font-weight:bold">NJ FINANCE — ${echapper(entite)}</div>
    <div style="color:rgba(255,255,255,.7);font-size:13px;margin-top:4px">${echapper(rubrique)}</div>
  </div>
  <div style="padding:24px 28px;font-size:14px;color:#1e293b;line-height:1.6">
    <h2 style="font-size:16px;margin:0 0 12px">${echapper(titre)}</h2>
    ${lignes.map((l) => `<p style="margin:6px 0">${echapper(l)}</p>`).join('')}
    ${lien ? `<p style="margin:20px 0 0"><a href="${echapper(lien)}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Ouvrir dans NJ FINANCE</a></p>` : ''}
  </div>
  <div style="background:#f8fafc;padding:12px 28px;font-size:11px;color:#64748b">Message automatique de NJ FINANCE. Vous le recevez en raison de votre rôle dans ce circuit.</div>
</div></body></html>`;

/** Utilisateurs actifs du client, par identifiant. */
const parIds = async (tenantId, ids) => {
  const propres = [...new Set(ids.filter(Boolean))];
  if (!propres.length) return [];
  return sequelize.query(`SELECT id, username, email, role, canal_notif FROM users WHERE tenant_id = :t AND actif AND id IN (:ids)`,
    { replacements: { t: tenantId, ids: propres }, type: T.SELECT });
};
const parRole = (tenantId, role) => sequelize.query(
  `SELECT id, username, email, role, canal_notif FROM users WHERE tenant_id = :t AND actif AND role = :role`,
  { replacements: { t: tenantId, role }, type: T.SELECT });

/**
 * @param {object} o { tenantId, auteurId, destinataires: { ids?, permission?, role? }, type, titre, lignes[], chemin, refType, refId }
 * L'auteur de l'action n'est pas notifié de sa propre action.
 */
const notifier = async (o) => {
  const bilan = { inapp: 0, mails: [] };
  try {
    const d = o.destinataires || {};
    const listes = await Promise.all([
      d.ids ? parIds(o.tenantId, d.ids) : [],
      d.permission ? usersAvecPermission(o.tenantId, d.permission) : [],
      d.role ? parRole(o.tenantId, d.role) : [],
    ]);
    const users = new Map();
    for (const u of listes.flat()) if (u.id !== o.auteurId) users.set(u.id, u);
    const [t] = await sequelize.query('SELECT nom FROM tenants WHERE id = :t', { replacements: { t: o.tenantId }, type: T.SELECT });
    const lien = urlFront() && o.chemin ? `${urlFront()}${o.chemin}` : '';
    for (const u of users.values()) {
      const canal = u.canal_notif || 'email';
      if (canal === 'aucun') continue;
      const r = await creerNotification({ tenantId: o.tenantId, destinataireId: u.id, type: o.type, titre: o.titre,
        message: o.lignes.join(' '), refType: o.refType || 'demande_fonds', refId: o.refId });
      if (r) bilan.inapp += 1;
      if (canal === 'plateforme') continue;
      const adr = String(u.email || '').trim();
      if (!adr) { bilan.mails.push({ dest: u.username, ok: false, raison: 'pas d\'e-mail sur la fiche' }); continue; }
      const m = await envoyer({ to: adr, subject: `[NJ FINANCE] ${o.titre}`, html: gabarit(t?.nom || '', o.titre, o.lignes, lien, o.rubrique) });
      bilan.mails.push({ dest: adr, ok: m.statut === 'envoye', raison: m.erreur || null });
    }
  } catch (err) {
    console.warn(`[Notif activités] ${o.titre} :`, err.message);
    bilan.erreur = err.message;
  }
  await sequelize.query(
    `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, nouvelle_valeur)
     VALUES (:t, :u, 'EMAIL_ACTIVITES', :e, :id, CAST(:v AS jsonb))`,
    { replacements: { t: o.tenantId, u: o.auteurId || null, e: o.refType || 'demande_fonds', id: String(o.refId ?? ''),
      v: JSON.stringify({ titre: o.titre, ...bilan }) } },
  ).catch((e) => console.warn('[Notif activités] trace :', e.message));
  return bilan;
};

/** Lance la notification après la réponse, sans la retarder ni la faire échouer. */
const plusTard = (o) => { setImmediate(() => { notifier(o).catch((e) => console.warn('[Notif activités]', e.message)); }); };

module.exports = { notifier, plusTard };
