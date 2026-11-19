// src/services/sessions.service.js — NJ BUSINESS : sessions côté serveur (067, lot D).
//
//  • Une session par connexion ; le jeton porte son identifiant (sid). Le serveur
//    vérifie la session à CHAQUE requête : fermée, remplacée, révoquée ou expirée,
//    elle rend son jeton inutilisable immédiatement (invalidation effective).
//  • 068 : UNE session active par compte ET par type d'appareil (ordinateur,
//    mobile) : on peut être connecté sur son ordinateur et sur son téléphone en
//    même temps (réglage par_type_appareil, activé par défaut ; à false : une
//    seule session par compte, tous appareils confondus).
//  • UNE session active par compte (par type d'appareil, voir ci-dessus). Une deuxième connexion est refusée
//    (SESSION_ACTIVE), sauf remplacement explicite : identifiant et mot de passe
//    vérifiés à nouveau, l'ancienne session est « remplacée », le titulaire est
//    prévenu par e-mail. Verrou consultatif + index unique : deux connexions
//    simultanées ne peuvent pas passer toutes les deux.
//  • Expiration : inactivité (60 min par défaut) et durée maximale (12 h),
//    réglables par le super_admin. Une session expirée ne bloque plus personne.
//  • Changer de module ou de client (cabinet) ne crée pas de session.
//  • Contrôle : SESSIONS_CONTROLE=appliquer (défaut) ; « observer » (défaut des
//    tests automatiques, NODE_ENV=test) accepte encore les jetons sans session
//    et ne bloque pas la deuxième connexion.
const crypto = require('crypto');
const { query, getClient } = require('../config/database');

class ErreurSession extends Error {
  constructor(status, message, code, details) { super(message); this.status = status; this.code = code; this.details = details; }
}

const MESSAGES = {
  SESSION_ACTIVE: 'Ce compte est déjà connecté sur un autre appareil. Veuillez fermer la session existante avant de vous connecter à nouveau.',
  SESSION_REMPLACEE: 'Votre compte a été connecté sur un autre appareil : cette session a été fermée. Reconnectez-vous si c\'est bien vous ; sinon, changez votre mot de passe.',
  SESSION_REVOQUEE: 'Votre session a été fermée par un administrateur. Reconnectez-vous.',
  SESSION_EXPIREE: 'Votre session a expiré après une période d\'inactivité. Reconnectez-vous.',
  SESSION_FERMEE: 'Vous êtes déconnecté(e). Reconnectez-vous.',
  SESSION_INVALIDE: 'Votre session n\'est plus valable (mise à jour de sécurité). Reconnectez-vous.',
};

const mode = () => {
  const v = String(process.env.SESSIONS_CONTROLE || '').toLowerCase();
  if (v === 'observer' || v === 'appliquer') return v;
  return process.env.NODE_ENV === 'test' ? 'observer' : 'appliquer';
};

let tablePresente = false;
const disponible = async () => {
  if (tablePresente) return true;
  const { rows: [r] } = await query("SELECT to_regclass('public.sessions') IS NOT NULL AS ok");
  tablePresente = Boolean(r.ok);
  return tablePresente;
};

let cacheReglages = null;
const DEFAUT = { inactivite_min: 60, duree_max_min: 720, par_type_appareil: true };
const reglages = async () => {
  if (cacheReglages && Date.now() - cacheReglages.t < 15000) return cacheReglages.v;
  let v = { ...DEFAUT };
  try {
    const { rows: [r] } = await query("SELECT valeur FROM plateforme_reglages WHERE cle = 'sessions'");
    if (r?.valeur) v = { ...DEFAUT, ...r.valeur };
  } catch { v = { ...DEFAUT }; }   // table absente (avant 066) : valeurs par défaut
  cacheReglages = { t: Date.now(), v };
  return v;
};

/** 068 : type d'appareil (téléphone et tablette = « mobile »). */
const typeAppareil = (ua = '') => (/Mobi|Android|iPhone|iPad|iPod|Tablet/i.test(String(ua)) ? 'mobile' : 'ordinateur');
const NOM_TYPE = { ordinateur: 'ordinateur', mobile: 'téléphone ou tablette' };

