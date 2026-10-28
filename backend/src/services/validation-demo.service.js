// src/services/validation-demo.service.js
// Validation DIRECTE d'une demande de démonstration par un commercial.
//
// Voie classique (inchangée) : la demande du formulaire public arrive en
// PROSPECT « à traiter » ; le Super Admin / la Direction l'accepte en ouvrant
// la démo (prospects.service → inviter).
// Voie directe (migrations 035-036) : sur ce même formulaire, un commercial
// autorisé (permission « prospects.validation_directe ») saisit son identifiant
// et son CODE PERSONNEL : la demande est acceptée sur-le-champ — prospect créé,
// attribué au commercial, démo ouverte — par la MÊME logique métier
// (preparerInvitation / envoyerInvitation) que la voie classique.
//
// Sécurité des codes :
//  * jamais stockés en clair : bcrypt( HMAC-SHA256(poivre, code) ) — le poivre
//    (VALIDATION_CODE_PEPPER, à défaut JWT_SECRET) n'est pas en base ;
//  * code personnel, 1 seul en cours par personne ; expiration, limite
//    d'utilisations, désactivation, révocation ;
//  * 5 codes faux consécutifs → blocage 15 min ; débit limité par adresse IP ;
//  * identifiant inconnu et code faux donnent la MÊME réponse ; l'état du code
//    (expiré, non autorisé…) n'est révélé qu'à qui a saisi le bon code ;
//  * chaque tentative est tracée (prospect_validations + audit_log), jamais le code.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { sequelize } = require('../models');
const pr = require('./prospects.service');
const { ErreurMetier } = require('./plateforme.service');
const { userHasPermission, getBasePermissions } = require('./permission.service');

const SELECT = sequelize.QueryTypes.SELECT;
const q = (sql, replacements, opts = {}) => sequelize.query(sql, { replacements, type: SELECT, ...opts });
const ex = (sql, replacements, opts = {}) => sequelize.query(sql, { replacements, ...opts });

const PERMISSION = 'prospects.validation_directe';
const MAX_ECHECS = parseInt(process.env.VALIDATION_CODE_MAX_ECHECS, 10) || 5;
const BLOCAGE_MIN = parseInt(process.env.VALIDATION_CODE_BLOCAGE_MIN, 10) || 15;
const CODE_RE = /^[A-Za-z0-9]{6,12}$/;

const estDirection = (u) => u.role === 'super_admin' || (u.role === 'comptable_cabinet' && !u.tenantId);

// ── Empreinte d'un code ──────────────────────────────────────────────────
const poivre = () => {
  const p = process.env.VALIDATION_CODE_PEPPER || process.env.JWT_SECRET || '';
  if (p.length < 16) throw new Error('VALIDATION_CODE_PEPPER (ou JWT_SECRET) absent ou trop court.');
  return p;
};
const hmac = (code) => crypto.createHmac('sha256', poivre()).update(String(code)).digest('hex');
const empreinte = (code) => bcrypt.hash(hmac(code), parseInt(process.env.BCRYPT_ROUNDS, 10) || 12);
const codeCorrect = (code, hash) => bcrypt.compare(hmac(code), hash);

// Codes trop faibles refusés à la création (suites, répétitions).
const codeFaible = (c) => /^(.)\1+$/.test(c)
  || '0123456789012345678901'.includes(c) || '9876543210987654321098'.includes(c)
  || /^(azerty|qwerty|password|motdepasse)/i.test(c);

// ── Journal ──────────────────────────────────────────────────────────────
const tracer = (t, { prospectId, user, methode, resultat, motif = '', codeId = null, ctx = {}, libelle = '' }) => ex(
  `INSERT INTO prospect_validations (prospect_id, user_id, username, methode, resultat, motif, code_id, ip_address, user_agent, prospect_libelle)
   VALUES (:p, :u, :n, :m, :r, :motif, :c, :ip, :ua, :lib)`,
  { p: prospectId || null, u: user?.id || null, n: user?.username || '', m: methode, r: resultat, motif: String(motif).slice(0, 300),
    lib: String(libelle || '').slice(0, 200),
    c: codeId, ip: String(ctx.ip || '').slice(0, 64), ua: String(ctx.userAgent || '').slice(0, 300) },
  t ? { transaction: t } : {});

