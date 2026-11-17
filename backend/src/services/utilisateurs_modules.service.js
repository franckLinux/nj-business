// src/services/utilisateurs_modules.service.js — NJ BUSINESS : utilisateurs par
// module (migration 066, lot C).
//
//  • Chaque module a SES utilisateurs (user_modules) : on voit qui travaille dans
//    la caisse, qui dans le commercial. Un compte peut appartenir à plusieurs
//    modules ; un compte créé dans un module n'entre pas dans les autres.
//  • Un profil propre au module peut être attribué (role_id) ; sinon le rôle du
//    compte et son profil métier s'appliquent, comme avant.
//  • Retirer quelqu'un d'un module ne supprime rien (actif = false).
//  • Contrôle d'accès en deux temps (plateforme_reglages) :
//      observer  : rien n'est refusé ; le rapport montre les écarts ;
//      appliquer : une personne ne garde les droits d'un module que si elle y est
//                  rattachée (permission.service).
//  • Reprise des comptes existants : une fois, au démarrage, d'après les droits
//    EFFECTIFS de chacun. Ce que la personne pouvait faire, elle le peut encore.
const { query, getClient } = require('../config/database');
const perm = require('./permission.service');

class ErreurUM extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const CLE_MODE = 'acces_modules_utilisateurs';
const CLE_REPRISE = 'reprise_utilisateurs_066';
const LIBELLES_ROLES = { directeur: 'Directeur', caissier: 'Caissier(ère)', auditeur: 'Comptable', collaborateur: 'Collaborateur' };

const exigerClient = (tenantId) => { if (!tenantId) throw new ErreurUM(400, 'Choisissez d\'abord un client.'); };
const auditer = (db, { tenantId, userId, action, entiteId, avant, apres }) => db.query(
  `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, ancienne_valeur, nouvelle_valeur)
   VALUES ($1, $2, $3, 'user_modules', $4, $5, $6)`,
  [tenantId, userId, action, entiteId, avant ? JSON.stringify(avant) : null, apres ? JSON.stringify(apres) : null]);

/** Modules qui ont des utilisateurs : opérationnels au catalogue. */
const modulesGeres = async () => (await query(
  "SELECT code, nom FROM modules WHERE statut = 'operationnel' ORDER BY ordre, code")).rows;

const verifierModule = async (tenantId, code) => {
  const { rows: [m] } = await query(
    `SELECT m.code, m.nom, m.statut, tm.actif AS actif_client FROM modules m
       LEFT JOIN tenant_modules tm ON tm.module_code = m.code AND tm.tenant_id = $2
      WHERE m.code = $1`, [code, tenantId]);
  if (!m || m.statut !== 'operationnel') throw new ErreurUM(404, 'Module introuvable.');
  if (!m.actif_client) throw new ErreurUM(409, `Le module ${m.nom} n'est pas activé pour ce client.`);
  return m;
};

/** Modules (codes) dont une personne détient des droits, d'après ses droits effectifs bruts. */
const modulesDesDroits = async ({ tenantId, userId, role }) => {
  const codes = await perm.getEffectivePermissions({ tenantId, userId, role, brut: true });
  const modules = await perm.modulesDesPermissions();
  return new Set((codes || []).map((c) => perm.groupeDe(modules.get(c))).filter((g) => g !== 'socle'));
};

// ── Reprise des comptes existants ──────────────────────────────────────────
/**
 * Rattache aux modules les comptes d'un client (ou de tous) qui n'ont encore
 * AUCUNE ligne user_modules, d'après leurs droits effectifs, pour les modules
 * que le client possède (actifs ou non). Idempotent. Rien n'est retiré.
 */
const reprendre = async ({ tenantId = null, par = null, origine = 'migration' } = {}) => {
  const { rows: comptes } = await query(
    `SELECT u.id, u.username, u.role, u.tenant_id, t.nom AS client
       FROM users u JOIN tenants t ON t.id = u.tenant_id
      WHERE u.role = ANY ($1) AND ($2::uuid IS NULL OR u.tenant_id = $2)
        AND NOT EXISTS (SELECT 1 FROM user_modules um WHERE um.user_id = u.id)
      ORDER BY t.nom, u.username`, [perm.ROLES_CLIENT, tenantId]);
  const { rows: tm } = await query('SELECT tenant_id, module_code FROM tenant_modules WHERE ($1::uuid IS NULL OR tenant_id = $1)', [tenantId]);
  const possedes = new Map();
  for (const r of tm) {
    if (!possedes.has(r.tenant_id)) possedes.set(r.tenant_id, new Set());
    possedes.get(r.tenant_id).add(r.module_code);
  }
  const rapport = { comptes: comptes.length, affectations: [], sans_module: [] };
  for (const u of comptes) {
    const droits = await modulesDesDroits({ tenantId: u.tenant_id, userId: u.id, role: u.role });
    const modules = [...droits].filter((g) => possedes.get(u.tenant_id)?.has(g)).sort();
    for (const code of modules) {
      await query(
        `INSERT INTO user_modules (user_id, module_code, tenant_id, origine, affecte_par, motif)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id, module_code) DO NOTHING`,
        [u.id, code, u.tenant_id, origine, par, 'Reprise : droits existants dans ce module']);
    }
    const ligne = { client: u.client, tenant_id: u.tenant_id, user_id: u.id, username: u.username, role: u.role, modules };
    if (modules.length) rapport.affectations.push(ligne); else rapport.sans_module.push(ligne);
  }
  return rapport;
};