/** Appareil lisible à partir du User-Agent (affichage seulement). */
const decrireAppareil = (ua = '') => {
  const s = String(ua);
  const os = /Android/i.test(s) ? 'Android' : /iPhone|iPad|iOS/i.test(s) ? 'iPhone / iPad' : /Windows/i.test(s) ? 'Windows'
    : /Mac OS X|Macintosh/i.test(s) ? 'Mac' : /Linux/i.test(s) ? 'Linux' : 'Appareil inconnu';
  const nav = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /Chrome\//.test(s) ? 'Chrome' : /Firefox\//.test(s) ? 'Firefox'
    : /Safari\//.test(s) ? 'Safari' : 'navigateur';
  return `${nav} sur ${os}`;
};

const auditer = (db, { tenantId, userId, action, sessionId, details }) => db.query(
  `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, nouvelle_valeur)
   VALUES ($1, $2, $3, 'session', $4, $5)`, [tenantId || null, userId || null, action, sessionId ? String(sessionId) : null, details ? JSON.stringify(details) : null]);

/** Sessions actives dépassées (inactivité ou durée maximale) → expirées. */
const expirerPerimees = async (db, userId = null) => {
  const r = await reglages();
  await db.query(
    `UPDATE sessions SET statut = 'expiree', terminee_le = NOW(), motif_fin = 'Inactivité ou durée maximale atteinte'
      WHERE statut = 'active' AND ($1::uuid IS NULL OR user_id = $1)
        AND (expire_le <= NOW() OR derniere_activite <= NOW() - make_interval(mins => $2::int))`,
    [userId, r.inactivite_min]);
};

