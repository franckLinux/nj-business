// src/services/email.service.js — Envoi d'e-mails via SMTP (nodemailer)
const nodemailer = require('nodemailer');

const createTransporter = () => {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

/**
 * Envoie un e-mail d'alerte de dépassement de budget au directeur.
 * @param {Object} opts
 * @param {string} opts.dirEmail   — email du directeur
 * @param {string} opts.dirNom     — nom du directeur
 * @param {string} opts.tenantNom  — nom de l'entité
 * @param {string} opts.journalNom — nom du journal
 * @param {string} opts.caissierNom
 * @param {string} opts.mois
 * @param {number} opts.annee
 * @param {number} opts.sortie         — montant de la sortie demandée
 * @param {number} opts.budgetMontant
 * @param {number} opts.sortiesActuelles
 * @param {number} opts.depassement
 * @param {string} opts.intitule
 * @param {string} opts.beneficiaire
 * @param {number} opts.demandeId
 * @param {string} opts.appUrl
 */
const sendDepassementAlert = async (opts) => {
  const transporter = createTransporter();
  if (!transporter) {
    console.warn('[Email] SMTP non configuré — alerte non envoyée.');
    return { sent: false, reason: 'SMTP non configuré' };
  }

  const fmtN = n => (parseFloat(n) || 0).toLocaleString('fr-FR') + ' FCFA';
  const pct   = opts.budgetMontant > 0
    ? Math.round(((opts.sortiesActuelles + opts.sortie) / opts.budgetMontant) * 100)
    : 100;

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"/><style>
  body{font-family:Arial,sans-serif;background:#f8fafc;margin:0;padding:0}
  .wrap{max-width:600px;margin:30px auto;background:white;border-radius:12px;
    border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.06)}
  .header{background:linear-gradient(135deg,#1e293b,#0f172a);padding:28px 32px;text-align:center}
  .header h1{color:white;margin:0;font-size:22px;font-weight:800;letter-spacing:.3px}
  .header p{color:rgba(255,255,255,.6);margin:6px 0 0;font-size:13px}
  .alert-band{background:#fef2f2;border-left:5px solid #dc2626;padding:16px 24px;
    display:flex;align-items:center;gap:12px}
  .alert-band .icon{font-size:28px}
  .alert-band .txt{font-size:14px;color:#991b1b;font-weight:600}
  .body{padding:28px 32px}
  .kpi-row{display:flex;gap:12px;margin:20px 0}
  .kpi{flex:1;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;
    padding:14px 16px;text-align:center}
  .kpi .label{font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;margin-bottom:4px}
  .kpi .val{font-size:16px;font-weight:800}
  .detail{background:#fef2f2;border-radius:10px;border:1px solid #fecaca;
    padding:16px 20px;margin:20px 0}
  .detail table{width:100%;border-collapse:collapse;font-size:13px}
  .detail td{padding:6px 0;color:#374151}
  .detail td:last-child{text-align:right;font-weight:600;color:#0f172a}
  .progress-bar{background:#e2e8f0;border-radius:100px;height:10px;margin:12px 0;overflow:hidden}
  .progress-fill{background:linear-gradient(90deg,#dc2626,#b91c1c);height:100%;
    border-radius:100px;min-width:4px;width:${Math.min(pct,100)}%}
  .action-btn{display:block;width:fit-content;margin:24px auto 0;
    padding:14px 36px;background:linear-gradient(135deg,#1e40af,#1d4ed8);
    color:white;text-decoration:none;border-radius:10px;font-weight:700;
    font-size:14px;letter-spacing:.3px}
  .footer{background:#f8fafc;padding:16px 32px;text-align:center;
    border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8}
</style></head>
<body>
<div class="wrap">
  <div class="header">
    <h1>🔔 Dépassement de Budget Détecté</h1>
    <p>${opts.tenantNom} — ${opts.mois} ${opts.annee}</p>
  </div>

  <div class="alert-band">
    <span class="icon">⚠️</span>
    <span class="txt">Une sortie dépasse le budget alloué pour le journal <strong>${opts.journalNom}</strong>.<br/>
    Votre validation est requise pour autoriser cette dépense.</span>
  </div>

  <div class="body">
    <p style="color:#374151;font-size:14px;margin:0 0 16px">
      Bonjour <strong>${opts.dirNom || 'Directeur'}</strong>,<br/>
      La caissière <strong>${opts.caissierNom}</strong> souhaite enregistrer une dépense
      qui dépasserait le budget mensuel fixé pour <strong>${opts.journalNom}</strong>.
    </p>

    <div class="kpi-row">
      <div class="kpi">
        <div class="label">Budget mensuel</div>
        <div class="val" style="color:#0369a1">${fmtN(opts.budgetMontant)}</div>
      </div>
      <div class="kpi">
        <div class="label">Déjà dépensé</div>
        <div class="val" style="color:#d97706">${fmtN(opts.sortiesActuelles)}</div>
      </div>
      <div class="kpi">
        <div class="label">Dépassement</div>
        <div class="val" style="color:#dc2626">+${fmtN(opts.depassement)}</div>
      </div>
    </div>

    <div class="progress-bar"><div class="progress-fill"></div></div>
    <p style="text-align:center;font-size:12px;color:#dc2626;font-weight:700">${pct}% du budget utilisé après cette dépense</p>

    <div class="detail">
      <p style="font-weight:700;color:#0f172a;font-size:13px;margin:0 0 10px">📋 Détails de la dépense demandée</p>
      <table>
        <tr><td>Intitulé</td><td>${opts.intitule}</td></tr>
        <tr><td>Bénéficiaire</td><td>${opts.beneficiaire || '—'}</td></tr>
        <tr><td>Montant</td><td style="color:#dc2626;font-size:15px">${fmtN(opts.sortie)}</td></tr>
      </table>
    </div>

    <p style="color:#374151;font-size:13px">
      Connectez-vous à l'application pour <strong>approuver ou rejeter</strong> cette demande.
    </p>
    <a class="action-btn" href="${opts.appUrl || process.env.APP_URL || 'http://localhost:3000'}">
      Voir la demande dans CaissePro
    </a>
  </div>

  <div class="footer">
    CaissePro v2 — ${opts.tenantNom}<br/>
    Demande #${opts.demandeId} — Générée le ${new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'})}
  </div>
</div>
</body>
</html>`;

  try {
    await transporter.sendMail({
      from:    `"CaissePro — ${opts.tenantNom}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to:      opts.dirEmail,
      subject: `⚠️ Dépassement de budget — ${opts.journalNom} (${opts.mois} ${opts.annee})`,
      html,
    });
    console.log(`[Email] Alerte dépassement envoyée à ${opts.dirEmail}`);
    return { sent: true };
  } catch (err) {
    console.error('[Email] Erreur envoi :', err.message);
    return { sent: false, reason: err.message };
  }
};

/**
 * Alerte au directeur : une dépense (sortie) est bloquée en attente d'autorisation.
 * Couvre RG-03 (mois non validé) et RG-04 (montant prévu de la rubrique dépassé).
 * @param {Object} o
 * @param {string} o.dirEmail
 * @param {string} o.dirNom
 * @param {string} o.tenantNom
 * @param {string} o.caissierNom
 * @param {string} o.motif        — 'mois_non_valide' | 'depassement_rubrique'
 * @param {string} o.mois
 * @param {number} o.annee
 * @param {string} o.rubriqueCode
 * @param {string} o.intitule
 * @param {string} o.beneficiaire
 * @param {number} o.sortie
 * @param {number} o.montantPrevu
 * @param {number} o.cumulSorties
 * @param {number} o.mouvementId
 * @param {string} o.appUrl
 */
const sendMouvementAttenteAlert = async (o) => {
  const transporter = createTransporter();
  if (!transporter) {
    console.warn('[Email] SMTP non configuré — alerte attente non envoyée.');
    return { sent: false, reason: 'SMTP non configuré' };
  }

  const fmtN = n => (parseFloat(n) || 0).toLocaleString('fr-FR') + ' FCFA';
  const estDepassement = o.motif === 'depassement_rubrique';
  const titre  = estDepassement ? 'Montant prévu dépassé' : 'Budget du mois non validé';
  const raison = estDepassement
    ? `Le cumul des sorties de la rubrique <strong>${o.rubriqueCode}</strong> dépasse le montant prévu dans la demande de fonds.`
    : `Le budget de <strong>${o.mois} ${o.annee}</strong> n'est pas encore validé dans la demande de fonds.`;

  const depassementRow = estDepassement ? `
        <tr><td>Montant prévu</td><td>${fmtN(o.montantPrevu)}</td></tr>
        <tr><td>Déjà sorti</td><td>${fmtN(o.cumulSorties)}</td></tr>` : '';

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"/><style>
  body{font-family:Arial,sans-serif;background:#f8fafc;margin:0;padding:0}
  .wrap{max-width:600px;margin:30px auto;background:white;border-radius:12px;
    border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.06)}
  .header{background:linear-gradient(135deg,#744210,#5c340d);padding:28px 32px;text-align:center}
  .header h1{color:white;margin:0;font-size:21px;font-weight:800}
  .header p{color:rgba(255,255,255,.6);margin:6px 0 0;font-size:13px}
  .alert-band{background:#fffbeb;border-left:5px solid #d97706;padding:16px 24px}
  .alert-band .txt{font-size:14px;color:#92400e;font-weight:600}
  .body{padding:26px 32px}
  .detail{background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;padding:16px 20px;margin:18px 0}
  .detail table{width:100%;border-collapse:collapse;font-size:13px}
  .detail td{padding:6px 0;color:#374151}
  .detail td:last-child{text-align:right;font-weight:600;color:#0f172a}
  .action-btn{display:block;width:fit-content;margin:22px auto 0;padding:14px 36px;
    background:linear-gradient(135deg,#1e40af,#1d4ed8);color:white;text-decoration:none;
    border-radius:10px;font-weight:700;font-size:14px}
  .footer{background:#f8fafc;padding:16px 32px;text-align:center;
    border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8}
</style></head>
<body>
<div class="wrap">
  <div class="header">
    <h1>⏳ Dépense en attente d'autorisation</h1>
    <p>${o.tenantNom} — ${o.mois} ${o.annee}</p>
  </div>
  <div class="alert-band">
    <div class="txt">${titre} — votre autorisation est requise.</div>
  </div>
  <div class="body">
    <p style="color:#374151;font-size:14px;margin:0 0 8px">
      Bonjour <strong>${o.dirNom || 'Directeur'}</strong>,<br/>
      ${o.caissierNom ? `<strong>${o.caissierNom}</strong> souhaite enregistrer une sortie de caisse. ` : ''}${raison}
    </p>
    <div class="detail">
      <p style="font-weight:700;color:#0f172a;font-size:13px;margin:0 0 10px">📋 Détails de la dépense</p>
      <table>
        <tr><td>Rubrique</td><td>${o.rubriqueCode}</td></tr>
        <tr><td>Intitulé</td><td>${o.intitule}</td></tr>
        <tr><td>Bénéficiaire</td><td>${o.beneficiaire || '—'}</td></tr>
        <tr><td>Montant</td><td style="color:#dc2626;font-size:15px">${fmtN(o.sortie)}</td></tr>${depassementRow}
      </table>
    </div>
    <p style="color:#374151;font-size:13px">
      Connectez-vous à l'application pour <strong>approuver ou rejeter</strong> cette dépense
      depuis l'écran « Dépenses en attente ».
    </p>
    <a class="action-btn" href="${o.appUrl || process.env.APP_URL || 'http://localhost:3000'}">
      Voir dans CaissePro
    </a>
  </div>
  <div class="footer">
    CaissePro v2 — ${o.tenantNom}<br/>
    Mouvement #${o.mouvementId} — ${new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'})}
  </div>
</div>
</body>
</html>`;

  try {
    await transporter.sendMail({
      from:    `"CaissePro — ${o.tenantNom}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to:      o.dirEmail,
      subject: `⏳ Dépense en attente — ${o.rubriqueCode} (${o.mois} ${o.annee})`,
      html,
    });
    console.log(`[Email] Alerte attente envoyée à ${o.dirEmail}`);
    return { sent: true };
  } catch (err) {
    console.error('[Email] Erreur envoi (attente) :', err.message);
    return { sent: false, reason: err.message };
  }
};

// ── Prospects / démonstration (réforme prospects) ─────────────────────────
// Retour normalisé : { statut: 'envoye' | 'non_envoye' | 'adresse_invalide', erreur }.
// Jamais de mot de passe dans un e-mail : uniquement un lien d'activation.
const echapper = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dateFr = (d) => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

const gabarit = (titre, corps) => `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,sans-serif;background:#f8fafc;margin:0;padding:0">
<div style="max-width:600px;margin:30px auto;background:white;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden">
  <div style="background:linear-gradient(135deg,#1e293b,#0f172a);padding:24px 30px;text-align:center">
    <h1 style="color:white;margin:0;font-size:20px">${echapper(process.env.APP_NAME || 'NJ Caisse Pro')}</h1>
    <p style="color:rgba(255,255,255,.65);margin:6px 0 0;font-size:13px">${echapper(titre)}</p>
  </div>
  <div style="padding:26px 30px;font-size:14px;color:#1e293b;line-height:1.6">${corps}</div>
  <div style="background:#f8fafc;padding:14px 30px;font-size:11px;color:#64748b;text-align:center">
    ${echapper(process.env.CABINET_NAME || '')} · Compte de DÉMONSTRATION — données fictives, ne pas y saisir de données réelles.
  </div>
</div></body></html>`;

const envoyer = async ({ to, subject, html }) => {
  const transporter = createTransporter();
  if (!transporter) return { statut: 'non_envoye', erreur: 'SMTP non configuré (SMTP_HOST vide)' };
  try {
    await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, html });
    return { statut: 'envoye', erreur: '' };
  } catch (err) {
    const invalide = err.code === 'EENVELOPE' || /recipient|address|550|553|501/i.test(err.message || '');
    return { statut: invalide ? 'adresse_invalide' : 'non_envoye', erreur: err.message };
  }
};

const contenuInvitation = ({ nom, lien, debut, fin, contact }) => ({
  subject: `Votre accès de démonstration à ${process.env.APP_NAME || 'NJ Caisse Pro'}`,
  html: gabarit('Accès de démonstration', `
    <p>Bonjour ${echapper(nom)},</p>
    <p>Vous êtes invité(e) à découvrir <strong>${echapper(process.env.APP_NAME || 'NJ Caisse Pro')}</strong>,
       la plateforme de gestion de caisse du cabinet.</p>
    <p style="text-align:center;margin:26px 0">
      <a href="${echapper(lien)}" style="background:#2563eb;color:white;padding:12px 26px;border-radius:8px;text-decoration:none;font-weight:bold">Activer mon accès</a>
    </p>
    <p><strong>Première connexion :</strong> le bouton ouvre une page où vous choisissez votre mot de passe.
       Votre identifiant est votre adresse e-mail. Ce lien est personnel, utilisable une seule fois et valable 72 heures.</p>
    <p><strong>Période de démonstration :</strong> du ${dateFr(debut)} au ${dateFr(fin)}.</p>
    <p><strong>Disponible :</strong> caisses et journaux, saisie des mouvements, report à nouveau, budgets et prévisions,
       appels de fonds, tableau de bord, rapports, plan comptable OHADA de démonstration.</p>
    <p><strong>Limites :</strong> espace de test isolé, 2 utilisateurs maximum, aucune donnée réelle ; l'accès se ferme
       automatiquement à la fin de la période.</p>
    ${contact ? `<p>Contact : ${echapper(contact)}</p>` : ''}
    <p style="font-size:12px;color:#64748b">Si le bouton ne fonctionne pas, copiez ce lien : ${echapper(lien)}</p>`),
});

const sendInvitationDemo = (opts) => envoyer({ to: opts.to, ...contenuInvitation(opts) });

const TEXTES_RAPPEL = {
  avant: (fin) => [`Votre démonstration se termine le ${dateFr(fin)}`, `Votre accès de démonstration se termine le <strong>${dateFr(fin)}</strong>. Contactez-nous pour passer à un forfait et conserver votre accès.`],
  jour:  (fin) => ['Votre démonstration se termine aujourd\'hui', `Votre accès de démonstration se termine aujourd'hui (${dateFr(fin)}). Contactez-nous pour poursuivre avec un forfait.`],
  apres: (fin) => ['Votre démonstration est terminée', `Votre période de démonstration s'est terminée le ${dateFr(fin)}. Vos données de test sont conservées temporairement : contactez-nous pour prolonger ou adhérer.`],
};
const sendRappelDemo = ({ to, nom, type, fin, contact }) => {
  const [sujet, texte] = TEXTES_RAPPEL[type](fin);
  return envoyer({ to, subject: sujet, html: gabarit('Démonstration', `<p>Bonjour ${echapper(nom)},</p><p>${texte}</p>${contact ? `<p>Contact : ${echapper(contact)}</p>` : ''}`) });
};
const sendNotificationAdmin = ({ to, sujet, lignes }) => envoyer({
  to, subject: sujet, html: gabarit('Notification interne', `<ul>${lignes.map((l) => `<li>${echapper(l)}</li>`).join('')}</ul>`),
});

module.exports = {
  sendInvitationDemo, sendRappelDemo, sendNotificationAdmin, contenuInvitation, sendDepassementAlert, sendMouvementAttenteAlert };
