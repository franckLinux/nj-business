// src/services/prospects.service.js — Prospects et comptes de démonstration
// (réforme prospects, étapes 1 à 3).
//
// Principes :
//  * un prospect testant l'application reçoit un ESPACE DE DÉMO = un client
//    (tenant) type_compte = 'demo' : l'isolation par tenant_id s'applique
//    telle quelle, aucune donnée réelle n'y est visible ;
//  * l'accès se fait par un lien d'activation : jeton aléatoire de 256 bits,
//    seul son condensé SHA-256 est stocké, usage unique, durée limitée ;
//  * l'expiration est contrôlée côté serveur (middleware/auth.js + login) ;
//  * rien n'est jamais supprimé automatiquement : à l'expiration ou à
//    l'annulation, l'espace est fermé et ses données conservées.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { sequelize } = require('../models');
const { ErreurMetier } = require('./plateforme.service');
const email = require('./email.service');
const { seedRubriquesDefaut } = require('../controllers/rubriques.controller');
const { seedJournauxDefaut } = require('../controllers/journaux.controller');

const SELECT = sequelize.QueryTypes.SELECT;
const STATUTS = ['PROSPECT', 'CONTACTE', 'INTERESSE', 'INVITATION_ENVOYEE', 'DEMO_ACTIVE', 'DEMO_EXPIREE',
  'PAIEMENT_EN_ATTENTE', 'CLIENT_ACTIF', 'DEMO_ANNULEE', 'PROSPECT_ABANDONNE'];
const ETAPES_AVANT_DEMO = ['PROSPECT', 'CONTACTE', 'INTERESSE'];
const STATUTS_FERMES = ['DEMO_ANNULEE', 'PROSPECT_ABANDONNE', 'CLIENT_ACTIF'];
const VALIDITE_LIEN_H = 72;
const MAX_USERS_DEMO = 2;
const CONSERVATION_JOURS = parseInt(process.env.DEMO_CONSERVATION_JOURS, 10) || 90;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Le prospect ne peut pas créer de profils métier dans son espace de test.
const PERMISSIONS_EXCLUES_DEMO = ['roles.edit'];

const hash = (jeton) => crypto.createHash('sha256').update(String(jeton)).digest('hex');
const urlFront = () => (process.env.APP_URL || 'http://localhost:5173').split(',')[0].trim().replace(/\/+$/, '');
const contactCabinet = () => process.env.DEMO_CONTACT || process.env.SMTP_FROM || '';
const q = (sql, replacements, opts = {}) => sequelize.query(sql, { replacements, type: SELECT, ...opts });
const ex = (sql, replacements, opts = {}) => sequelize.query(sql, { replacements, ...opts });

const historiser = (t, { prospectId, ancien, nouveau, action, motif = '', details = {}, userId = null }) => ex(
  `INSERT INTO prospect_historique (prospect_id, ancien_statut, nouveau_statut, action, motif, details, user_id)
   VALUES (:prospectId, :ancien, :nouveau, :action, :motif, CAST(:details AS jsonb), :userId)`,
  { prospectId, ancien: ancien || null, nouveau: nouveau || null, action, motif, details: JSON.stringify(details), userId },
  { transaction: t });

const auditer = (t, { tenantId = null, userId = null, action, entiteId, avant = null, apres = null }) => ex(
  `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, ancienne_valeur, nouvelle_valeur)
   VALUES (:tenantId, :userId, :action, 'prospect', :entiteId, CAST(:avant AS jsonb), CAST(:apres AS jsonb))`,
  { tenantId, userId, action, entiteId, avant: avant && JSON.stringify(avant), apres: apres && JSON.stringify(apres) },
  { transaction: t });

const charger = async (id, t, verrou = false) => {
  const [p] = await q(`SELECT * FROM prospects WHERE id = :id ${verrou ? 'FOR UPDATE' : ''}`, { id }, { transaction: t });
  if (!p) throw new ErreurMetier(404, 'Prospect introuvable.');
  return p;
};

// ── Expiration (paresseuse + tâche quotidienne) ───────────────────────────
// Passe en DEMO_EXPIREE les démos dont la date de fin est dépassée.
// Renvoie les prospects expirés à l'instant (pour la notification interne).
const marquerExpires = async ({ tenantId = null } = {}) => sequelize.transaction(async (t) => {
  const expires = await q(
    `UPDATE prospects SET statut = 'DEMO_EXPIREE', updated_at = NOW()
      WHERE statut IN ('DEMO_ACTIVE','INVITATION_ENVOYEE') AND demo_fin <= NOW()
        AND (CAST(:tenantId AS uuid) IS NULL OR tenant_id = CAST(:tenantId AS uuid))
      RETURNING id, nom_complet, entreprise, email, demo_fin, tenant_id`,
    { tenantId }, { transaction: t });
  for (const p of expires) {
    await historiser(t, { prospectId: p.id, ancien: null, nouveau: 'DEMO_EXPIREE', action: 'EXPIRATION_AUTOMATIQUE' });
    await ex(`UPDATE prospect_invitations SET annule_le = NOW()
               WHERE prospect_id = :id AND utilise_le IS NULL AND annule_le IS NULL`, { id: p.id }, { transaction: t });
    if (p.tenant_id) {
      await ex(`UPDATE tenants SET donnees_conservees_jusqu_au = COALESCE(donnees_conservees_jusqu_au, NOW() + make_interval(days => :j))
                 WHERE id = :id`, { id: p.tenant_id, j: CONSERVATION_JOURS }, { transaction: t });
    }
  }
  return expires;
});

