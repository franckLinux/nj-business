// src/services/modules.service.js — NJ BUSINESS : catalogue des modules et
// activation par client (migration 048).
//
// Trois notions qui ne se confondent jamais :
//   1. module disponible  : modules.statut = 'operationnel'
//   2. module activé      : tenant_modules.actif pour CE client
//   3. droits utilisateur : permissions (permission.service.js), inchangées
//
// Le module d'une route API se déduit de son préfixe (modules.prefixes_api) :
// aucune des déclarations de routes existantes n'a besoin d'être modifiée.
// Une route qui ne relève d'aucun module appartient au socle (connexion,
// configuration, utilisateurs, notifications…) et n'est jamais bloquée.
const { query, pool } = require('../config/database');

class ErreurMetier extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ── Mode du contrôle ────────────────────────────────────────────────────────
// MODULES_CONTROLE = observer (défaut) | appliquer
//   observer  : aucun refus ; ce qui AURAIT été refusé est journalisé
//               ([Modules] refus simulé). Sert à vérifier en production,
//               sans risque, qu'aucun client légitime ne serait bloqué.
//   appliquer : refus 403 MODULE_INACTIF.
const modeControle = () => ((process.env.MODULES_CONTROLE || 'observer').toLowerCase() === 'appliquer'
  ? 'appliquer' : 'observer');

// ── Installation (migration 048 jouée ?) ────────────────────────────────────
// Tant que la 048 n'est pas jouée (code déployé avant la migration), le
// système de modules est considéré comme absent : aucun blocage, comportement
// identique à avant. Vérifié au plus une fois par minute.
let installe = null;
let installeVerifie = 0;
const estInstalle = async () => {
  if (installe === true) return true;
  if (installe !== null && Date.now() - installeVerifie < 60e3) return installe;
  const { rows } = await query("SELECT to_regclass('public.tenant_modules') IS NOT NULL AS ok");
  installe = Boolean(rows[0]?.ok);
  installeVerifie = Date.now();
  return installe;
};

// ── Catalogue (mis en cache 60 s : il ne change que par migration) ─────────
let cache = null;
let cacheLe = 0;
const catalogue = async ({ frais = false } = {}) => {
  if (!frais && cache && Date.now() - cacheLe < 60e3) return cache;
  const { rows } = await query(
    `SELECT code, nom, description, icone, statut, route_accueil, prefixes_api, par_defaut, ordre
       FROM modules WHERE statut <> 'retire' ORDER BY ordre, code`);
  cache = rows;
  cacheLe = Date.now();
  return rows;
};

const correspond = (chemin, prefixe) => chemin === prefixe || chemin.startsWith(`${prefixe}/`);

/** Code du module auquel appartient une route API (chemin sans /api), ou null (socle). */
const moduleDeRoute = async (chemin) => {
  if (!(await estInstalle())) return null;
  const liste = await catalogue();
  const trouve = liste.find((m) => (m.prefixes_api || []).some((p) => correspond(chemin, p)));
  return trouve ? trouve.code : null;
};

/** Codes des modules activés ET opérationnels pour un client. Lu en base à chaque appel. */
const modulesActifs = async (tenantId) => {
  const { rows } = await query(
    `SELECT tm.module_code
       FROM tenant_modules tm JOIN modules m ON m.code = tm.module_code
      WHERE tm.tenant_id = $1 AND tm.actif AND m.statut = 'operationnel'`,
    [tenantId]);
  return rows.map((r) => r.module_code);
};

/**
 * Modules présentés à un utilisateur (accueil NJ BUSINESS, menu des modules).
 * null = système de modules non installé : l'interface garde le comportement
 * d'avant (NJ CAISSE PRO seul). Sans client (cabinet sans client choisi) : [].
 */
const modulesPourSession = async (tenantId, personne = null) => {
  if (!(await estInstalle())) return null;
  if (!tenantId) return [];
  const [liste, actifs] = await Promise.all([catalogue(), modulesActifs(tenantId)]);
  // 066 : en mode « appliquer », une personne du client n'entre que dans les
  // modules auxquels elle est rattachée (membre). null : pas de contrôle.
  let membre = null;
  const perm = require('./permission.service');
  if (personne?.userId && perm.ROLES_CLIENT.includes(personne.role) && (await perm.modeAccesModules()) === 'appliquer') {
    membre = await perm.modulesDe(personne.userId);
  }
  return liste.map((m) => ({
    membre: membre ? membre.has(m.code) : null,
    code: m.code,
    nom: m.nom,
    description: m.description,
    icone: m.icone,
    statut: m.statut,
    route_accueil: m.route_accueil,
    actif: actifs.includes(m.code),
  }));
};