const auditer = (t, { user, action, prospectId, details }) => ex(
  `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, nouvelle_valeur)
   VALUES (NULL, :u, :a, 'prospect', :id, CAST(:v AS jsonb))`,
  { u: user?.id || null, a: action, id: prospectId ? String(prospectId) : null, v: JSON.stringify(details || {}) },
  t ? { transaction: t } : {});

// ── Validation directe d'une demande de démo (formulaire public) ─────────
const MSG_INCORRECT = 'Identifiant ou code de validation incorrect.';
const MSG_INUTILISABLE = 'Votre code de validation est expiré, désactivé ou épuisé : contactez le Super Admin. Vous pouvez aussi envoyer la demande normalement.';
const MSG_NON_AUTORISE = 'Votre compte n\'est pas autorisé à valider directement une demande de démonstration. Envoyez la demande normalement.';
const heureLocale = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: process.env.TZ_AFFICHAGE || 'Africa/Douala' });

const validerDemandeAvecCode = async ({ corps = {}, identifiant, code, ctx = {} }) => {
  const v = pr.lireDemandeWeb(corps);          // mêmes contrôles que la demande normale
  if (!v) return { ok: true };                 // robot (champ piège) : rien n'est fait
  const libelle = `${v.entreprise || v.nom_complet || ''}${v.email ? ` <${v.email}>` : ''}`;
  const ident = String(identifiant || '').trim().toLowerCase().slice(0, 120);
  const saisi = String(code ?? '').trim();
  if (!ident || !saisi) throw new ErreurMetier(400, 'Saisissez votre identifiant et votre code de validation.');

  // Une seule transaction : verrou sur le code (tentatives concurrentes
  // sérialisées), vérification, création du prospect et ouverture de la démo.
  // Un échec est RENVOYÉ (pas levé) pour que le compteur d'échecs soit validé.
  const r = await sequelize.transaction(async (t) => {
    // L'unicité (tenant_id, username) ne s'applique pas aux comptes cabinet
    // (tenant NULL) : en cas d'homonymes, on retient celui qui a un code.
    const [u] = await q(
      `SELECT u.id, u.username, u.role FROM users u
        WHERE u.tenant_id IS NULL AND u.actif AND u.role IN ('commercial', 'comptable_cabinet')
          AND (lower(u.username) = :i OR lower(u.email) = :i)
        ORDER BY (lower(u.username) = :i) DESC,
                 EXISTS (SELECT 1 FROM codes_validation_demo c WHERE c.user_id = u.id AND c.revoque_le IS NULL) DESC,
                 u.created_at DESC
        LIMIT 1`, { i: ident }, { transaction: t });
    if (!u) return { refus: 400, motif: 'IDENTIFIANT_INCONNU', essai: ident };
    const [c] = await q(`SELECT * FROM codes_validation_demo WHERE user_id = :u AND revoque_le IS NULL FOR UPDATE`,
      { u: u.id }, { transaction: t });
    if (!c) return { refus: 400, motif: 'AUCUN_CODE', user: u };
    if (c.bloque_jusqu_au && new Date(c.bloque_jusqu_au) > new Date()) {
      return { refus: 429, motif: 'BLOQUE', user: u, codeId: c.id, jusqua: c.bloque_jusqu_au };
    }
    if (!CODE_RE.test(saisi) || !(await codeCorrect(saisi, c.code_hash))) {
      const echecs = c.tentatives_echouees + 1;
      const bloque = echecs >= MAX_ECHECS;
      await ex(
        `UPDATE codes_validation_demo SET tentatives_echouees = :n, updated_at = NOW(),
                bloque_jusqu_au = CASE WHEN :b THEN NOW() + make_interval(mins => :m) ELSE bloque_jusqu_au END
          WHERE id = :id`, { n: bloque ? 0 : echecs, b: bloque, m: BLOCAGE_MIN, id: c.id }, { transaction: t });
      return { refus: bloque ? 429 : 400, motif: bloque ? 'CODE_INCORRECT_BLOCAGE' : 'CODE_INCORRECT', user: u, codeId: c.id };
    }
    // Code correct : l'état du code et la permission peuvent être annoncés.
    await ex('UPDATE codes_validation_demo SET tentatives_echouees = 0, updated_at = NOW() WHERE id = :id', { id: c.id }, { transaction: t });
    if (!(await userHasPermission({ tenantId: null, userId: u.id, role: u.role }, PERMISSION))) {
      return { refus: 403, motif: 'PERMISSION_ABSENTE', user: u, codeId: c.id, message: MSG_NON_AUTORISE };
    }
    if (!c.actif) return { refus: 403, motif: 'CODE_INACTIF', user: u, codeId: c.id, message: MSG_INUTILISABLE };
    if (c.expire_le && new Date(c.expire_le) <= new Date()) return { refus: 403, motif: 'CODE_EXPIRE', user: u, codeId: c.id, message: MSG_INUTILISABLE };
    if (c.limite_utilisations && c.nb_utilisations >= c.limite_utilisations) {
      return { refus: 403, motif: 'LIMITE_ATTEINTE', user: u, codeId: c.id, message: MSG_INUTILISABLE };
    }
    // Prospect déjà connu / adresse déjà utilisée : la demande ne se valide pas
    // ici (le commercial authentifié peut le savoir).
    const [existant] = await q('SELECT id, statut FROM prospects WHERE lower(btrim(email)) = :m LIMIT 1', { m: v.email }, { transaction: t });
    if (existant) {
      return { refus: 409, motif: 'PROSPECT_EXISTANT', user: u, codeId: c.id, prospectId: existant.id,
        message: `Ce prospect est déjà connu du cabinet (statut ${existant.statut}) : ouvrez sa démonstration depuis l'application.` };
    }
    const [compte] = await q('SELECT 1 FROM users WHERE lower(username) = :m OR lower(email) = :m LIMIT 1', { m: v.email }, { transaction: t });
    if (compte) {
      return { refus: 409, motif: 'COMPTE_EXISTANT', user: u, codeId: c.id,
        message: 'Cette adresse e-mail est déjà utilisée par un compte de l\'application : la démonstration ne peut pas être ouverte avec elle.' };
    }
    try {
      await pr.verifierTelephoneLibre(v.telephone, null, t);
    } catch (e) {
      if (e instanceof ErreurMetier) return { refus: 409, motif: 'TELEPHONE_EXISTANT', user: u, codeId: c.id, message: `${e.message} Ouvrez sa démonstration depuis l'application.` };
      throw e;
    }

    // Succès : utilisation du code, prospect créé et attribué, démo ouverte.
    await ex(`UPDATE codes_validation_demo SET bloque_jusqu_au = NULL, nb_utilisations = nb_utilisations + 1,
                derniere_utilisation_le = NOW(), updated_at = NOW() WHERE id = :id`, { id: c.id }, { transaction: t });
    const cols = Object.keys(v);
    const [p] = await q(
      `INSERT INTO prospects (${cols.join(', ')}, source, demande_web_le, demande_traitee, commercial_id, created_by)
       VALUES (${cols.map((k) => `:${k}`).join(', ')}, 'Formulaire web', NOW(), true, :uid, :uid) RETURNING id, statut`,
      { ...v, uid: u.id }, { transaction: t });
    await pr.historiser(t, { prospectId: p.id, nouveau: 'PROSPECT', action: 'DEMANDE_WEB_VALIDEE_PAR_CODE',
      details: { message: v.besoins || '', telephone: v.telephone || '' }, userId: u.id });
    const inv = await pr.preparerInvitation(t, { id: p.id, userId: u.id });
    await tracer(t, { prospectId: p.id, user: u, methode: 'DIRECT_CODE', resultat: 'SUCCESS', codeId: c.id, ctx, libelle });
    await auditer(t, { user: u, action: 'DIRECT_PROSPECT_VALIDATION', prospectId: p.id,
      details: { method: 'CODE', status: 'SUCCESS', code_id: c.id, ip: ctx.ip || '' } });
    return { inv, prospectId: p.id, user: u, codeExpire: c.expire_le };
  });

  if (r.refus) {
    const user = r.user || { id: null, username: r.essai ? `(inconnu) ${r.essai}` : '' };
    await tracer(null, { prospectId: r.prospectId || null, user, methode: 'DIRECT_CODE', resultat: 'FAILED', motif: r.motif, codeId: r.codeId || null, ctx, libelle });
    await auditer(null, { user: r.user, action: 'DIRECT_PROSPECT_VALIDATION', prospectId: r.prospectId || null,
      details: { method: 'CODE', status: 'FAILED', reason: r.motif, code_id: r.codeId || null, ip: ctx.ip || '' } }).catch(() => {});
    if (['IDENTIFIANT_INCONNU', 'AUCUN_CODE', 'CODE_INCORRECT'].includes(r.motif)) throw new ErreurMetier(400, MSG_INCORRECT);
    if (r.motif === 'CODE_INCORRECT_BLOCAGE') {
      throw new ErreurMetier(429, `${MSG_INCORRECT} Trop de tentatives : la validation directe est bloquée pendant ${BLOCAGE_MIN} minutes. Vous pouvez envoyer la demande normalement.`);
    }
    if (r.motif === 'BLOQUE') {
      throw new ErreurMetier(429, `Trop de tentatives incorrectes : validation directe bloquée jusqu'à ${heureLocale(r.jusqua)}. Vous pouvez envoyer la demande normalement.`);
    }
    throw new ErreurMetier(r.refus, r.message);
  }

  const envoi = await pr.envoyerInvitation(r.inv, { id: r.prospectId, userId: r.user.id });
  pr.notifierCabinet('Demande de démo validée par un commercial', [
    `${libelle} — validée sur place par ${r.user.username} (code personnel).`,
    `Démo ouverte ; accès ${['envoye', 'renvoye'].includes(envoi.statut_email) ? 'envoyé par e-mail' : 'NON envoyé par e-mail (lien remis par le commercial)'}.`,
  ]).catch((e) => console.error('[Validation démo] notification :', e.message));
  return {
    ok: true, valide: true, email: v.email, commercial: r.user.username,
    statut_email: envoi.statut_email,
    // Page publique : le lien n'est renvoyé que si l'e-mail n'est pas parti.
    lien: ['envoye', 'renvoye'].includes(envoi.statut_email) ? null : envoi.lien,
    // Rappel au commercial : son code doit être renouvelé par le Super Admin.
    code_expire_le: r.codeExpire || null,
  };
};