// ── Liste ──────────────────────────────────────────────────────────────────
const TRIS = { nom: 'lower(p.nom_complet)', entreprise: 'lower(p.entreprise)', statut: 'p.statut',
  demo_fin: 'p.demo_fin', created_at: 'p.created_at' };

const lister = async ({ commercialId = null, recherche = '', statut = '', aTraiter = '', tri = 'created_at', ordre = 'desc', page = 1, taille = 20 }) => {
  await marquerExpires();
  page = Math.max(1, parseInt(page, 10) || 1);
  taille = Math.min(100, Math.max(5, parseInt(taille, 10) || 20));
  const col = TRIS[tri] || TRIS.created_at;
  const sens = String(ordre).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const where = `WHERE (:statut = '' OR p.statut = :statut)
    AND (CAST(:commercialId AS uuid) IS NULL OR p.commercial_id = CAST(:commercialId AS uuid))
    AND (:aTraiter = false OR NOT p.demande_traitee)
    AND (:r = '' OR p.nom_complet ILIKE :like OR p.entreprise ILIKE :like OR p.email ILIKE :like
         OR p.telephone ILIKE :like OR p.ville ILIKE :like)`;
  const rep = { statut: STATUTS.includes(statut) ? statut : '', r: String(recherche).trim(), aTraiter: String(aTraiter) === '1', commercialId,
    like: `%${String(recherche).trim().replace(/[%_\\]/g, '\\$&')}%`, lim: taille, off: (page - 1) * taille };
  const items = await q(
    `SELECT p.id, p.nom_complet, p.entreprise, p.email, p.telephone, p.ville, p.pays, p.statut,
            p.demo_debut, p.demo_fin, p.forfait_envisage, p.created_at, p.tenant_id,
            p.source, p.demande_web_le, p.demande_traitee,
            (SELECT i.statut_email FROM prospect_invitations i WHERE i.prospect_id = p.id
              ORDER BY i.created_at DESC LIMIT 1) AS statut_email,
            (SELECT u.derniere_connexion FROM users u WHERE u.id = p.user_id) AS derniere_connexion
       FROM prospects p ${where}
      ORDER BY ${col} ${sens} NULLS LAST, p.created_at DESC
      LIMIT :lim OFFSET :off`, rep);
  const [{ total }] = await q(`SELECT COUNT(*)::int AS total FROM prospects p ${where}`, rep);
  const perim = 'WHERE (CAST(:c AS uuid) IS NULL OR commercial_id = CAST(:c AS uuid))';
  const compteurs = await q(`SELECT statut, COUNT(*)::int AS n FROM prospects ${perim} GROUP BY statut`, { c: commercialId });
  const [{ n: aTraiterNb }] = await q(`SELECT COUNT(*)::int AS n FROM prospects ${perim} AND NOT demande_traitee`, { c: commercialId });
  return { items, total, page, taille, a_traiter: aTraiterNb,
    compteurs: Object.fromEntries(compteurs.map((c) => [c.statut, c.n])) };
};

// ── Détail ─────────────────────────────────────────────────────────────────
const detail = async (id) => {
  const p = await charger(id);
  const historique = await q(
    `SELECT h.*, u.username AS auteur FROM prospect_historique h LEFT JOIN users u ON u.id = h.user_id
      WHERE h.prospect_id = :id ORDER BY h.created_at DESC, h.id DESC`, { id });
  const invitations = await q(
    `SELECT id, expire_le, utilise_le, annule_le, statut_email, erreur_email, envoye_le, est_renvoi, created_at,
            CASE WHEN utilise_le IS NOT NULL THEN 'utilisee'
                 WHEN annule_le  IS NOT NULL THEN 'annulee'
                 WHEN expire_le <= NOW()     THEN 'expiree'
                 ELSE 'valide' END AS etat
       FROM prospect_invitations WHERE prospect_id = :id ORDER BY created_at DESC`, { id });
  let espace = null;
  if (p.tenant_id) {
    [espace] = await q(
      `SELECT t.id, t.nom, t.slug, t.actif, t.type_compte, t.demo_expire_le, t.donnees_conservees_jusqu_au,
              (SELECT COUNT(*)::int FROM users u WHERE u.tenant_id = t.id) AS nb_utilisateurs,
              (SELECT COUNT(*)::int FROM journal j WHERE j.tenant_id = t.id) AS nb_mouvements,
              (SELECT MAX(u.derniere_connexion) FROM users u WHERE u.tenant_id = t.id) AS dernier_acces
         FROM tenants t WHERE t.id = :id`, { id: p.tenant_id });
  }
  const paiements = await q(
    `SELECT pa.*, f.nom AS forfait_nom, u.username AS auteur FROM paiements pa
       LEFT JOIN forfaits f ON f.id = pa.forfait_id LEFT JOIN users u ON u.id = pa.created_by
      WHERE pa.prospect_id = :id ORDER BY pa.date_paiement DESC, pa.created_at DESC`, { id });
  const abonnements = await q(
    `SELECT a.*, t.nom AS client_nom FROM abonnements a JOIN tenants t ON t.id = a.tenant_id
      WHERE a.prospect_id = :id ORDER BY a.created_at DESC`, { id });
  return { ...p, historique, invitations, espace, paiements, abonnements };
};