/** Reprise unique au démarrage (verrou : plusieurs processus peuvent démarrer ensemble). */
const repriseAuDemarrage = async () => {
  const { rows: [ok] } = await query("SELECT to_regclass('public.user_modules') IS NOT NULL AS ok");
  if (!ok.ok) return null;
  const db = await getClient();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('nj_reprise_utilisateurs_066'))");
    const { rows: [deja] } = await db.query('SELECT 1 FROM plateforme_reglages WHERE cle = $1', [CLE_REPRISE]);
    if (deja) { await db.query('ROLLBACK'); return null; }
    const rapport = await reprendre();
    await db.query('INSERT INTO plateforme_reglages (cle, valeur) VALUES ($1, $2)', [CLE_REPRISE, JSON.stringify({
      le: new Date().toISOString(), comptes: rapport.comptes, rattaches: rapport.affectations.length, sans_module: rapport.sans_module.length,
    })]);
    await db.query('COMMIT');
    console.log(`[Modules/utilisateurs] Reprise : ${rapport.comptes} compte(s), ${rapport.affectations.length} rattaché(s), ${rapport.sans_module.length} à affecter.`);
    return rapport;
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('[Modules/utilisateurs] Reprise impossible :', err.message);
    throw err;
  } finally {
    db.release();
  }
};

// ── Utilisateurs d'un module ───────────────────────────────────────────────
const lister = async (tenantId, code) => {
  exigerClient(tenantId);
  const module = await verifierModule(tenantId, code);
  const mode = await perm.modeAccesModules();
  const { rows: comptes } = await query(
    `SELECT u.id, u.username, u.email, u.role, u.actif, u.derniere_connexion, u.created_at,
            cr.nom AS profil_compte,
            um.actif AS membre, um.role_id, pr.nom AS profil_module, um.origine, um.affecte_le, um.modifie_le, um.motif,
            COALESCE((SELECT array_agg(x.module_code ORDER BY x.module_code) FROM user_modules x WHERE x.user_id = u.id AND x.actif), '{}') AS modules
       FROM users u
       LEFT JOIN roles cr ON cr.id = u.custom_role_id
       LEFT JOIN user_modules um ON um.user_id = u.id AND um.module_code = $2
       LEFT JOIN roles pr ON pr.id = um.role_id
      WHERE u.tenant_id = $1 AND u.role = ANY ($3)
      ORDER BY u.actif DESC, lower(u.username)`, [tenantId, code, perm.ROLES_CLIENT]);
  const modules = await perm.modulesDesPermissions();
  const sortie = [];
  for (const u of comptes) {
    const droits = await perm.getEffectivePermissions({ tenantId, userId: u.id, role: u.role, brut: true });
    const duModule = (droits || []).filter((c) => perm.groupeDe(modules.get(c)) === code);
    sortie.push({
      id: u.id, username: u.username, email: u.email, role: u.role, role_libelle: LIBELLES_ROLES[u.role] || u.role,
      compte_actif: u.actif, derniere_connexion: u.derniere_connexion, cree_le: u.created_at,
      profil_compte: u.profil_compte, membre: u.membre === true, retire: u.membre === false,
      profil_module: u.role_id ? { id: u.role_id, nom: u.profil_module } : null,
      origine: u.origine, affecte_le: u.affecte_le, modifie_le: u.modifie_le, motif: u.motif, modules: u.modules,
      permissions_module: duModule.length,
    });
  }
  const membres = sortie.filter((u) => u.membre);
  // Profils du client qui portent des droits de ce module.
  const { rows: profils } = await query(
    `SELECT r.id, r.nom, r.code, COUNT(*)::int AS n FROM roles r
       JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.code = rp.permission_code
      WHERE r.tenant_id = $1 GROUP BY r.id ORDER BY r.nom`, [tenantId]);
  const profilsModule = [];
  for (const r of profils) {
    const { rows } = await query('SELECT p.module FROM role_permissions rp JOIN permissions p ON p.code = rp.permission_code WHERE rp.role_id = $1', [r.id]);
    if (rows.some((x) => perm.groupeDe(x.module) === code)) profilsModule.push({ id: r.id, nom: r.nom, code: r.code });
  }
  return {
    module: { code: module.code, nom: module.nom }, mode,
    resume: {
      membres: membres.length,
      actifs: membres.filter((u) => u.compte_actif).length,
      desactives: membres.filter((u) => !u.compte_actif).length,
      a_affecter: sortie.filter((u) => u.modules.length === 0).length,
    },
    utilisateurs: membres,
    autres: sortie.filter((u) => !u.membre),
    profils: profilsModule,
  };
};