// Trace d'une validation « classique » (Super Admin / Direction) d'une
// demande web : appelée après l'ouverture de la démo, best-effort.
const tracerValidationClassique = ({ prospectId, user, libelle, ctx = {} }) => tracer(null, {
  prospectId, user, methode: 'SUPER_ADMIN', resultat: 'SUCCESS', ctx, libelle,
}).catch((e) => console.error('[Validation démo] trace :', e.message));

// ── Administration (Super Admin) ─────────────────────────────────────────
const exigerSuperAdmin = (user) => {
  if (user.role !== 'super_admin') throw new ErreurMetier(403, 'Réservé au Super Admin.');
};

// Liste des membres du cabinet concernés : commerciaux et comptables cabinet
// (+ quiconque a déjà un code ou la permission). Jamais de code ni d'empreinte.
const lister = async ({ user }) => {
  exigerSuperAdmin(user);
  const rows = await q(`
    SELECT u.id, u.username, u.email, u.role, u.actif,
           c.id AS code_id, c.actif AS code_actif, c.expire_le, c.limite_utilisations, c.nb_utilisations,
           c.derniere_utilisation_le, c.tentatives_echouees, c.bloque_jusqu_au, c.created_at AS code_cree_le,
           (SELECT COUNT(*)::int FROM prospect_validations v WHERE v.user_id = u.id AND v.methode = 'DIRECT_CODE' AND v.resultat = 'SUCCESS') AS nb_validations,
           (SELECT COUNT(*)::int FROM prospect_validations v WHERE v.user_id = u.id AND v.methode = 'DIRECT_CODE' AND v.resultat = 'FAILED'
               AND v.created_at > NOW() - INTERVAL '30 days') AS echecs_30j
      FROM users u
      LEFT JOIN codes_validation_demo c ON c.user_id = u.id AND c.revoque_le IS NULL
     WHERE u.tenant_id IS NULL AND u.role IN ('commercial', 'comptable_cabinet')
     ORDER BY u.actif DESC, (u.role = 'commercial') DESC, lower(u.username)`);
  const maintenant = new Date();
  for (const r of rows) {
    r.permission = await userHasPermission({ tenantId: null, userId: r.id, role: r.role }, PERMISSION);
    r.etat_code = !r.code_id ? 'aucun'
      : !r.code_actif ? 'desactive'
        : r.expire_le && new Date(r.expire_le) <= maintenant ? 'expire'
          : r.limite_utilisations && r.nb_utilisations >= r.limite_utilisations ? 'epuise'
            : r.bloque_jusqu_au && new Date(r.bloque_jusqu_au) > maintenant ? 'bloque' : 'actif';
    // Jours calendaires restants (date d'expiration − date du jour).
    const jour = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    r.jours_restants = r.code_id && r.expire_le ? Math.round((jour(new Date(r.expire_le)) - jour(maintenant)) / 864e5) : null;
    r.age_jours = r.code_id ? Math.floor((maintenant - new Date(r.code_cree_le)) / 864e5) : null;
    // À renouveler : expiré, épuisé, ou expiration dans moins de ALERTE_JOURS jours.
    r.a_renouveler = !!r.code_id && (['expire', 'epuise'].includes(r.etat_code)
      || (r.jours_restants !== null && r.jours_restants <= ALERTE_JOURS));
  }
  return rows;
};