// ── Création / modification ───────────────────────────────────────────────
const CHAMPS = ['nom_complet', 'entreprise', 'email', 'telephone', 'pays', 'ville', 'secteur', 'type_entreprise',
  'nb_utilisateurs', 'nb_points_vente', 'besoins', 'forfait_envisage', 'demo_debut', 'demo_fin', 'notes', 'source'];

const nettoyer = (d, existant = {}) => {
  const v = {};
  for (const c of CHAMPS) {
    if (d[c] === undefined) continue;
    if (['nb_utilisateurs', 'nb_points_vente'].includes(c)) {
      const n = d[c] === '' || d[c] === null ? null : parseInt(d[c], 10);
      if (n !== null && (!Number.isInteger(n) || n < 0 || n > 100000)) throw new ErreurMetier(400, `Valeur invalide pour ${c}.`);
      v[c] = n;
    } else if (['demo_debut', 'demo_fin'].includes(c)) {
      const dt = new Date(d[c]);
      if (Number.isNaN(dt.getTime())) throw new ErreurMetier(400, 'Date de démonstration invalide.');
      v[c] = dt.toISOString();
    } else {
      v[c] = String(d[c] ?? '').trim().slice(0, c === 'besoins' || c === 'notes' ? 4000 : 200);
    }
  }
  if (v.email !== undefined) {
    v.email = v.email.toLowerCase() || null; // facultatif (prospect « terrain »)
    if (v.email && !EMAIL_RE.test(v.email)) throw new ErreurMetier(400, 'Adresse e-mail invalide.');
  }
  const final = { ...existant, ...v };
  if (!String(final.nom_complet || '').trim() && !String(final.entreprise || '').trim()) {
    throw new ErreurMetier(400, 'Indiquez au moins le nom complet ou l\'entreprise.');
  }
  if (!final.email && !String(final.telephone || '').trim()) {
    throw new ErreurMetier(400, 'Indiquez au moins un téléphone ou une adresse e-mail.');
  }
  // Dates de démo par défaut (ajustées au moment de l'envoi de l'accès).
  if (!final.demo_debut && !existant.id) { v.demo_debut = new Date().toISOString(); final.demo_debut = v.demo_debut; }
  if (!final.demo_fin && !existant.id) {
    v.demo_fin = new Date(new Date(final.demo_debut).getTime() + DUREE_DEMO_JOURS * 864e5).toISOString();
    final.demo_fin = v.demo_fin;
  }
  if (!final.demo_debut || !final.demo_fin) throw new ErreurMetier(400, 'Dates de début et de fin de démonstration obligatoires.');
  if (new Date(final.demo_fin) <= new Date(final.demo_debut)) {
    throw new ErreurMetier(400, 'La date de fin doit être postérieure à la date de début.');
  }
  return v;
};

// Doublon par téléphone (9 derniers chiffres : +237 6xx… = 6xx…).
const chiffres = (tel) => String(tel || '').replace(/\D/g, '').slice(-9);
const verifierTelephoneLibre = async (tel, saufId, t) => {
  const c = chiffres(tel);
  if (c.length < 8) return;
  const [doublon] = await q(
    `SELECT id, statut FROM prospects
      WHERE right(regexp_replace(telephone, '\\D', '', 'g'), 9) = :c
        AND (CAST(:id AS uuid) IS NULL OR id <> CAST(:id AS uuid)) LIMIT 1`,
    { c, id: saufId || null }, { transaction: t });
  if (doublon) {
    const e = new ErreurMetier(409, `Un prospect existe déjà avec ce numéro de téléphone (statut ${doublon.statut}).`);
    e.existing_id = doublon.id;
    throw e;
  }
};

const verifierEmailLibre = async (mail, saufId, t) => {
  if (!mail) return;
  const [doublon] = await q(
    `SELECT id, statut FROM prospects WHERE lower(btrim(email)) = :m AND (CAST(:id AS uuid) IS NULL OR id <> CAST(:id AS uuid))`,
    { m: mail, id: saufId || null }, { transaction: t });
  if (doublon) {
    const e = new ErreurMetier(409, `Un prospect existe déjà avec cette adresse e-mail (statut ${doublon.statut}).`);
    e.existing_id = doublon.id;
    throw e;
  }
  const [compte] = await q('SELECT 1 FROM users WHERE lower(username) = :m OR lower(email) = :m LIMIT 1', { m: mail }, { transaction: t });
  if (compte) throw new ErreurMetier(409, 'Cette adresse e-mail est déjà utilisée par un compte utilisateur existant.');
};

const creer = async ({ donnees, userId, commercialId = null }) => sequelize.transaction(async (t) => {
  const v = nettoyer(donnees);
  await verifierEmailLibre(v.email, null, t);
  await verifierTelephoneLibre(v.telephone, null, t);
  if (commercialId) v.commercial_id = commercialId;
  if (donnees.source !== undefined) v.source = String(donnees.source || '').trim().slice(0, 60);
  const cols = Object.keys(v);
  const [p] = await q(
    `INSERT INTO prospects (${cols.join(', ')}, created_by)
     VALUES (${cols.map((c) => `:${c}`).join(', ')}, :userId) RETURNING *`,
    { ...v, userId }, { transaction: t });
  await historiser(t, { prospectId: p.id, nouveau: 'PROSPECT', action: 'CREATION', userId });
  await auditer(t, { userId, action: 'PROSPECT_CREATION', entiteId: p.id, apres: { email: p.email, entreprise: p.entreprise } });
  return p;
});

