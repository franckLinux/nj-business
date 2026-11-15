// src/services/plan_referentiel.service.js
// Référentiel comptable du client : SYSCOHADA révisé (défaut) ou SYCEBNL
// (associations et ONG) — migration 060.
//
// Règle unique : la forme juridique de l'entité décide du référentiel
// (fonction SQL plan_referentiel_de_forme, reprise ici pour l'interface).
// La bascule du plan d'un client se fait en base, en un bloc
// (plan_client_basculer) : aperçu sans écriture, puis application.
// Rien n'est supprimé, les comptes utilisés restent actifs, les comptes
// additifs du client ne sont jamais touchés, et la bascule inverse restaure
// l'état précédent.
const { sequelize } = require('../models');

const SELECT = sequelize.QueryTypes.SELECT;

const REFERENTIELS = {
  SYSCOHADA: {
    code: 'SYSCOHADA',
    libelle: 'SYSCOHADA révisé',
    description: 'Entités à but lucratif — Acte uniforme relatif au droit comptable (AUDCIF)',
  },
  SYCEBNL: {
    code: 'SYCEBNL',
    libelle: 'SYCEBNL',
    description: 'Entités à but non lucratif — associations, ONG (Acte uniforme SYCEBNL)',
  },
};

// Formes juridiques relevant du SYCEBNL. Une seule liste, alignée sur
// plan_referentiel_de_forme() (migration 060).
const FORMES_EBNL = ['ASSOC', 'ONG'];

const referentielDeForme = (forme) =>
  (FORMES_EBNL.includes(String(forme || '').trim().toUpperCase()) ? 'SYCEBNL' : 'SYSCOHADA');

class ErreurReferentiel extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

/** État du client : référentiel en place, référentiel attendu par sa forme juridique. */
const etat = async (tenantId, { transaction } = {}) => {
  const [t] = await sequelize.query(
    `SELECT t.forme_juridique, t.plan_referentiel, t.plan_initialise_le,
            (SELECT json_build_object('de', b.de, 'vers', b.vers, 'le', b.created_at, 'par', u.username, 'resume', b.resume)
               FROM plan_bascules b LEFT JOIN users u ON u.id = b.user_id
              WHERE b.tenant_id = t.id ORDER BY b.created_at DESC LIMIT 1) AS derniere_bascule
       FROM tenants t WHERE t.id = :tenantId`,
    { replacements: { tenantId }, type: SELECT, transaction }
  );
  if (!t) throw new ErreurReferentiel(404, 'Entité introuvable.');
  const actuel = t.plan_referentiel || 'SYSCOHADA';
  const attendu = referentielDeForme(t.forme_juridique);
  return {
    forme_juridique: t.forme_juridique || '',
    actuel, attendu,
    a_basculer: actuel !== attendu,
    actuel_info: REFERENTIELS[actuel],
    attendu_info: REFERENTIELS[attendu],
    derniere_bascule: t.derniere_bascule || null,
  };
};

const appeler = async (tenantId, cible, userId, simuler, transaction) => {
  if (!REFERENTIELS[cible]) throw new ErreurReferentiel(400, 'Référentiel inconnu.');
  const [r] = await sequelize.query(
    'SELECT plan_client_basculer(:tenantId, :cible, :userId, :simuler) AS r',
    { replacements: { tenantId, cible, userId: userId || null, simuler }, type: SELECT, transaction }
  );
  return r.r;
};

/** Aperçu de la bascule vers `cible` (aucune écriture). */
const apercu = async (tenantId, cible, { transaction } = {}) =>
  appeler(tenantId, cible, null, true, transaction);

/**
 * Bascule le plan du client vers `cible`. À appeler dans la transaction qui
 * change la forme juridique, pour que l'entité et son plan restent cohérents.
 */
const basculer = async (tenantId, cible, userId, { transaction } = {}) => {
  if (transaction) return appeler(tenantId, cible, userId, false, transaction);
  return sequelize.transaction((t) => appeler(tenantId, cible, userId, false, t));
};

module.exports = {
  REFERENTIELS, FORMES_EBNL, referentielDeForme, etat, apercu, basculer, ErreurReferentiel,
};