const cible = async (userId, t) => {
  const [u] = await q(`SELECT id, username, role FROM users WHERE id = :id AND tenant_id IS NULL AND role IN ('commercial', 'comptable_cabinet')`,
    { id: userId }, t ? { transaction: t } : {});
  if (!u) throw new ErreurMetier(404, 'Membre du cabinet introuvable (commercial ou comptable cabinet).');
  return u;
};

// Accorder / retirer la permission (exception individuelle, comme ailleurs).
const definirPermission = async ({ user, userId, autorise }) => {
  exigerSuperAdmin(user);
  return sequelize.transaction(async (t) => {
    const u = await cible(userId, t);
    const base = await getBasePermissions(u.id);
    await ex(`DELETE FROM user_permissions WHERE user_id = :u AND permission_code = :p`, { u: u.id, p: PERMISSION }, { transaction: t });
    if (Boolean(autorise) !== base.includes(PERMISSION)) {
      await ex(`INSERT INTO user_permissions (user_id, permission_code, effet) VALUES (:u, :p, :e)`,
        { u: u.id, p: PERMISSION, e: autorise ? 'grant' : 'deny' }, { transaction: t });
    }
    await auditer(t, { user, action: autorise ? 'VALIDATION_DIRECTE_PERMISSION_ACCORDEE' : 'VALIDATION_DIRECTE_PERMISSION_RETIREE',
      prospectId: null, details: { user_id: u.id, username: u.username } });
    return { autorise: Boolean(autorise) };
  });
};