// ── Administration (super_admin) ────────────────────────────────────────────
const verifierInstalle = async () => {
  if (!(await estInstalle())) throw new ErreurMetier(503, 'Migration 048 non appliquée : lancez « node db/migrate.js ».');
};

/** Matrice clients × modules pour l'écran d'administration. */
const matrice = async () => {
  await verifierInstalle();
  const modules = await catalogue({ frais: true });
  const { rows: clients } = await query(
    `SELECT t.id, t.nom, t.slug, t.actif,
            COALESCE(to_jsonb(t)->>'type_compte', 'client') AS type_compte,
            COALESCE(jsonb_object_agg(tm.module_code, tm.actif) FILTER (WHERE tm.module_code IS NOT NULL), '{}'::jsonb) AS modules
       FROM tenants t
       LEFT JOIN tenant_modules tm ON tm.tenant_id = t.id
      GROUP BY t.id
      ORDER BY t.nom`);
  return { mode: modeControle(), modules, clients };
};

/** Configuration effective d'un client, avec l'auteur et la date de chaque changement. */
const configurationClient = async (tenantId) => {
  await verifierInstalle();
  const { rows: t } = await query('SELECT id, nom FROM tenants WHERE id = $1', [tenantId]);
  if (!t[0]) throw new ErreurMetier(404, 'Client introuvable.');
  const { rows } = await query(
    `SELECT m.code, m.nom, m.description, m.statut, m.ordre,
            COALESCE(tm.actif, false) AS actif, tm.modifie_le, tm.motif,
            u.username AS modifie_par
       FROM modules m
       LEFT JOIN tenant_modules tm ON tm.module_code = m.code AND tm.tenant_id = $1
       LEFT JOIN users u ON u.id = tm.modifie_par
      WHERE m.statut <> 'retire'
      ORDER BY m.ordre, m.code`,
    [tenantId]);
  return { client: t[0], modules: rows };
};

// Adaptateur : une transaction Sequelize exposée comme un client pg
// ({ query(sql, params) → { rows } }), pour activer des modules dans la
// transaction qui crée le client (création manuelle, démonstration, conversion).
const clientSequelize = (sequelize, transaction) => ({
  query: async (sql, params = []) => {
    const [rows] = await sequelize.query(sql, { bind: params, transaction });
    return { rows: Array.isArray(rows) ? rows : [] };
  },
});

/** Module activable : présent au catalogue et opérationnel. */
const verifierActivable = async (client, code) => {
  const { rows: m } = await client.query('SELECT code, nom, statut FROM modules WHERE code = $1', [code]);
  if (!m[0] || m[0].statut === 'retire') throw new ErreurMetier(404, `Module « ${code} » introuvable.`);
  if (m[0].statut !== 'operationnel') {
    throw new ErreurMetier(400, `Le module ${m[0].nom} est en préparation : il ne peut pas encore être activé.`);
  }
  return m[0];
};

/**
 * Écrit l'activation (ou la désactivation) dans la transaction `client` :
 * ligne tenant_modules, préparation du module à l'activation, journal d'audit.
 * Les contrôles d'entrée sont faits par l'appelant.
 */
const ecrireActivation = async (client, { tenantId, code, actif, motif, userId, avant = null }) => {
  await client.query(
    `INSERT INTO tenant_modules (tenant_id, module_code, actif, modifie_par, modifie_le, motif)
     VALUES ($1, $2, $3, $4, NOW(), $5)
     ON CONFLICT (tenant_id, module_code)
     DO UPDATE SET actif = EXCLUDED.actif, modifie_par = EXCLUDED.modifie_par,
                   modifie_le = NOW(), motif = EXCLUDED.motif`,
    [tenantId, code, actif, userId, motif]);
  if (actif && PREPARATIONS[code]) await PREPARATIONS[code](client, tenantId, userId);
  await client.query(
    `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, ancienne_valeur, nouvelle_valeur)
     VALUES ($1, $2, $3, 'tenant_modules', $4, $5, $6)`,
    [tenantId, userId, actif ? 'MODULE_ACTIVATION' : 'MODULE_DESACTIVATION', code,
      JSON.stringify({ actif: avant }), JSON.stringify({ actif, motif })]);
};