const prevenirRemplacement = async ({ userId, ancienne, nouvelle }) => {
  const { rows: [u] } = await query('SELECT username, email FROM users WHERE id = $1', [userId]);
  if (!u?.email) return;
  const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const quand = new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Douala' });
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1e293b;line-height:1.6;max-width:560px">
    <h2 style="color:#1e3a5f;font-size:18px">Nouvelle connexion à votre compte NJ BUSINESS</h2>
    <p>Bonjour ${esc(u.username)},</p>
    <p>Le ${esc(quand)}, votre compte a été connecté depuis <b>${esc(nouvelle.appareil)}</b>${nouvelle.ip ? ` (adresse ${esc(nouvelle.ip)})` : ''}.
    La session ouverte sur <b>${esc(ancienne.appareil || 'un autre appareil')}</b> a été fermée.</p>
    <p>Si c'est vous, il n'y a rien à faire. <b>Si ce n'est pas vous</b>, changez immédiatement votre mot de passe et prévenez votre directeur ou le cabinet.</p>
  </div>`;
  const r = await require('./email.service').envoyer({ to: u.email, subject: 'NJ BUSINESS — nouvelle connexion à votre compte', html });
  if (r.statut !== 'envoye') console.warn(`[Sessions] Alerte de remplacement non envoyée à ${u.username} : ${r.erreur}`);
};

/**
 * Ouvre la session d'un compte dont le mot de passe vient d'être vérifié.
 * `remplacer` : ferme la session active existante (le mot de passe a été
 * redonné). Renvoie { session, remplacee }.
 */
const ouvrir = async ({ user, req, remplacer = false }) => {
  if (!(await disponible())) return { session: null, remplacee: null };
  const r = await reglages();
  const ua = req.get('user-agent') || '';
  const ip = String(req.ip || '').slice(0, 100) || null;
  const appareil = decrireAppareil(ua);
  const type = typeAppareil(ua);
  const parType = r.par_type_appareil !== false;
  const db = await getClient();
  let remplacee = null;
  try {
    await db.query('BEGIN');
    // Verrou par compte : deux connexions simultanées passent l'une après l'autre.
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`nj_session_${user.id}`]);
    await expirerPerimees(db, user.id);
    // Sessions en concurrence : même type d'appareil (068), ou toutes si le réglage est désactivé.
    const { rows: concurrentes } = await db.query(
      `SELECT id, appareil, type_appareil, ip, cree_le, derniere_activite FROM sessions
        WHERE user_id = $1 AND statut = 'active' AND (NOT $2 OR type_appareil = $3) ORDER BY cree_le`, [user.id, parType, type]);
    const active = concurrentes[0];
    if (active) {
      if (!remplacer && mode() === 'appliquer') {
        await auditer(db, { tenantId: user.tenant_id, userId: user.id, action: 'SESSION_REFUSEE', sessionId: active.id, details: { appareil, ip, type } });
        await db.query('COMMIT');
        throw new ErreurSession(409, MESSAGES.SESSION_ACTIVE, 'SESSION_ACTIVE', {
          appareil: active.appareil, type_appareil: active.type_appareil, depuis: active.cree_le, derniere_activite: active.derniere_activite,
          par_type_appareil: parType });
      }
      await db.query(
        `UPDATE sessions SET statut = 'remplacee', terminee_le = NOW(), terminee_par = $2, motif_fin = $3 WHERE id = ANY($1::uuid[])`,
        [concurrentes.map((c) => c.id), user.id, remplacer ? `Remplacée par une connexion depuis ${appareil}` : 'Nouvelle connexion (contrôle en observation)']);
      remplacee = active;
    }
    const { rows: [s] } = await db.query(
      `INSERT INTO sessions (user_id, tenant_id, expire_le, ip, appareil, navigateur, type_appareil)
       VALUES ($1, $2, NOW() + make_interval(mins => $3::int), $4, $5, $6, $7) RETURNING id, cree_le, expire_le`,
      [user.id, user.tenant_id || null, r.duree_max_min, ip, appareil, ua.slice(0, 400), type]);
    await auditer(db, { tenantId: user.tenant_id, userId: user.id, action: remplacee ? 'SESSION_REMPLACEMENT' : 'SESSION_OUVERTURE',
      sessionId: s.id, details: { appareil, ip, remplace: remplacee ? remplacee.id : null } });
    await db.query('COMMIT');
    if (remplacee && remplacer) {
      prevenirRemplacement({ userId: user.id, ancienne: remplacee, nouvelle: { appareil, ip } })
        .catch((e) => console.error('[Sessions] alerte e-mail :', e.message));
    }
    return { session: { id: s.id, expire_le: s.expire_le, duree_max_min: r.duree_max_min, type_appareil: type }, remplacee };
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') {   // index unique : une autre connexion vient de passer
      throw new ErreurSession(409, MESSAGES.SESSION_ACTIVE, 'SESSION_ACTIVE', null);
    }
    throw err;
  } finally {
    db.release();
  }
};

/**
 * Contrôle d'une requête (authGuard). Renvoie null si la session est valable,
 * sinon { code, message } (401). Met à jour la dernière activité au plus une
 * fois par minute.
 */
const controler = async ({ sid, userId }) => {
  if (!(await disponible())) return null;
  if (!sid) return mode() === 'appliquer' ? { code: 'SESSION_INVALIDE', message: MESSAGES.SESSION_INVALIDE } : null;
  const r = await reglages();
  const { rows: [s] } = await query(
    `SELECT id, user_id, statut, expire_le <= NOW() AS depassee,
            derniere_activite <= NOW() - make_interval(mins => $2::int) AS inactive,
            derniere_activite <= NOW() - interval '1 minute' AS a_rafraichir
       FROM sessions WHERE id = $1`, [sid, r.inactivite_min]);
  if (!s || s.user_id !== userId) return { code: 'SESSION_INVALIDE', message: MESSAGES.SESSION_INVALIDE };
  // Observation : rien n'est refusé (l'ancienne session d'une reconnexion reste utilisable).
  if (mode() !== 'appliquer') {
    if (s.statut === 'active' && s.a_rafraichir) await query("UPDATE sessions SET derniere_activite = NOW() WHERE id = $1 AND statut = 'active'", [sid]);
    return null;
  }
  if (s.statut === 'active' && (s.depassee || s.inactive)) {
    await query(`UPDATE sessions SET statut = 'expiree', terminee_le = NOW(), motif_fin = 'Inactivité ou durée maximale atteinte'
                  WHERE id = $1 AND statut = 'active'`, [sid]);
    return { code: 'SESSION_EXPIREE', message: MESSAGES.SESSION_EXPIREE };
  }
  if (s.statut !== 'active') {
    const code = { remplacee: 'SESSION_REMPLACEE', revoquee: 'SESSION_REVOQUEE', expiree: 'SESSION_EXPIREE', fermee: 'SESSION_FERMEE' }[s.statut];
    return { code, message: MESSAGES[code] };
  }
  if (s.a_rafraichir) await query("UPDATE sessions SET derniere_activite = NOW() WHERE id = $1 AND statut = 'active'", [sid]);
  return null;
};

/** Ferme une session (déconnexion, révocation) ou toutes celles d'un compte. */
const terminer = async ({ sessionId = null, userId = null, sauf = null, statut = 'fermee', par = null, motif = null, tenantId = null, action = 'SESSION_FERMETURE' }) => {
  if (!(await disponible())) return 0;
  const { rows } = await query(
    `UPDATE sessions SET statut = $1, terminee_le = NOW(), terminee_par = $2, motif_fin = $3
      WHERE statut = 'active' AND ($4::uuid IS NULL OR id = $4) AND ($5::uuid IS NULL OR user_id = $5) AND ($6::uuid IS NULL OR id <> $6)
      RETURNING id, user_id, tenant_id`, [statut, par, motif, sessionId, userId, sauf]);
  for (const s of rows) {
    await auditer({ query }, { tenantId: s.tenant_id || tenantId, userId: par || s.user_id, action, sessionId: s.id, details: { compte: s.user_id, motif } });
  }
  return rows.length;
};

/** Sessions d'un client (directeur) ou de toute la plateforme (super_admin). */
const lister = async ({ tenantId = null, userId = null, actives = true, limite = 200 }) => {
  if (!(await disponible())) return [];
  await expirerPerimees({ query });
  const { rows } = await query(
    `SELECT s.id, s.user_id, u.username, u.role, s.tenant_id, t.nom AS client, s.statut, s.cree_le, s.derniere_activite,
            s.expire_le, s.appareil, s.type_appareil, s.ip, s.terminee_le, s.motif_fin
       FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN tenants t ON t.id = s.tenant_id
      WHERE ($1::uuid IS NULL OR s.tenant_id = $1) AND ($2::uuid IS NULL OR s.user_id = $2)
        AND (NOT $3 OR s.statut = 'active')
      ORDER BY s.cree_le DESC LIMIT $4`, [tenantId, userId, actives, limite]);
  return rows;
};

const definirReglages = async ({ inactivite_min, duree_max_min, par_type_appareil, par }) => {
  const actuel = await reglages();
  const t = par_type_appareil === undefined ? actuel.par_type_appareil !== false : par_type_appareil;
  if (typeof t !== 'boolean') throw new ErreurSession(400, 'Réglage « ordinateur et téléphone » invalide.');
  const i = Number(inactivite_min);
  const d = Number(duree_max_min);
  if (!Number.isInteger(i) || i < 5 || i > 1440) throw new ErreurSession(400, 'Inactivité : entre 5 et 1 440 minutes.');
  if (!Number.isInteger(d) || d < 30 || d > 10080) throw new ErreurSession(400, 'Durée maximale : entre 30 minutes et 7 jours.');
  if (d < i) throw new ErreurSession(400, 'La durée maximale doit être au moins égale au délai d\'inactivité.');
  await query(`INSERT INTO plateforme_reglages (cle, valeur, modifie_par, modifie_le) VALUES ('sessions', $1, $2, NOW())
               ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur, modifie_par = EXCLUDED.modifie_par, modifie_le = NOW()`,
  [JSON.stringify({ inactivite_min: i, duree_max_min: d, par_type_appareil: t }), par]);
  await auditer({ query }, { userId: par, action: 'SESSIONS_REGLAGES', details: { inactivite_min: i, duree_max_min: d, par_type_appareil: t } });
  cacheReglages = null;
  return reglages();
};

module.exports = {
  ErreurSession, MESSAGES, mode, disponible, reglages, ouvrir, controler, terminer, lister, definirReglages, decrireAppareil, typeAppareil, NOM_TYPE,
  nouvelIdentifiant: () => crypto.randomUUID(),
};