const lireDate = (v) => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new ErreurMetier(400, 'Date d\'expiration invalide.');
  if (d <= new Date()) throw new ErreurMetier(400, 'La date d\'expiration doit être dans le futur.');
  return d.toISOString();
};
// Renouvellement périodique : durée de validité appliquée quand le Super Admin
// n'en précise pas (VALIDATION_CODE_DUREE_JOURS, 30 par défaut ; 0 = aucune).
const DUREE_DEFAUT_JOURS = (() => {
  const n = parseInt(process.env.VALIDATION_CODE_DUREE_JOURS ?? '30', 10);
  return Number.isInteger(n) && n >= 0 && n <= 3650 ? n : 30;
})();
const ALERTE_JOURS = 7; // « À renouveler » quand l'expiration approche

const lireLimite = (v) => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = parseInt(v, 10);
  if (!Number.isInteger(n) || n < 1 || n > 100000) throw new ErreurMetier(400, 'Limite d\'utilisations invalide.');
  return n;
};

// Nouveau code (remplace et révoque le précédent). Le code est choisi ou
// généré dans le navigateur du Super Admin : l'API le reçoit, en stocke
// l'empreinte et ne le renvoie JAMAIS.
const definirCode = async ({ user, userId, code, expireLe, limite }) => {
  exigerSuperAdmin(user);
  const c = String(code || '').trim();
  if (!CODE_RE.test(c)) throw new ErreurMetier(400, 'Le code doit compter 6 à 12 chiffres ou lettres, sans espace.');
  if (codeFaible(c)) throw new ErreurMetier(400, 'Code trop facile à deviner (suite ou répétition) : choisissez-en un autre.');
  let exp = lireDate(expireLe);
  if (exp === undefined && DUREE_DEFAUT_JOURS) exp = new Date(Date.now() + DUREE_DEFAUT_JOURS * 864e5).toISOString();
  const lim = lireLimite(limite);
  const h = await empreinte(c);
  return sequelize.transaction(async (t) => {
    const u = await cible(userId, t);
    // Changement périodique : le nouveau code doit différer du code en vigueur.
    const [actuel] = await q('SELECT code_hash FROM codes_validation_demo WHERE user_id = :u AND revoque_le IS NULL FOR UPDATE',
      { u: u.id }, { transaction: t });
    if (actuel && await codeCorrect(c, actuel.code_hash)) {
      throw new ErreurMetier(400, 'Le nouveau code doit être différent du code actuel.');
    }
    const anciens = await q(`UPDATE codes_validation_demo SET revoque_le = NOW(), revoque_par = :me, actif = false, updated_at = NOW()
                              WHERE user_id = :u AND revoque_le IS NULL RETURNING id`, { u: u.id, me: user.id }, { transaction: t });
    const [n] = await q(
      `INSERT INTO codes_validation_demo (user_id, code_hash, expire_le, limite_utilisations, cree_par)
       VALUES (:u, :h, :e, :l, :me) RETURNING id, actif, expire_le, limite_utilisations, created_at`,
      { u: u.id, h, e: exp ?? null, l: lim ?? null, me: user.id }, { transaction: t });
    await auditer(t, { user, action: 'VALIDATION_DIRECTE_CODE_CREE', prospectId: null,
      details: { user_id: u.id, username: u.username, code_id: n.id, remplace: anciens.map((a) => a.id), expire_le: n.expire_le } });
    return n;
  });
};