/**
 * Lot B (065) : modules choisis à la création d'un client, activés dans la
 * transaction de création. Aucun module n'est imposé : un client peut exister
 * sans module. `codes` vide = aucun module.
 */
const activerALaCreation = async (client, { tenantId, codes = [], userId, motif = 'Activation à la création du client' }) => {
  if (!Array.isArray(codes)) throw new ErreurMetier(400, 'Modules : liste attendue.');
  const uniques = [...new Set(codes.map((c) => String(c)))];
  for (const code of uniques) {
    await verifierActivable(client, code);
    await ecrireActivation(client, { tenantId, code, actif: true, motif, userId });
  }
  return uniques;
};

/**
 * Active ou désactive un module pour un client. Jamais de suppression de ligne :
 * désactiver = actif false, les données du module restent intactes.
 */
const definir = async ({ tenantId, code, actif, motif, userId }) => {
  await verifierInstalle();
  if (typeof actif !== 'boolean') throw new ErreurMetier(400, 'Le champ « actif » (vrai / faux) est requis.');
  const raison = String(motif || '').trim();
  if (!actif && raison.length < 3) throw new ErreurMetier(400, 'Motif obligatoire pour désactiver un module.');
  if (raison.length > 500) throw new ErreurMetier(400, 'Motif trop long (500 caractères au plus).');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: m } = await client.query('SELECT code, nom, statut FROM modules WHERE code = $1', [code]);
    if (!m[0] || m[0].statut === 'retire') throw new ErreurMetier(404, 'Module introuvable.');
    if (actif) await verifierActivable(client, code);
    const { rows: t } = await client.query('SELECT id FROM tenants WHERE id = $1', [tenantId]);
    if (!t[0]) throw new ErreurMetier(404, 'Client introuvable.');

    const { rows: avant } = await client.query(
      'SELECT actif FROM tenant_modules WHERE tenant_id = $1 AND module_code = $2 FOR UPDATE', [tenantId, code]);
    const etaitActif = Boolean(avant[0]?.actif);
    if (avant[0] && etaitActif === actif) {
      await client.query('ROLLBACK');
      return { inchange: true, code, actif };
    }
    await ecrireActivation(client, { tenantId, code, actif, motif: raison, userId, avant: avant[0] ? etaitActif : null });
    await client.query('COMMIT');
    console.log(`[Modules] ${actif ? 'activation' : 'désactivation'} ${code} pour ${tenantId} par ${userId}`);
    return { inchange: false, code, actif };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