const modifier = async ({ id, donnees, userId }) => sequelize.transaction(async (t) => {
  const p = await charger(id, t, true);
  if (STATUTS_FERMES.includes(p.statut)) throw new ErreurMetier(409, 'Ce prospect est clôturé : modification impossible.');
  // Les dates passent par la prolongation (motif + confirmation), pas ici,
  // une fois l'accès envoyé.
  const d = { ...donnees };
  if (!['PROSPECT', 'CONTACTE', 'INTERESSE'].includes(p.statut)) { delete d.demo_debut; delete d.demo_fin; }
  if (p.user_id) delete d.email; // l'e-mail est devenu l'identifiant de connexion
  const v = nettoyer(d, p);
  if (v.email && v.email !== p.email) await verifierEmailLibre(v.email, id, t);
  if (v.telephone && chiffres(v.telephone) !== chiffres(p.telephone)) await verifierTelephoneLibre(v.telephone, id, t);
  const cols = Object.keys(v);
  if (!cols.length) return p;
  const [maj] = await q(
    `UPDATE prospects SET ${cols.map((c) => `${c} = :${c}`).join(', ')}, demande_traitee = true, updated_at = NOW() WHERE id = :id RETURNING *`,
    { ...v, id }, { transaction: t });
  const avant = Object.fromEntries(cols.map((c) => [c, p[c]]));
  await historiser(t, { prospectId: id, ancien: p.statut, nouveau: p.statut, action: 'MODIFICATION', details: { avant, apres: v }, userId });
  return maj;
});

// ── Espace de démonstration ───────────────────────────────────────────────
const creerEspaceDemo = async (t, p, userId) => {
  const nom = `${p.entreprise || p.nom_complet} (démo)`.slice(0, 120);
  const slug = `demo-${crypto.randomBytes(5).toString('hex')}`;
  const [tenant] = await q(
    `INSERT INTO tenants (slug, nom, devise, type_compte, demo_expire_le, contact_nom, contact_email,
                          contact_telephone, pays, ville)
     VALUES (:slug, :nom, 'FCFA', 'demo', :fin, :cnom, :cmail, :ctel, :pays, :ville) RETURNING id`,
    { slug, nom, fin: p.demo_fin, cnom: p.nom_complet, cmail: p.email, ctel: p.telephone, pays: p.pays, ville: p.ville },
    { transaction: t });
  await seedRubriquesDefaut(tenant.id, { transaction: t });
  await seedJournauxDefaut(tenant.id, { transaction: t });
  const [fn] = await q("SELECT 1 AS ok FROM pg_proc WHERE proname = 'plan_client_initialiser'", {}, { transaction: t });
  if (fn) await q('SELECT plan_client_initialiser(:id, NULL, :userId)', { id: tenant.id, userId }, { transaction: t });

  // Plafond de l'espace : permissions du directeur, sans la gestion des profils.
  await ex(
    `INSERT INTO tenant_permissions (tenant_id, permission_code)
     SELECT :id, rp.permission_code FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id AND r.tenant_id IS NULL AND r.is_system AND r.code = 'directeur'
      WHERE rp.permission_code NOT IN (:exclues)
     ON CONFLICT DO NOTHING`, { id: tenant.id, exclues: PERMISSIONS_EXCLUES_DEMO }, { transaction: t });

  // Compte du prospect : identifiant = e-mail, INACTIF tant que le lien n'est
  // pas utilisé. Mot de passe aléatoire jamais communiqué (remplacé à l'activation).
  const leurre = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
  const [user] = await q(
    `INSERT INTO users (tenant_id, username, email, password_hash, role, actif)
     VALUES (:tid, :mail, :mail, :pw, 'directeur', false) RETURNING id`,
    { tid: tenant.id, mail: p.email, pw: leurre }, { transaction: t });
  await auditer(t, { tenantId: tenant.id, userId, action: 'DEMO_ESPACE_CREATION', entiteId: p.id, apres: { slug, nom } });
  return { tenantId: tenant.id, userIdProspect: user.id };
};