const modifierCode = async ({ user, codeId, actif, expireLe, limite }) => {
  exigerSuperAdmin(user);
  const exp = lireDate(expireLe);
  const lim = lireLimite(limite);
  return sequelize.transaction(async (t) => {
    const [c] = await q('SELECT * FROM codes_validation_demo WHERE id = :id AND revoque_le IS NULL FOR UPDATE', { id: codeId }, { transaction: t });
    if (!c) throw new ErreurMetier(404, 'Code introuvable ou révoqué.');
    const [m] = await q(
      `UPDATE codes_validation_demo SET
          actif = COALESCE(:a, actif),
          expire_le = CASE WHEN :ce THEN CAST(:e AS timestamptz) ELSE expire_le END,
          limite_utilisations = CASE WHEN :cl THEN CAST(:l AS int) ELSE limite_utilisations END,
          updated_at = NOW()
        WHERE id = :id RETURNING id, actif, expire_le, limite_utilisations`,
      { a: actif === undefined ? null : Boolean(actif), ce: exp !== undefined, e: exp ?? null, cl: lim !== undefined, l: lim ?? null, id: codeId },
      { transaction: t });
    await auditer(t, { user, action: 'VALIDATION_DIRECTE_CODE_MODIFIE', prospectId: null,
      details: { code_id: codeId, user_id: c.user_id, actif: m.actif, expire_le: m.expire_le, limite_utilisations: m.limite_utilisations } });
    return m;
  });
};