// ── Préparation d'un client à l'activation d'un module ─────────────────────
// NJ COMMERCIAL (050) :
//   • profils métier « achats » prêts à attribuer (créés une seule fois, jamais
//     écrasés : le directeur peut les adapter ensuite) ;
//   • si le client a un plafond de permissions, les permissions com.* y sont
//     ajoutées — activer le module, c'est l'ouvrir ; les droits de chaque
//     personne restent fixés par son rôle et son profil.
const PROFILS_COMMERCIAL = [
  ['achats_demandeur', 'Demandeur achats', 'Exprime ses besoins d\'achat et suit ses demandes', '#0ea5e9',
    ['com.parametrage.voir', 'com.articles.voir', 'com.tiers.voir', 'com.da.creer', 'com.documents.ajouter']],
  ['achats_gestionnaire', 'Gestionnaire des achats (GAS)', 'Vérifie stocks et fournisseurs, prépare les bons de commande', '#6366f1',
    ['com.parametrage.voir', 'com.articles.voir', 'com.articles.modifier', 'com.tiers.voir', 'com.tiers.modifier', 'com.stock.initial',
      'com.da.creer', 'com.da.voir_tout', 'com.bc.preparer', 'com.documents.ajouter', 'com.tableau_bord.voir',
      'com.stock.voir', 'com.stock.journal', 'com.stock.valorisation',
      'com.receptions.saisir', 'com.retours_fourn.saisir', 'com.factures_fourn.voir', 'com.frais.saisir']],
  ['achats_responsable', 'Responsable des achats', 'Approuve ou rejette les demandes, émet et annule les bons', '#7c3aed',
    ['com.parametrage.voir', 'com.parametrage.modifier', 'com.articles.voir', 'com.articles.modifier', 'com.tiers.voir',
      'com.tiers.modifier', 'com.tiers.banque', 'com.da.creer', 'com.da.voir_tout', 'com.da.approuver', 'com.bc.preparer',
      'com.bc.emettre', 'com.bc.annuler', 'com.documents.ajouter', 'com.tableau_bord.voir',
      'com.stock.voir', 'com.stock.journal', 'com.stock.valorisation',
      'com.receptions.valider', 'com.receptions.annuler', 'com.retours_fourn.valider',
      'com.factures_fourn.voir', 'com.consultations.gerer', 'com.consultations.derogation', 'com.frais.saisir']],
  // 063 : la facture fournisseur relève du comptable, jamais des achats.
  ['achats_comptable', 'Comptable (achats)', 'Saisit, contrôle et valide les factures fournisseurs ; enregistre les frais d\'achat', '#b45309',
    ['com.articles.voir', 'com.tiers.voir', 'com.da.voir_tout', 'com.tableau_bord.voir', 'com.stock.voir', 'com.stock.valorisation',
      'com.factures_fourn.voir', 'com.factures_fourn.saisir', 'com.factures_fourn.valider', 'com.factures_fourn.annuler',
      'com.frais.saisir', 'com.frais.valider']],
  ['stock_magasinier', 'Magasinier', 'Saisit entrées, sorties, transferts et comptages d\'inventaire', '#0d9488',
    ['com.articles.voir', 'com.stock.voir', 'com.stock.entree', 'com.stock.sortie', 'com.stock.transfert', 'com.stock.inventaire', 'com.stock.journal',
      'com.receptions.saisir', 'com.retours_fourn.saisir', 'com.ventes.voir', 'com.ventes.preparer']],
  ['stock_gestionnaire', 'Gestionnaire de stock', 'Valide les documents de stock, suit la valorisation', '#0f766e',
    ['com.parametrage.voir', 'com.articles.voir', 'com.stock.initial', 'com.stock.voir', 'com.stock.entree', 'com.stock.sortie',
      'com.stock.transfert', 'com.stock.inventaire', 'com.stock.valider', 'com.stock.annuler', 'com.stock.journal', 'com.stock.valorisation',
      'com.tableau_bord.voir', 'com.receptions.saisir', 'com.receptions.valider', 'com.receptions.annuler',
      'com.retours_fourn.saisir', 'com.retours_fourn.valider', 'com.ventes.voir', 'com.ventes.preparer', 'com.ventes.livrer']],
  ['ventes_commercial', 'Commercial (ventes)', 'Établit les devis et enregistre les commandes des clients', '#0891b2',
    ['com.articles.voir', 'com.tiers.voir', 'com.stock.voir', 'com.ventes.voir', 'com.ventes.devis', 'com.ventes.commandes']],
  ['ventes_responsable', 'Responsable commercial', 'Valide les devis, suit les commandes et livraisons, annule', '#0e7490',
    ['com.articles.voir', 'com.tiers.voir', 'com.stock.voir', 'com.ventes.voir', 'com.ventes.devis', 'com.ventes.valider',
      'com.ventes.commandes', 'com.ventes.livrer', 'com.ventes.annuler', 'com.tableau_bord.voir']],
];
// NJ CAISSE PRO (065) : rubriques, journaux et plan comptable de départ, créés
// à l'ACTIVATION de la caisse et non plus à la création du client.
//   • rubriques et journaux par défaut : seulement si le client n'en a aucun
//     (une réactivation retrouve les siens tels qu'il les avait laissés) ;
//   • plan comptable : référentiel suggéré par la forme juridique s'il n'est pas
//     encore initialisé, puis initialisation (sans effet s'il existe déjà).
const preparerCaisse = async (client, tenantId, userId) => {
  const { rows: [t] } = await client.query(
    'SELECT forme_juridique, plan_initialise_le FROM tenants WHERE id = $1 FOR UPDATE', [tenantId]);
  if (!t) throw new ErreurMetier(404, 'Client introuvable.');
  const { RUBRIQUES_DEFAUT } = require('../controllers/rubriques.controller');
  const { JOURNAUX_DEFAUT } = require('../controllers/journaux.controller');
  const { rows: [r] } = await client.query('SELECT COUNT(*)::int AS n FROM rubriques WHERE tenant_id = $1', [tenantId]);
  if (r.n === 0) {
    for (const x of RUBRIQUES_DEFAUT) {
      await client.query(
        `INSERT INTO rubriques (tenant_id, code, intitule, type, est_virement_interne, code_comptable, ordre)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (tenant_id, code) DO NOTHING`,
        [tenantId, x.code, x.intitule, x.type, Boolean(x.est_virement_interne), x.code_comptable || '', x.ordre || 0]);
    }
  }
  const { rows: [j] } = await client.query('SELECT COUNT(*)::int AS n FROM journaux WHERE tenant_id = $1', [tenantId]);
  if (j.n === 0) {
    for (const x of JOURNAUX_DEFAUT) {
      await client.query(
        `INSERT INTO journaux (tenant_id, code, nom, type, ordre) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, code) DO NOTHING`, [tenantId, x.code, x.nom, x.type, x.ordre]);
    }
  }
  const { rows: [fn] } = await client.query(
    "SELECT to_regprocedure('plan_client_initialiser(uuid,integer,uuid)') IS NOT NULL AS ok");
  if (fn.ok) {
    const { rows: [plan] } = await client.query('SELECT EXISTS (SELECT 1 FROM plan_comptable_client WHERE tenant_id = $1) AS ok', [tenantId]);
    if (!t.plan_initialise_le && !plan.ok) {
      const { rows: [ref] } = await client.query(
        "SELECT to_regprocedure('plan_referentiel_de_forme(text)') IS NOT NULL AS ok");
      if (ref.ok) {
        await client.query('UPDATE tenants SET plan_referentiel = plan_referentiel_de_forme(forme_juridique) WHERE id = $1', [tenantId]);
      }
    }
    await client.query('SELECT plan_client_initialiser($1::uuid, NULL::integer, $2::uuid)', [tenantId, userId || null]);
  }
};