// ── Invitation (création de l'espace + lien d'activation + e-mail) ────────
const inviter = async ({ id, userId }) => {
  const r = await sequelize.transaction(async (t) => {
    const p = await charger(id, t, true);
    if (!['PROSPECT', 'CONTACTE', 'INTERESSE', 'INVITATION_ENVOYEE'].includes(p.statut)) {
      throw new ErreurMetier(409, `Envoi impossible au statut ${p.statut}.`
        + (p.statut === 'DEMO_EXPIREE' ? ' Prolongez d\'abord la démonstration.' : ''));
    }
    if (!p.email) throw new ErreurMetier(400, 'Renseignez l\'adresse e-mail du prospect : elle sert d\'identifiant de connexion à la démo.');
    // Démo pas encore ouverte et dates dépassées (prospect suivi depuis
    // longtemps) : la période démarre aujourd'hui.
    if (!p.tenant_id && new Date(p.demo_fin) <= new Date(Date.now() + 864e5)) {
      const debut = new Date();
      const fin = new Date(debut.getTime() + DUREE_DEMO_JOURS * 864e5);
      await ex('UPDATE prospects SET demo_debut = :d, demo_fin = :f WHERE id = :id',
        { d: debut.toISOString(), f: fin.toISOString(), id }, { transaction: t });
      p.demo_debut = debut.toISOString(); p.demo_fin = fin.toISOString();
    } else if (new Date(p.demo_fin) <= new Date()) {
      throw new ErreurMetier(409, 'La période de démonstration est déjà terminée : prolongez-la avant l\'envoi.');
    }
    let { tenant_id: tenantId, user_id: prospectUserId } = p;
    if (!tenantId) {
      const [compte] = await q('SELECT 1 FROM users WHERE lower(username) = :m LIMIT 1', { m: p.email }, { transaction: t });
      if (compte) throw new ErreurMetier(409, 'Cette adresse e-mail est déjà l\'identifiant d\'un compte existant.');
      ({ tenantId, userIdProspect: prospectUserId } = await creerEspaceDemo(t, p, userId));
    }
    const estRenvoi = (await q('SELECT 1 FROM prospect_invitations WHERE prospect_id = :id LIMIT 1', { id }, { transaction: t })).length > 0;
    await ex(`UPDATE prospect_invitations SET annule_le = NOW()
               WHERE prospect_id = :id AND utilise_le IS NULL AND annule_le IS NULL`, { id }, { transaction: t });
    const jeton = crypto.randomBytes(32).toString('base64url');
    const expire = new Date(Math.min(Date.now() + VALIDITE_LIEN_H * 3600e3, new Date(p.demo_fin).getTime()));
    const [inv] = await q(
      `INSERT INTO prospect_invitations (prospect_id, token_hash, expire_le, est_renvoi, created_by)
       VALUES (:id, :h, :exp, :renvoi, :userId) RETURNING id`,
      { id, h: hash(jeton), exp: expire.toISOString(), renvoi: estRenvoi, userId }, { transaction: t });
    await ex(`UPDATE prospects SET statut = 'INVITATION_ENVOYEE', tenant_id = :tid, user_id = :uid, demande_traitee = true, updated_at = NOW()
               WHERE id = :id`, { id, tid: tenantId, uid: prospectUserId }, { transaction: t });
    await ex('UPDATE tenants SET actif = true, demo_expire_le = :fin WHERE id = :tid', { tid: tenantId, fin: p.demo_fin }, { transaction: t });
    await historiser(t, { prospectId: id, ancien: p.statut, nouveau: 'INVITATION_ENVOYEE',
      action: estRenvoi ? 'INVITATION_RENVOYEE' : 'INVITATION_CREEE', details: { expire_le: expire }, userId });
    return { p, jeton, invId: inv.id, estRenvoi, expire };
  });

  // Envoi APRÈS validation : un échec SMTP n'annule pas l'espace créé.
  const lien = `${urlFront()}/activation/${r.jeton}`;
  const envoi = await email.sendInvitationDemo({
    to: r.p.email, nom: r.p.nom_complet || r.p.entreprise, lien,
    debut: r.p.demo_debut, fin: r.p.demo_fin, contact: contactCabinet(),
  });
  const statutEmail = envoi.statut === 'envoye' && r.estRenvoi ? 'renvoye' : envoi.statut;
  await ex(`UPDATE prospect_invitations SET statut_email = :s, erreur_email = :e,
              envoye_le = CASE WHEN :s IN ('envoye','renvoye') THEN NOW() ELSE NULL END WHERE id = :id`,
  { s: statutEmail, e: envoi.erreur || '', id: r.invId });
  await sequelize.transaction((t) => historiser(t, { prospectId: id, ancien: 'INVITATION_ENVOYEE', nouveau: 'INVITATION_ENVOYEE',
    action: 'EMAIL_' + statutEmail.toUpperCase(), details: { erreur: envoi.erreur || '' }, userId }));
  return {
    statut_email: statutEmail,
    erreur_email: envoi.erreur || '',
    expire_le: r.expire,
    // Le lien n'est montré à l'administrateur que si l'e-mail n'est pas parti,
    // pour qu'il le transmette lui-même. Il n'est stocké nulle part.
    lien: ['envoye', 'renvoye'].includes(statutEmail) ? null : lien,
  };
};

const apercuEmail = ({ nom, debut, fin }) => email.contenuInvitation({
  nom: nom || 'Madame, Monsieur', lien: `${urlFront()}/activation/…`,
  debut: debut || new Date(), fin: fin || new Date(Date.now() + 14 * 864e5), contact: contactCabinet(),
});

// ── Activation (public, par le prospect) ──────────────────────────────────
const invitationValide = async (jeton, t, verrou = false) => {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(String(jeton || ''))) throw new ErreurMetier(404, 'Lien d\'activation invalide.');
  const [inv] = await q(
    `SELECT i.*, p.nom_complet, p.entreprise, p.email, p.demo_debut, p.demo_fin, p.statut, p.user_id, p.tenant_id
       FROM prospect_invitations i JOIN prospects p ON p.id = i.prospect_id
      WHERE i.token_hash = :h ${verrou ? 'FOR UPDATE OF i, p' : ''}`, { h: hash(jeton) }, { transaction: t });
  // Message volontairement identique : ne pas révéler si le lien a existé.
  if (!inv) throw new ErreurMetier(404, 'Lien d\'activation invalide.');
  if (inv.utilise_le) throw new ErreurMetier(410, 'Ce lien a déjà été utilisé. Connectez-vous avec votre adresse e-mail et votre mot de passe.');
  if (inv.annule_le) throw new ErreurMetier(410, 'Ce lien a été annulé ou remplacé par un envoi plus récent.');
  if (new Date(inv.expire_le) <= new Date()) throw new ErreurMetier(410, 'Ce lien a expiré. Demandez un nouvel envoi au cabinet.');
  if (inv.statut !== 'INVITATION_ENVOYEE' || new Date(inv.demo_fin) <= new Date()) {
    throw new ErreurMetier(410, 'Cette démonstration n\'est plus disponible. Contactez le cabinet.');
  }
  return inv;
};