const revoquerCode = async ({ user, codeId }) => {
  exigerSuperAdmin(user);
  return sequelize.transaction(async (t) => {
    const [c] = await q(`UPDATE codes_validation_demo SET revoque_le = NOW(), revoque_par = :me, actif = false, updated_at = NOW()
                          WHERE id = :id AND revoque_le IS NULL RETURNING id, user_id`, { id: codeId, me: user.id }, { transaction: t });
    if (!c) throw new ErreurMetier(404, 'Code introuvable ou déjà révoqué.');
    await auditer(t, { user, action: 'VALIDATION_DIRECTE_CODE_REVOQUE', prospectId: null, details: { code_id: c.id, user_id: c.user_id } });
    return { revoque: true };
  });
};

const debloquerCode = async ({ user, codeId }) => {
  exigerSuperAdmin(user);
  const [c] = await q(`UPDATE codes_validation_demo SET bloque_jusqu_au = NULL, tentatives_echouees = 0, updated_at = NOW()
                        WHERE id = :id AND revoque_le IS NULL RETURNING id, user_id`, { id: codeId });
  if (!c) throw new ErreurMetier(404, 'Code introuvable ou révoqué.');
  await auditer(null, { user, action: 'VALIDATION_DIRECTE_CODE_DEBLOQUE', prospectId: null, details: { code_id: c.id, user_id: c.user_id } });
  return { debloque: true };
};

const historique = async ({ user, userId = null, resultat = '', limite = 200 }) => {
  exigerSuperAdmin(user);
  return q(`
    SELECT v.id, v.created_at, v.methode, v.resultat, v.motif, v.ip_address, v.user_agent, v.code_id,
           v.username, v.prospect_id, v.prospect_libelle, p.entreprise, p.nom_complet
      FROM prospect_validations v
      LEFT JOIN prospects p ON p.id = v.prospect_id
     WHERE (CAST(:u AS uuid) IS NULL OR v.user_id = CAST(:u AS uuid))
       AND (:r = '' OR v.resultat = :r)
     ORDER BY v.created_at DESC, v.id DESC
     LIMIT :l`, { u: userId || null, r: ['SUCCESS', 'FAILED', 'REQUESTED', 'REJECTED'].includes(resultat) ? resultat : '',
    l: Math.min(500, Math.max(1, parseInt(limite, 10) || 200)) });
};

module.exports = {
  PERMISSION, MAX_ECHECS, BLOCAGE_MIN, DUREE_DEFAUT_JOURS, ALERTE_JOURS, estDirection,
  validerDemandeAvecCode, tracerValidationClassique,
  lister, definirPermission, definirCode, modifierCode, revoquerCode, debloquerCode, historique,
};