const PREPARATIONS = {
  caisse: preparerCaisse,
  commercial: async (client, tenantId) => {
    const { rows: cat } = await client.query("SELECT code FROM permissions WHERE module = 'commercial'");
    const connus = new Set(cat.map((r) => r.code));
    for (const [code, nom, description, couleur, perms] of PROFILS_COMMERCIAL) {
      const { rows: existe } = await client.query('SELECT id FROM roles WHERE tenant_id = $1 AND code = $2', [tenantId, code]);
      if (existe[0]) continue;
      const { rows: r } = await client.query(
        'INSERT INTO roles (nom, code, description, couleur, tenant_id, is_system) VALUES ($1, $2, $3, $4, $5, false) RETURNING id',
        [nom, code, description, couleur, tenantId]);
      for (const p of perms.filter((c) => connus.has(c))) {
        await client.query('INSERT INTO role_permissions (role_id, permission_code) VALUES ($1, $2) ON CONFLICT DO NOTHING', [r[0].id, p]);
      }
    }
    const { rows: plafond } = await client.query('SELECT 1 FROM tenant_permissions WHERE tenant_id = $1 LIMIT 1', [tenantId]);
    if (plafond[0]) {
      await client.query(
        `INSERT INTO tenant_permissions (tenant_id, permission_code)
         SELECT $1, code FROM permissions WHERE module = 'commercial' ON CONFLICT DO NOTHING`, [tenantId]);
    }
  },
  // 076 : NJ COMPTABILITÉ — un client à plafond de droits reçoit les droits compta.*
  // (les rôles système directeur / comptable les portent déjà).
  comptabilite: async (client, tenantId) => {
    const { rows: plafond } = await client.query('SELECT 1 FROM tenant_permissions WHERE tenant_id = $1 LIMIT 1', [tenantId]);
    if (plafond[0]) {
      await client.query(
        `INSERT INTO tenant_permissions (tenant_id, permission_code)
         SELECT $1, code FROM permissions WHERE module = 'comptabilite' ON CONFLICT DO NOTHING`, [tenantId]);
    }
  },
};

module.exports = {
  ErreurMetier, modeControle, estInstalle, catalogue, moduleDeRoute, modulesActifs,
  modulesPourSession, matrice, configurationClient, definir, activerALaCreation, clientSequelize, preparerCaisse,
};