const verifierCible = async (db, tenantId, userId) => {
  const { rows: [u] } = await db.query('SELECT id, username, role FROM users WHERE id = $1 AND tenant_id = $2', [userId, tenantId]);
  if (!u) throw new ErreurUM(404, 'Utilisateur introuvable pour ce client.');
  if (!perm.ROLES_CLIENT.includes(u.role)) throw new ErreurUM(400, 'Ce compte n\'appartient pas à l\'espace du client.');
  return u;
};
const verifierProfil = async (db, tenantId, roleId) => {
  if (roleId === null || roleId === undefined || roleId === '') return null;
  const id = Number(roleId);
  if (!Number.isInteger(id)) throw new ErreurUM(400, 'Profil invalide.');
  const { rows: [r] } = await db.query('SELECT id, nom FROM roles WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
  if (!r) throw new ErreurUM(400, 'Profil introuvable pour ce client.');
  return r.id;
};

/** Rattache (ou rattache à nouveau) une personne à un module. */
const affecter = async ({ tenantId, code, cibleId, roleId, par, origine = 'manuel', db: dbExterne = null }) => {
  exigerClient(tenantId);
  if (!dbExterne) await verifierModule(tenantId, code);
  const db = dbExterne || await getClient();
  try {
    if (!dbExterne) await db.query('BEGIN');
    const u = await verifierCible(db, tenantId, cibleId);
    const profil = await verifierProfil(db, tenantId, roleId);
    const { rows: [avant] } = await db.query('SELECT actif, role_id FROM user_modules WHERE user_id = $1 AND module_code = $2 FOR UPDATE', [cibleId, code]);
    await db.query(
      `INSERT INTO user_modules (user_id, module_code, tenant_id, actif, role_id, origine, affecte_par, modifie_par, motif)
       VALUES ($1, $2, $3, TRUE, $4, $5, $6, $6, NULL)
       ON CONFLICT (user_id, module_code) DO UPDATE SET actif = TRUE, role_id = EXCLUDED.role_id,
         modifie_par = EXCLUDED.modifie_par, modifie_le = NOW(), motif = NULL`,
      [cibleId, code, tenantId, profil, origine, par]);
    await auditer(db, { tenantId, userId: par, action: 'MODULE_UTILISATEUR_AJOUTE', entiteId: `${code}:${cibleId}`,
      avant: avant || null, apres: { module: code, utilisateur: u.username, role_id: profil } });
    if (!dbExterne) await db.query('COMMIT');
  } catch (err) {
    if (!dbExterne) await db.query('ROLLBACK').catch(() => {});
    if (err.code === '23503' || /user_modules/.test(err.message || '')) throw new ErreurUM(400, 'Rattachement impossible : vérifiez le compte et le profil.');
    throw err;
  } finally {
    if (!dbExterne) db.release();
  }
};

/** Profil propre au module (null : rôle et profil du compte). */
const modifierProfil = async ({ tenantId, code, cibleId, roleId, par }) => {
  exigerClient(tenantId);
  await verifierModule(tenantId, code);
  const db = await getClient();
  try {
    await db.query('BEGIN');
    await verifierCible(db, tenantId, cibleId);
    const profil = await verifierProfil(db, tenantId, roleId);
    const { rows: [l] } = await db.query('SELECT role_id FROM user_modules WHERE user_id = $1 AND module_code = $2 AND actif FOR UPDATE', [cibleId, code]);
    if (!l) throw new ErreurUM(404, 'Cette personne n\'est pas rattachée à ce module.');
    await db.query('UPDATE user_modules SET role_id = $3, modifie_par = $4, modifie_le = NOW() WHERE user_id = $1 AND module_code = $2',
      [cibleId, code, profil, par]);
    await auditer(db, { tenantId, userId: par, action: 'MODULE_UTILISATEUR_PROFIL', entiteId: `${code}:${cibleId}`,
      avant: { role_id: l.role_id }, apres: { role_id: profil } });
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    db.release();
  }
};

/** Retire une personne d'un module (rien n'est supprimé ; motif obligatoire). */
const retirer = async ({ tenantId, code, cibleId, motif, par }) => {
  exigerClient(tenantId);
  await verifierModule(tenantId, code);
  const raison = String(motif || '').trim();
  if (raison.length < 3) throw new ErreurUM(400, 'Indiquez le motif du retrait.');
  if (raison.length > 500) throw new ErreurUM(400, 'Motif trop long (500 caractères au plus).');
  if (cibleId === par) throw new ErreurUM(400, 'Vous ne pouvez pas vous retirer vous-même d\'un module.');
  const db = await getClient();
  try {
    await db.query('BEGIN');
    const u = await verifierCible(db, tenantId, cibleId);
    const { rows: [l] } = await db.query('SELECT actif FROM user_modules WHERE user_id = $1 AND module_code = $2 FOR UPDATE', [cibleId, code]);
    if (!l?.actif) throw new ErreurUM(404, 'Cette personne n\'est pas rattachée à ce module.');
    await db.query('UPDATE user_modules SET actif = FALSE, motif = $3, modifie_par = $4, modifie_le = NOW() WHERE user_id = $1 AND module_code = $2',
      [cibleId, code, raison, par]);
    await auditer(db, { tenantId, userId: par, action: 'MODULE_UTILISATEUR_RETIRE', entiteId: `${code}:${cibleId}`,
      avant: { actif: true }, apres: { module: code, utilisateur: u.username, motif: raison } });
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    db.release();
  }
};

// ── Plateforme (super_admin) ───────────────────────────────────────────────
const definirMode = async ({ mode, par }) => {
  if (!['observer', 'appliquer'].includes(mode)) throw new ErreurUM(400, 'Mode attendu : observer ou appliquer.');
  const { rows: [avant] } = await query("SELECT valeur #>> '{}' AS v FROM plateforme_reglages WHERE cle = $1", [CLE_MODE]);
  await query(`INSERT INTO plateforme_reglages (cle, valeur, modifie_par, modifie_le) VALUES ($1, $2, $3, NOW())
               ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur, modifie_par = EXCLUDED.modifie_par, modifie_le = NOW()`,
  [CLE_MODE, JSON.stringify(mode), par]);
  await query(`INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, ancienne_valeur, nouvelle_valeur)
               VALUES (NULL, $1, 'ACCES_MODULES_MODE', 'plateforme', $2, $3, $4)`,
  [par, CLE_MODE, JSON.stringify({ mode: avant?.v || null }), JSON.stringify({ mode })]);
  perm.oublierModeAccesModules();
  return rapport();
};

/**
 * Répartition par client, et ÉCARTS : personnes qui ont aujourd'hui des droits
 * dans un module sans y être rattachées (elles les perdraient en mode « appliquer »).
 */
const rapport = async () => {
  const mode = await perm.modeAccesModules();
  const { rows: [reprise] } = await query('SELECT valeur FROM plateforme_reglages WHERE cle = $1', [CLE_REPRISE]);
  const geres = await modulesGeres();
  const { rows: comptes } = await query(
    `SELECT u.id, u.username, u.role, u.actif, u.tenant_id, t.nom AS client,
            COALESCE((SELECT array_agg(x.module_code ORDER BY x.module_code) FROM user_modules x WHERE x.user_id = u.id AND x.actif), '{}') AS modules
       FROM users u JOIN tenants t ON t.id = u.tenant_id
      WHERE u.role = ANY ($1) ORDER BY t.nom, lower(u.username)`, [perm.ROLES_CLIENT]);
  const { rows: tm } = await query('SELECT tenant_id, module_code FROM tenant_modules WHERE actif');
  const actifs = new Map();
  for (const r of tm) { if (!actifs.has(r.tenant_id)) actifs.set(r.tenant_id, new Set()); actifs.get(r.tenant_id).add(r.module_code); }
  const clients = new Map();
  const ecarts = [];
  for (const u of comptes) {
    if (!clients.has(u.tenant_id)) {
      clients.set(u.tenant_id, { id: u.tenant_id, nom: u.client, comptes: 0, a_affecter: 0, modules: Object.fromEntries(geres.map((m) => [m.code, 0])) });
    }
    const c = clients.get(u.tenant_id);
    c.comptes += 1;
    if (u.modules.length === 0) c.a_affecter += 1;
    for (const m of u.modules) if (m in c.modules) c.modules[m] += 1;
    if (!u.actif) continue;
    const droits = await modulesDesDroits({ tenantId: u.tenant_id, userId: u.id, role: u.role });
    const perdus = [...droits].filter((g) => actifs.get(u.tenant_id)?.has(g) && !u.modules.includes(g));
    if (perdus.length) ecarts.push({ client: u.client, tenant_id: u.tenant_id, user_id: u.id, username: u.username, role: u.role, modules: perdus });
  }
  return { mode, reprise: reprise?.valeur || null, modules: geres, clients: [...clients.values()], ecarts };
};

module.exports = {
  ErreurUM, lister, affecter, modifierProfil, retirer, reprendre, repriseAuDemarrage, definirMode, rapport,
};
