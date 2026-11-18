// src/middleware/auth.js
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

// Rôles « cabinet » : comptes du cabinet qui administrent plusieurs clients.
const ROLES_CABINET = ['super_admin', 'comptable_cabinet'];

/**
 * Guard JWT — vérifie le token Bearer puis RECHARGE l'utilisateur en base.
 * Injecte req.user = { id, username, role, tenantId }.
 *
 * Le JWT ne sert plus qu'à prouver l'identité (sub). Le rôle, le client et
 * l'état actif sont lus en base à chaque requête : auparavant ils venaient du
 * token, si bien qu'un compte désactivé, supprimé ou rétrogradé gardait ses
 * anciens droits jusqu'à l'expiration du token (8 h par défaut), et que
 * l'interface (rôle frais via /auth/me) et l'API (rôle figé du token)
 * appliquaient deux règles différentes.
 */
// ── Comptes de démonstration (réforme prospects) ─────────────────────────
// L'expiration est contrôlée ICI, côté serveur, à chaque requête : la date de
// fin ne dépend pas du navigateur. Les colonnes viennent de la migration 023 ;
// tant qu'elle n'est pas appliquée (démarrage en cours), le contrôle est neutre.
let colonnesDemo = null;      // null = inconnu, true/false = détecté
let colonnesDemoVerifie = 0;
const aColonnesDemo = async () => {
  if (colonnesDemo === true) return true;
  if (Date.now() - colonnesDemoVerifie < 60e3 && colonnesDemo !== null) return colonnesDemo;
  const { rows } = await query(
    "SELECT 1 FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'demo_expire_le'");
  colonnesDemo = rows.length > 0;
  colonnesDemoVerifie = Date.now();
  return colonnesDemo;
};

/** Date de fin si le client est un espace de démo expiré, sinon null. */
const demoExpiree = async (tenantId) => {
  if (!tenantId || !(await aColonnesDemo())) return null;
  const { rows } = await query(
    "SELECT demo_expire_le FROM tenants WHERE id = $1 AND type_compte = 'demo' AND demo_expire_le <= NOW()",
    [tenantId]);
  if (!rows[0]) return null;
  // Statut du prospect mis à jour sans attendre la tâche quotidienne.
  require('../services/prospects.service').marquerExpires({ tenantId })
    .catch((e) => console.error('[Auth] expiration démo :', e.message));
  return rows[0].demo_expire_le;
};

const messageDemoExpiree = (fin) => ({
  error: `Votre période de démonstration s'est terminée le ${new Date(fin).toLocaleDateString('fr-FR')}. `
    + 'Contactez le cabinet pour la prolonger ou souscrire un forfait.',
  code: 'DEMO_EXPIREE',
});

const authGuard = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant ou invalide.' });
  }

  let payload;
  try {
    payload = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expirée. Veuillez vous reconnecter.' });
    }
    return res.status(401).json({ error: 'Token invalide.' });
  }

  try {
    const { rows } = await query(
      'SELECT id, username, role, tenant_id, actif FROM users WHERE id = $1',
      [payload.sub]
    );
    const u = rows[0];
    if (!u || !u.actif) {
      return res.status(401).json({ error: 'Compte désactivé ou supprimé. Veuillez vous reconnecter.' });
    }
    // 067 (lot D) : la session du jeton doit être active (ni fermée, ni
    // remplacée, ni révoquée, ni expirée par inactivité).
    const refus = await require('../services/sessions.service').controler({ sid: payload.sid || null, userId: u.id });
    if (refus) return res.status(401).json({ error: refus.message, code: refus.code });
    const fin = await demoExpiree(u.tenant_id);
    if (fin) return res.status(403).json(messageDemoExpiree(fin));
    req.user = {
      id:       u.id,
      username: u.username,
      role:     u.role,
      tenantId: u.tenant_id || null,
      sessionId: payload.sid || null,
    };
    next();
  } catch (err) {
    console.error('[Auth] chargement utilisateur :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

/**
 * Usine de guards par rôle — réservée à l'IDENTITÉ (cabinet / client),
 * jamais aux fonctionnalités, qui passent par requirePermission.
 * Ex: requireRole('super_admin')
 */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Non authentifié.' });
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({
      error: `Accès refusé. Rôles requis : ${roles.join(', ')}.`,
    });
  }
  next();
};

/**
 * Appartenance au cabinet : super_admin, ou comptable_cabinet NON rattaché à
 * un client. Un « comptable_cabinet » créé à l'intérieur d'un client (ce que
 * l'API permettait) n'est pas un membre du cabinet et ne doit voir ni la liste
 * des clients ni les droits des autres clients.
 */
const isCabinet = (user) => Boolean(user) && (
  user.role === 'super_admin' || (user.role === 'comptable_cabinet' && !user.tenantId)
);

const requireCabinet = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Non authentifié.' });
  if (!isCabinet(req.user)) return res.status(403).json({ error: 'Accès réservé au cabinet.' });
  next();
};

module.exports = { demoExpiree, messageDemoExpiree, authGuard, requireRole, requireCabinet, isCabinet, ROLES_CABINET };