const verifierActivation = async (jeton) => {
  const inv = await invitationValide(jeton);
  return { nom: inv.nom_complet || inv.entreprise, entreprise: inv.entreprise, identifiant: inv.email,
    demo_debut: inv.demo_debut, demo_fin: inv.demo_fin, lien_expire_le: inv.expire_le };
};

const activer = async ({ jeton, motDePasse }) => {
  const mdp = String(motDePasse || '');
  if (mdp.length < 8 || !/[A-Za-z]/.test(mdp) || !/\d/.test(mdp)) {
    throw new ErreurMetier(400, 'Mot de passe trop faible : 8 caractères minimum, avec au moins une lettre et un chiffre.');
  }
  const h = await bcrypt.hash(mdp, parseInt(process.env.BCRYPT_ROUNDS, 10) || 12);
  return sequelize.transaction(async (t) => {
    const inv = await invitationValide(jeton, t, true);
    await ex('UPDATE users SET password_hash = :h, actif = true WHERE id = :u', { h, u: inv.user_id }, { transaction: t });
    await ex('UPDATE prospect_invitations SET utilise_le = NOW() WHERE id = :id', { id: inv.id }, { transaction: t });
    await ex(`UPDATE prospect_invitations SET annule_le = NOW()
               WHERE prospect_id = :p AND id <> :id AND utilise_le IS NULL AND annule_le IS NULL`,
    { p: inv.prospect_id, id: inv.id }, { transaction: t });
    await ex("UPDATE prospects SET statut = 'DEMO_ACTIVE', updated_at = NOW() WHERE id = :p", { p: inv.prospect_id }, { transaction: t });
    await historiser(t, { prospectId: inv.prospect_id, ancien: inv.statut, nouveau: 'DEMO_ACTIVE', action: 'ACTIVATION', userId: inv.user_id });
    await auditer(t, { tenantId: inv.tenant_id, userId: inv.user_id, action: 'DEMO_ACTIVATION', entiteId: inv.prospect_id });
    return { identifiant: inv.email };
  });
};

// ── Prolongation ──────────────────────────────────────────────────────────
const prolonger = async ({ id, nouvelleFin, motif, userId }) => sequelize.transaction(async (t) => {
  const p = await charger(id, t, true);
  if (STATUTS_FERMES.includes(p.statut) || p.statut === 'PAIEMENT_EN_ATTENTE') {
    throw new ErreurMetier(409, `Prolongation impossible au statut ${p.statut}.`);
  }
  if (!String(motif || '').trim()) throw new ErreurMetier(400, 'Le motif de la prolongation est obligatoire.');
  const fin = new Date(nouvelleFin);
  if (Number.isNaN(fin.getTime())) throw new ErreurMetier(400, 'Nouvelle date de fin invalide.');
  if (fin <= new Date(p.demo_fin)) throw new ErreurMetier(400, 'La nouvelle date doit être postérieure à la date de fin actuelle.');
  if (fin <= new Date()) throw new ErreurMetier(400, 'La nouvelle date de fin doit être dans le futur.');

  let statut = p.statut;
  if (p.statut === 'DEMO_EXPIREE') {
    const [activee] = await q('SELECT 1 FROM prospect_invitations WHERE prospect_id = :id AND utilise_le IS NOT NULL LIMIT 1', { id }, { transaction: t });
    // Démo jamais activée : on revient à PROSPECT, l'administrateur renverra un lien.
    statut = activee ? 'DEMO_ACTIVE' : 'PROSPECT';
  }
  await ex(`UPDATE prospects SET demo_fin = :fin, statut = :statut, rappel_avant_le = NULL, rappel_jour_le = NULL,
              rappel_apres_le = NULL, updated_at = NOW() WHERE id = :id`, { fin: fin.toISOString(), statut, id }, { transaction: t });
  if (p.tenant_id) {
    await ex(`UPDATE tenants SET demo_expire_le = :fin, donnees_conservees_jusqu_au = NULL, actif = true
               WHERE id = :tid AND type_compte = 'demo'`, { fin: fin.toISOString(), tid: p.tenant_id }, { transaction: t });
  }
  const details = { ancienne_fin: p.demo_fin, nouvelle_fin: fin.toISOString() };
  await historiser(t, { prospectId: id, ancien: p.statut, nouveau: statut, action: 'PROLONGATION', motif: String(motif).trim(), details, userId });
  await auditer(t, { tenantId: p.tenant_id, userId, action: 'DEMO_PROLONGATION', entiteId: id,
    avant: { demo_fin: p.demo_fin }, apres: { demo_fin: fin.toISOString(), motif: String(motif).trim() } });
  return charger(id, t);
});

