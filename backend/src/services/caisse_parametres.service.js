// src/services/caisse_parametres.service.js — NJ CAISSE PRO : paramètres propres
// au module (lot B, migration 065).
//
// Ce qui ne sert qu'à la caisse se règle ici, et plus dans la configuration de
// l'entreprise :
//   • le plan comptable (SYSCOHADA révisé ou SYCEBNL) : CHOISI dans la caisse ;
//     la forme juridique de l'entreprise ne fait que le suggérer ;
//   • les signataires imprimés sur les documents de caisse (caissier, directeur) ;
//   • l'exercice comptable.
// La périodicité du budget garde son propre écran (tenant_periodicites, 040).
// Les colonnes restent dans la table tenants (aucun déplacement de données) :
// c'est ce service, et lui seul, qui les expose et les modifie.
const { query, getClient } = require('../config/database');
const planRef = require('./plan_referentiel.service');

class ErreurCaisse extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const exigerClient = (tenantId) => {
  if (!tenantId) throw new ErreurCaisse(400, 'Choisissez d\'abord un client.');
};
const texte = (v) => (v === null || v === undefined ? '' : String(v).trim());
// Dates lues en texte (to_char) : aucun décalage de fuseau horaire.
const dateIso = (d) => (d ? String(d).slice(0, 10) : null);

const lire = async (tenantId) => {
  exigerClient(tenantId);
  const { rows: [t] } = await query(
    `SELECT caissier_nom, directeur_nom, dirigeant_nom,
            to_char(exercice_debut, 'YYYY-MM-DD') AS exercice_debut, to_char(exercice_fin, 'YYYY-MM-DD') AS exercice_fin
       FROM tenants WHERE id = $1`, [tenantId]);
  if (!t) throw new ErreurCaisse(404, 'Client introuvable.');
  const e = await planRef.etat(tenantId);
  return {
    plan: {
      actuel: e.actuel,
      suggere: e.attendu,                     // suggestion tirée de la forme juridique
      ecart: e.actuel !== e.attendu,
      forme_juridique: e.forme_juridique,
      derniere_bascule: e.derniere_bascule,
      referentiels: planRef.REFERENTIELS,
    },
    signataires: {
      caissier_nom: t.caissier_nom || '',
      directeur_nom: t.directeur_nom || '',
      // Proposé quand aucun directeur signataire n'est saisi.
      representant_legal: t.dirigeant_nom || '',
    },
    exercice: { debut: dateIso(t.exercice_debut), fin: dateIso(t.exercice_fin) },
  };
};

const validerDate = (v, nom) => {
  const d = texte(v);
  if (!d) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) throw new ErreurCaisse(400, `${nom} invalide.`);
  return d;
};

/** Signataires et exercice. Un champ absent n'est pas modifié. */
const modifier = async ({ tenantId, userId, body = {} }) => {
  exigerClient(tenantId);
  const n = {};
  for (const k of ['caissier_nom', 'directeur_nom']) {
    if (body[k] === undefined) continue;
    const v = texte(body[k]);
    if (v.length > 120) throw new ErreurCaisse(400, 'Nom du signataire : 120 caractères au plus.');
    n[k] = v;
  }
  if (body.exercice_debut !== undefined) n.exercice_debut = validerDate(body.exercice_debut, 'Début d\'exercice');
  if (body.exercice_fin !== undefined) n.exercice_fin = validerDate(body.exercice_fin, 'Fin d\'exercice');
  const db = await getClient();
  try {
    await db.query('BEGIN');
    const { rows: [avant] } = await db.query(
      `SELECT caissier_nom, directeur_nom, to_char(exercice_debut, 'YYYY-MM-DD') AS exercice_debut,
              to_char(exercice_fin, 'YYYY-MM-DD') AS exercice_fin FROM tenants WHERE id = $1 FOR UPDATE`, [tenantId]);
    if (!avant) throw new ErreurCaisse(404, 'Client introuvable.');
    const debut = n.exercice_debut !== undefined ? n.exercice_debut : dateIso(avant.exercice_debut);
    const fin = n.exercice_fin !== undefined ? n.exercice_fin : dateIso(avant.exercice_fin);
    if (debut && fin && fin <= debut) throw new ErreurCaisse(400, 'La fin de l\'exercice doit être postérieure à son début.');
    const a = {}; const b = {};
    for (const [k, v] of Object.entries(n)) {
      const ancien = k.startsWith('exercice') ? dateIso(avant[k]) : (avant[k] || '');
      if (String(ancien ?? '') !== String(v ?? '')) { a[k] = ancien; b[k] = v; }
    }
    const cles = Object.keys(b);
    if (cles.length) {
      await db.query(`UPDATE tenants SET ${cles.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = NOW() WHERE id = $1`,
        [tenantId, ...cles.map((k) => b[k])]);
      await db.query(
        `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, ancienne_valeur, nouvelle_valeur)
         VALUES ($1, $2, 'CAISSE_PARAMETRES', 'caisse', $5, $3, $4)`, [tenantId, userId, JSON.stringify(a), JSON.stringify(b), String(tenantId)]);
    }
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    db.release();
  }
  return lire(tenantId);
};

const verifierReferentiel = (r) => {
  const ref = texte(r).toUpperCase();
  if (!planRef.REFERENTIELS[ref]) throw new ErreurCaisse(400, `Plan comptable inconnu (${Object.keys(planRef.REFERENTIELS).join(', ')}).`);
  return ref;
};

/** Aperçu d'un changement de plan comptable, sans rien écrire. */
const apercuPlan = async (tenantId, referentiel) => {
  exigerClient(tenantId);
  const cible = verifierReferentiel(referentiel);
  const e = await planRef.etat(tenantId);
  return { actuel: e.actuel, cible, cible_info: planRef.REFERENTIELS[cible], change: cible !== e.actuel,
    apercu: cible !== e.actuel ? await planRef.apercu(tenantId, cible) : null };
};

/**
 * Choix du plan comptable de la caisse. Bascule non destructive (comptes
 * sortants archivés, comptes utilisés conservés, retour possible), confirmée.
 */
const choisirPlan = async ({ tenantId, userId, referentiel, confirmer }) => {
  exigerClient(tenantId);
  const cible = verifierReferentiel(referentiel);
  if (confirmer !== true) throw new ErreurCaisse(400, 'Confirmez le changement de plan comptable.');
  const e = await planRef.etat(tenantId);
  if (cible === e.actuel) {
    return { message: `Le plan comptable applique déjà le ${planRef.REFERENTIELS[cible].libelle}.`, resultat: null, parametres: await lire(tenantId) };
  }
  const resultat = await planRef.basculer(tenantId, cible, userId);
  return {
    message: `Plan comptable de la caisse : ${planRef.REFERENTIELS[cible].libelle} (${resultat?.ajoutes ?? 0} compte(s) ajouté(s), ${resultat?.archives ?? 0} archivé(s)).`,
    resultat, parametres: await lire(tenantId),
  };
};

module.exports = { ErreurCaisse, lire, modifier, apercuPlan, choisirPlan };
