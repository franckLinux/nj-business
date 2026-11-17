// src/controllers/auth.controller.js
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { query } = require('../config/database');
const { demoExpiree, messageDemoExpiree } = require('../middleware/auth');
const { getEffectivePermissions, getPermissionsAccordees } = require('../services/permission.service');
const { modulesPourSession } = require('../services/modules.service');

/**
 * POST /api/auth/login
 */
const login = async (req, res) => {
  const { username, password } = req.body;

  try {
    const { rows } = await query(
      `SELECT u.id, u.username, u.password_hash, u.role, u.tenant_id, u.actif,
              t.nom AS tenant_nom, t.slug AS tenant_slug, t.devise,
              -- to_jsonb : sans erreur si la migration 023 n'est pas encore jouée
              to_jsonb(t)->>'type_compte' AS type_compte, to_jsonb(t)->>'demo_expire_le' AS demo_expire_le,
              (to_jsonb(u)->>'activite_obligatoire')::boolean IS TRUE AS activite_obligatoire
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       WHERE u.username = $1
          -- Comptes de démo : identifiant = e-mail, insensible à la casse.
          OR (position('@' in $1) > 0 AND lower(u.username) = lower($1))
       ORDER BY (u.username = $1) DESC
       LIMIT 1`,
      [username.trim()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect.' });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect.' });
    }
    // Contrôles APRÈS le mot de passe : ne rien révéler de l'état d'un compte
    // à qui ne connaît pas son mot de passe.
    if (!user.actif) {
      return res.status(403).json({ error: 'Compte désactivé. Contactez votre administrateur.' });
    }
    const finDemo = await demoExpiree(user.tenant_id);
    if (finDemo) return res.status(403).json(messageDemoExpiree(finDemo));

    // Génération JWT
    const tokenPayload = {
      sub:      user.id,
      username: user.username,
      role:     user.role,
      tenantId: user.tenant_id,
    };

    const accessToken = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    });

    // Mise à jour dernière connexion
    await query('UPDATE users SET derniere_connexion = NOW() WHERE id = $1', [user.id]);

    const permissions = await getEffectivePermissions({ tenantId: user.tenant_id, userId: user.id, role: user.role });
    const permissionsAccordees = await getPermissionsAccordees(user.id);
    // NJ BUSINESS (048) : modules de l'espace client (null = système non installé).
    const modules = await modulesPourSession(user.tenant_id, { userId: user.id, role: user.role });

    res.json({
      accessToken,
      user: {
        id:          user.id,
        username:    user.username,
        role:        user.role,
        tenantId:    user.tenant_id,
        tenantNom:   user.tenant_nom,
        tenantSlug:  user.tenant_slug,
        devise:      user.devise || process.env.DEVISE || 'FCFA',
        type_compte:    user.type_compte || 'client',
        demo_expire_le: user.demo_expire_le || null,
        activite_obligatoire: Boolean(user.activite_obligatoire), // 039
        permissionsAccordees, // exceptions individuelles 'grant' (affichage des onglets)
        permissions, // null = pas de restriction configurée (rôle fixe seul) ; tableau = liste exclusive
        modules,     // 048 : [{ code, nom, statut, actif, … }] ; null = système de modules non installé
      },
    });
  } catch (err) {
    console.error('[Auth] Erreur login :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

/**
 * GET /api/auth/me
 */
const me = async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.username, u.role, u.tenant_id, u.derniere_connexion,
              t.nom AS tenant_nom, t.slug AS tenant_slug, t.devise, t.logo_url,
              to_jsonb(t)->>'type_compte' AS type_compte, to_jsonb(t)->>'demo_expire_le' AS demo_expire_le,
              (to_jsonb(u)->>'activite_obligatoire')::boolean IS TRUE AS activite_obligatoire
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = $1`,
      [req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    const u = rows[0];
    // Le plafond appliqué doit être celui du client CONSULTÉ, exactement comme
    // le fait requirePermission (req.tenantId = en-tête X-Tenant-Id pour le
    // cabinet). Sans cela, un membre du cabinet positionné sur un client voyait
    // des onglets (calculés sans plafond) que l'API lui refusait ensuite (403).
    const enTete = req.get('X-Tenant-Id');
    const uuidValide = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const tenantContexte = u.tenant_id || (enTete && uuidValide.test(enTete) ? enTete : null);
    const permissions = await getEffectivePermissions({ tenantId: tenantContexte, userId: u.id, role: u.role });
    const permissionsAccordees = await getPermissionsAccordees(u.id);
    // Modules du client CONSULTÉ (même contexte que les permissions).
    const modules = await modulesPourSession(tenantContexte, { userId: u.id, role: u.role });
    res.json({ ...u, permissions, permissionsAccordees, modules });
  } catch (err) {
    console.error('[Auth] /me :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

/**
 * POST /api/auth/change-password
 */
const changePassword = async (req, res) => {
  const { ancienPassword, nouveauPassword } = req.body;

  try {
    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const valid = await bcrypt.compare(ancienPassword, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Ancien mot de passe incorrect.' });

    const hash = await bcrypt.hash(nouveauPassword, parseInt(process.env.BCRYPT_ROUNDS) || 12);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);

    res.json({ message: 'Mot de passe modifié avec succès.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── Mot de passe oublié (C9) ──────────────────────────────────────────────
// Réponse identique que le compte existe ou non (pas d'énumération des
// comptes). Jeton aléatoire envoyé par e-mail, seul son hash est stocké ;
// valable 1 heure et une seule fois.
const crypto = require('crypto');
const { sendReinitialisationMotDePasse } = require('../services/email.service');
const hashJeton = (j) => crypto.createHash('sha256').update(String(j)).digest('hex');
const MSG_OUBLI = 'Si un compte actif correspond à cet identifiant, un e-mail contenant un lien de réinitialisation vient d\'être envoyé. Pensez à vérifier vos courriers indésirables.';

const motDePasseOublie = async (req, res) => {
  const identifiant = String(req.body?.identifiant || '').trim();
  if (!identifiant) return res.status(400).json({ error: 'Indiquez votre identifiant ou votre adresse e-mail.' });
  try {
    const { rows } = await query(
      `SELECT id, username, email FROM users
        WHERE actif = true AND (username = $1 OR lower(email) = lower($1) OR lower(username) = lower($1))
        LIMIT 1`, [identifiant]);
    const u = rows[0];
    const email = u && (u.email || (u.username.includes('@') ? u.username : ''));
    if (u && email) {
      const jeton = crypto.randomBytes(32).toString('base64url');
      await query('UPDATE password_resets SET utilise_le = NOW() WHERE user_id = $1 AND utilise_le IS NULL', [u.id]);
      await query(`INSERT INTO password_resets (user_id, token_hash, expire_le) VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
        [u.id, hashJeton(jeton)]);
      const base = String(process.env.APP_URL || '').split(',')[0].trim().replace(/\/+$/, '') || `${req.protocol}://${req.get('host')}`;
      const r = await sendReinitialisationMotDePasse({ to: email, nom: u.username, lien: `${base}/reinitialisation/${jeton}` });
      if (r.statut !== 'envoye') console.warn('[Auth] e-mail de réinitialisation non envoyé :', r.erreur);
    }
    res.json({ message: MSG_OUBLI });
  } catch (err) {
    console.error('[Auth] motDePasseOublie :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

const lireJeton = async (jeton) => {
  const { rows } = await query(
    `SELECT r.id, r.user_id, u.username FROM password_resets r JOIN users u ON u.id = r.user_id
      WHERE r.token_hash = $1 AND r.utilise_le IS NULL AND r.expire_le > NOW() AND u.actif = true`, [hashJeton(jeton)]);
  return rows[0] || null;
};

const verifierReinitialisation = async (req, res) => {
  try {
    const r = await lireJeton(req.params.jeton);
    if (!r) return res.status(410).json({ error: 'Ce lien n\'est plus valable (déjà utilisé ou expiré). Refaites une demande.' });
    res.json({ identifiant: r.username });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

const reinitialiserMotDePasse = async (req, res) => {
  const mdp = String(req.body?.mot_de_passe || '');
  if (mdp.length < 8 || !/[A-Za-z]/.test(mdp) || !/\d/.test(mdp)) {
    return res.status(400).json({ error: '8 caractères minimum, avec au moins une lettre et un chiffre.' });
  }
  try {
    const r = await lireJeton(req.params.jeton);
    if (!r) return res.status(410).json({ error: 'Ce lien n\'est plus valable (déjà utilisé ou expiré). Refaites une demande.' });
    const hash = await bcrypt.hash(mdp, parseInt(process.env.BCRYPT_ROUNDS, 10) || 12);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, r.user_id]);
    await query('UPDATE password_resets SET utilise_le = NOW() WHERE user_id = $1 AND utilise_le IS NULL', [r.user_id]);
    res.json({ message: 'Mot de passe modifié. Vous pouvez vous connecter.', identifiant: r.username });
  } catch (err) {
    console.error('[Auth] reinitialiserMotDePasse :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = { login, me, changePassword, motDePasseOublie, verifierReinitialisation, reinitialiserMotDePasse };