// ── Changement de statut manuel ───────────────────────────────────────────
const TRANSITIONS = {
  DEMO_ANNULEE:        ['PROSPECT', 'CONTACTE', 'INTERESSE', 'INVITATION_ENVOYEE', 'DEMO_ACTIVE', 'DEMO_EXPIREE', 'PAIEMENT_EN_ATTENTE'],
  PROSPECT_ABANDONNE:  ['PROSPECT', 'CONTACTE', 'INTERESSE', 'INVITATION_ENVOYEE', 'DEMO_ACTIVE', 'DEMO_EXPIREE', 'PAIEMENT_EN_ATTENTE'],
  PAIEMENT_EN_ATTENTE: ['DEMO_ACTIVE', 'DEMO_EXPIREE'],
  PROSPECT:            ['DEMO_ANNULEE', 'PROSPECT_ABANDONNE'], // réouverture
};

const changerStatut = async ({ id, statut, motif, userId }) => sequelize.transaction(async (t) => {
  const p = await charger(id, t, true);
  if (!TRANSITIONS[statut]) throw new ErreurMetier(400, 'Statut non modifiable manuellement.');
  if (!TRANSITIONS[statut].includes(p.statut)) throw new ErreurMetier(409, `Passage de ${p.statut} à ${statut} impossible.`);
  if (!String(motif || '').trim()) throw new ErreurMetier(400, 'Le motif est obligatoire.');

  if (['DEMO_ANNULEE', 'PROSPECT_ABANDONNE'].includes(statut)) {
    // Fermeture : liens invalidés, accès coupé, données CONSERVÉES (aucune suppression).
    await ex(`UPDATE prospect_invitations SET annule_le = NOW()
               WHERE prospect_id = :id AND utilise_le IS NULL AND annule_le IS NULL`, { id }, { transaction: t });
    if (p.tenant_id) {
      await ex(`UPDATE tenants SET actif = false, suspension_motif = :m,
                  donnees_conservees_jusqu_au = NOW() + make_interval(days => :j)
                 WHERE id = :tid AND type_compte = 'demo'`,
      { tid: p.tenant_id, m: `Démo fermée : ${String(motif).trim()}`.slice(0, 300), j: CONSERVATION_JOURS }, { transaction: t });
      await ex('UPDATE users SET actif = false WHERE tenant_id = :tid', { tid: p.tenant_id }, { transaction: t });
    }
  }
  let nouveau = statut;
  if (statut === 'PROSPECT' && p.tenant_id) {
    // Réouverture d'un prospect déjà équipé d'un espace : on le rouvre fermé ;
    // l'administrateur prolonge ou renvoie un lien selon le cas.
    nouveau = new Date(p.demo_fin) <= new Date() ? 'DEMO_EXPIREE' : 'PROSPECT';
    await ex('UPDATE tenants SET suspension_motif = NULL WHERE id = :tid', { tid: p.tenant_id }, { transaction: t });
  }
  await ex('UPDATE prospects SET statut = :s, demande_traitee = true, updated_at = NOW() WHERE id = :id', { s: nouveau, id }, { transaction: t });
  await historiser(t, { prospectId: id, ancien: p.statut, nouveau, action: 'CHANGEMENT_STATUT', motif: String(motif).trim(), userId });
  await auditer(t, { tenantId: p.tenant_id, userId, action: 'PROSPECT_STATUT', entiteId: id,
    avant: { statut: p.statut }, apres: { statut: nouveau, motif: String(motif).trim() } });
  return charger(id, t);
});

// ── Demande de démo depuis la page publique ───────────────────────────────
// Rien n'est créé côté accès : la demande arrive en PROSPECT « à traiter » et
// le cabinet décide d'envoyer (ou non) l'accès. Réponse identique dans tous
// les cas (nouvelle demande, doublon, compte existant) : la page publique ne
// doit pas permettre de savoir si une adresse est connue.
const DUREE_DEMO_JOURS = parseInt(process.env.DEMO_DUREE_JOURS, 10) || 14;
const CHAMPS_WEB = ['nom_complet', 'entreprise', 'email', 'telephone', 'pays', 'ville', 'secteur',
  'type_entreprise', 'nb_utilisateurs', 'nb_points_vente', 'besoins'];

const notifierCabinet = async (sujet, lignes) => {
  const dest = process.env.DEMO_NOTIF_EMAIL
    || (await q("SELECT string_agg(email, ',') AS e FROM users WHERE role = 'super_admin' AND actif AND email LIKE '%@%'"))[0]?.e;
  if (!dest) return 'aucun_destinataire';
  return (await email.sendNotificationAdmin({ to: dest, sujet, lignes })).statut;
};

const demandeWeb = async (corps) => {
  // Champ piège invisible pour les humains : un robot le remplit.
  if (String(corps.site_web || '').trim()) return { ok: true };
  if (corps.consentement !== true) throw new ErreurMetier(400, 'Merci d\'accepter d\'être recontacté(e) par le cabinet.');
  if (!String(corps.telephone || '').trim()) throw new ErreurMetier(400, 'Le téléphone est obligatoire.');
  const d = Object.fromEntries(CHAMPS_WEB.filter((c) => corps[c] !== undefined).map((c) => [c, corps[c]]));
  const debut = new Date();
  const v = nettoyer({ ...d, demo_debut: debut, demo_fin: new Date(debut.getTime() + DUREE_DEMO_JOURS * 864e5) });

  const res = await sequelize.transaction(async (t) => {
    const [existant] = await q('SELECT id, statut FROM prospects WHERE lower(btrim(email)) = :m FOR UPDATE',
      { m: v.email }, { transaction: t });
    if (existant) {
      await ex('UPDATE prospects SET demande_web_le = NOW(), demande_traitee = false, updated_at = NOW() WHERE id = :id',
        { id: existant.id }, { transaction: t });
      await historiser(t, { prospectId: existant.id, ancien: existant.statut, nouveau: existant.statut,
        action: 'NOUVELLE_DEMANDE_WEB', details: { message: v.besoins || '', telephone: v.telephone || '' } });
      return { nouveau: false, statut: existant.statut };
    }
    const [compte] = await q('SELECT 1 FROM users WHERE lower(username) = :m OR lower(email) = :m LIMIT 1', { m: v.email }, { transaction: t });
    if (compte) return { compteExistant: true };
    const cols = Object.keys(v);
    const [p] = await q(
      `INSERT INTO prospects (${cols.join(', ')}, source, demande_web_le, demande_traitee)
       VALUES (${cols.map((c) => `:${c}`).join(', ')}, 'Formulaire web', NOW(), false) RETURNING id`, v, { transaction: t });
    await historiser(t, { prospectId: p.id, nouveau: 'PROSPECT', action: 'DEMANDE_WEB' });
    return { nouveau: true };
  });

  const qui = `${v.entreprise || v.nom_complet} <${v.email}> — ${v.telephone || ''} ${v.ville || ''}`.trim();
  const sujet = res.compteExistant ? 'Demande de démo : adresse déjà cliente'
    : res.nouveau ? 'Nouvelle demande de démonstration' : 'Nouvelle demande d\'un prospect déjà connu';
  notifierCabinet(sujet, [qui, ...(v.besoins ? [`Besoins : ${v.besoins}`] : []),
    ...(res.statut ? [`Statut actuel : ${res.statut}`] : []), 'À traiter dans « Prospects & démos ».'])
    .catch((e) => console.error('[Prospects] notification demande web :', e.message));
  return { ok: true };
};

// ── Limite d'utilisateurs d'un espace de démo (users.controller) ──────────
const verifierLimiteUtilisateursDemo = async (tenantId) => {
  if (!tenantId) return;
  const [t] = await q(
    `SELECT t.type_compte, (SELECT COUNT(*)::int FROM users u WHERE u.tenant_id = t.id) AS n
       FROM tenants t WHERE t.id = :id`, { id: tenantId }).catch(() => []);
  if (t && t.type_compte === 'demo' && t.n >= MAX_USERS_DEMO) {
    throw new ErreurMetier(403, `Espace de démonstration : ${MAX_USERS_DEMO} utilisateurs maximum.`);
  }
};

// ── Tâche quotidienne (cron cPanel → /api/taches/quotidiennes) ───────────
const tachesQuotidiennes = async () => {
  const expires = await marquerExpires();
  const bilan = { expires: expires.length, rappels: { avant: 0, jour: 0, apres: 0 }, echecs: 0, notification_admin: null };
  bilan.smtp = Boolean(process.env.SMTP_HOST);
  const joursAvant = parseInt(process.env.DEMO_RAPPEL_JOURS_AVANT, 10) || 3;
  const lots = {
    avant: await q(`SELECT * FROM prospects WHERE statut = 'DEMO_ACTIVE' AND rappel_avant_le IS NULL
                     AND demo_fin > NOW() + INTERVAL '1 day' AND demo_fin <= NOW() + make_interval(days => :j)`, { j: joursAvant }),
    jour:  await q(`SELECT * FROM prospects WHERE statut = 'DEMO_ACTIVE' AND rappel_jour_le IS NULL
                     AND demo_fin > NOW() AND demo_fin <= NOW() + INTERVAL '1 day'`),
    apres: await q(`SELECT * FROM prospects WHERE statut = 'DEMO_EXPIREE' AND rappel_apres_le IS NULL
                     AND demo_fin > NOW() - INTERVAL '30 days'`),
  };
  // Sans SMTP, aucun rappel n'est tenté (ni historisé) : ils partiront dès
  // que le SMTP sera configuré, les dates de rappel restant vides.
  for (const [type, liste] of Object.entries(bilan.smtp ? lots : {})) {
    for (const p of liste) {
      const r = await email.sendRappelDemo({ to: p.email, nom: p.nom_complet || p.entreprise, type, fin: p.demo_fin, contact: contactCabinet() });
      // Le rappel n'est marqué envoyé que s'il est parti : il sera retenté demain sinon.
      if (r.statut === 'envoye') {
        await ex(`UPDATE prospects SET rappel_${type}_le = NOW() WHERE id = :id`, { id: p.id });
        bilan.rappels[type] += 1;
      } else bilan.echecs += 1;
      await sequelize.transaction((t) => historiser(t, { prospectId: p.id, ancien: p.statut, nouveau: p.statut,
        action: `RAPPEL_${type.toUpperCase()}`, details: { statut_email: r.statut, erreur: r.erreur || '' } }));
    }
  }
  if (expires.length) {
    bilan.notification_admin = await notifierCabinet(`${expires.length} démonstration(s) expirée(s)`,
      expires.map((p) => `${p.entreprise || p.nom_complet} <${p.email}> — fin le ${new Date(p.demo_fin).toLocaleDateString('fr-FR')}`));
  }
  return bilan;
};

module.exports = {
  STATUTS, ErreurMetier, lister, detail, creer, modifier, inviter, apercuEmail, verifierActivation, activer,
  prolonger, changerStatut, marquerExpires, demandeWeb, notifierCabinet, historiser, auditer, charger, CONSERVATION_JOURS, tachesQuotidiennes, verifierLimiteUtilisateursDemo,
};
