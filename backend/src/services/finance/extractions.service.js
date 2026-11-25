'use strict';
// NJ FINANCE — lot F7 : import et lecture automatique des factures fournisseurs
// (migration 082, décision D7).
//
//  1. Dépôt : PDF ou photo (JPEG, PNG, WebP), 7 Mo au plus ; type vérifié sur
//     la signature réelle du fichier ; stockage PRIVÉ (073) ; empreinte SHA-256 :
//     une pièce déjà transformée en facture est refusée (lien vers la facture),
//     une pièce déjà en cours de lecture ou à vérifier est rendue telle quelle.
//  2. Lecture : file d'attente en mémoire, UNE pièce à la fois, dans un fil
//     séparé (lecture/lecture.worker.js) arrêté au bout de 2 minutes au plus.
//     Au redémarrage du serveur, les pièces restées « en cours » sont relues.
//  3. Analyse (lecture/analyse_facture.js) : fournisseur (NIU puis nom),
//     référence, dates, totaux, TVA 19,25 %, lignes — avec niveau de confiance.
//  4. Vérification humaine OBLIGATOIRE : l'écran de saisie est prérempli, la
//     facture n'est créée (en brouillon, au circuit de validation habituel) que
//     lorsque la personne l'enregistre. La lecture passe alors « utilisée ».
// Aucune donnée n'est envoyée à un service extérieur.
const path = require('path');
const crypto = require('node:crypto');
const { Worker } = require('worker_threads');
const { sequelize } = require('../../models');
const storage = require('../storage.service');
const { analyser } = require('./lecture/analyse_facture');

const T = sequelize.QueryTypes;
const Q = (sql, replacements, opts = {}) => sequelize.query(sql, { replacements, type: T.SELECT, ...opts });
const X = (sql, replacements, opts = {}) => sequelize.query(sql, { replacements, ...opts });

const TAILLE_MAX = parseInt(process.env.LECTURE_TAILLE_MAX, 10) || 7 * 1024 * 1024;
const DELAI_MAX_MS = parseInt(process.env.LECTURE_DELAI_MS, 10) || 120000;
const WORKER = path.join(__dirname, 'lecture', 'lecture.worker.js');

class ErreurExtraction extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

const idValide = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ErreurExtraction(400, 'Lecture invalide.');
  return n;
};

// ── Lecture dans un fil séparé ──────────────────────────────────────────────
const lireDansUnFil = (contenu, mime) => new Promise((resoudre, rejeter) => {
  const fil = new Worker(WORKER, { workerData: { contenu, mime } });
  let fini = false;
  const finir = (fn, v) => { if (fini) return; fini = true; clearTimeout(minuteur); fn(v); };
  const minuteur = setTimeout(() => {
    fil.terminate().then(
      () => finir(rejeter, new Error('Lecture trop longue : interrompue au bout de 2 minutes.')),
      (e) => finir(rejeter, e),
    );
  }, DELAI_MAX_MS);
  fil.once('message', (m) => {
    finir(m.ok ? resoudre : rejeter, m.ok ? m : new Error(m.message));
    fil.terminate().catch((e) => console.error('[NJ FINANCE] arrêt du fil de lecture :', e.message));
  });
  fil.once('error', (e) => finir(rejeter, e));
  fil.once('exit', (code) => finir(rejeter, new Error(`Le fil de lecture s'est arrêté (code ${code}).`)));
});

// ── File d'attente : une pièce à la fois ────────────────────────────────────
const file = [];
let actif = false;
let attenteVide = [];

const contexte = async (tenantId) => {
  const [t] = await Q('SELECT nui FROM tenants WHERE id = :tenantId', { tenantId });
  const tiers = await Q(`SELECT id, nom, nui FROM registre_tiers WHERE tenant_id = :tenantId AND actif AND type IN ('fournisseur', 'mixte')`, { tenantId });
  return { niuPropre: t?.nui || '', tiers };
};

const traiter = async (eid) => {
  const [e] = await Q(`SELECT id, tenant_id, fichier_chemin, mime FROM fin_extractions WHERE id = :eid AND statut = 'en_cours'`, { eid });
  if (!e) return;
  const debut = Date.now();
  try {
    const contenu = await require('fs/promises').readFile(storage.cheminComplet(e.fichier_chemin));
    const r = await lireDansUnFil(contenu, e.mime);
    const champs = analyser(r.texte, { ...(await contexte(e.tenant_id)), confianceOcr: r.confiance });
    const lisible = r.texte.replace(/\s+/g, '').length >= 20;
    await X(`UPDATE fin_extractions SET statut = :statut, moteur = :moteur, texte = :texte, confiance_ocr = :conf,
                    champs = CAST(:champs AS jsonb), message = :message, traite_le = NOW(), duree_ms = :duree
              WHERE id = :eid AND statut = 'en_cours'`,
    { eid, statut: lisible ? 'a_verifier' : 'echec', moteur: r.moteur, texte: r.texte.slice(0, 100000),
      conf: r.confiance === null || r.confiance === undefined ? null : Math.round(r.confiance * 100) / 100,
      champs: JSON.stringify(champs), message: lisible ? '' : 'Aucun texte lisible sur la pièce : saisissez la facture à la main.',
      duree: Date.now() - debut });
  } catch (err) {
    console.error(`[NJ FINANCE] lecture de la pièce ${eid} :`, err.message);
    await X(`UPDATE fin_extractions SET statut = 'echec', message = :message, traite_le = NOW(), duree_ms = :duree
              WHERE id = :eid AND statut = 'en_cours'`,
    { eid, message: `Lecture impossible : ${String(err.message).slice(0, 400)}`, duree: Date.now() - debut });
  }
};

const suivante = async () => {
  if (actif) return;
  actif = true;
  try {
    while (file.length) {
      const eid = file.shift();
      try { await traiter(eid); } catch (err) {
        // L'échec lui-même n'a pu être enregistré (base indisponible) : journalisé, la pièce sera relue au redémarrage.
        console.error(`[NJ FINANCE] lecture ${eid} non enregistrée :`, err.message);
      }
    }
  } finally {
    actif = false;
    const a = attenteVide; attenteVide = [];
    a.forEach((f) => f());
  }
};
const enfiler = (eid) => { file.push(String(eid)); setImmediate(suivante); };

/** Promesse résolue quand la file est vide (tests, arrêt propre). */
const fileVide = () => (actif || file.length ? new Promise((r) => attenteVide.push(r)) : Promise.resolve());

/** Au démarrage : relire les pièces restées « en cours » (serveur arrêté pendant une lecture). */
const reprendre = async () => {
  const restes = await Q(`SELECT id FROM fin_extractions WHERE statut = 'en_cours' ORDER BY id`);
  restes.forEach((r) => enfiler(r.id));
  return restes.length;
};

// ── Dépôt ───────────────────────────────────────────────────────────────────
const deposer = async ({ tenantId, userId, body }) => {
  const nom = String(body?.nom_fichier || '').trim().slice(0, 200) || 'facture';
  const b64 = String(body?.data_base64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!b64 || !/^[A-Za-z0-9+/\r\n]+=*$/.test(b64)) throw new ErreurExtraction(400, 'Fichier absent ou mal transmis.');
  const contenu = Buffer.from(b64, 'base64');
  if (!contenu.length) throw new ErreurExtraction(400, 'Fichier vide.');
  if (contenu.length > TAILLE_MAX) throw new ErreurExtraction(413, `Fichier trop lourd : ${Math.floor(TAILLE_MAX / 1048576)} Mo au plus.`);
  const mime = storage.typeReel(contenu);
  if (!mime) throw new ErreurExtraction(415, 'Format non pris en charge : PDF, JPEG, PNG ou WebP seulement.');
  const sha256 = crypto.createHash('sha256').update(contenu).digest('hex');

  const [deja] = await Q(
    `SELECT e.id, e.statut, e.facture_id, f.numero, f.statut AS statut_facture
       FROM fin_extractions e LEFT JOIN fin_factures f ON f.id = e.facture_id
      WHERE e.tenant_id = :tenantId AND e.sha256 = :sha256 AND e.statut IN ('en_cours', 'a_verifier', 'utilisee')
        AND (e.statut <> 'utilisee' OR f.statut <> 'annulee')
      ORDER BY e.id DESC LIMIT 1`, { tenantId, sha256 });
  if (deja?.statut === 'utilisee') {
    throw new ErreurExtraction(409, `Cette pièce a déjà servi à la facture ${deja.numero || '(brouillon)'}.`,
      { doublon: { origine: 'fin', id: String(deja.facture_id) } });
  }
  if (deja) return { id: String(deja.id), statut: deja.statut, deja_deposee: true };

  const { path: chemin, size } = await storage.save(tenantId, 'extractions', contenu, mime);
  const [[e]] = await X(
    `INSERT INTO fin_extractions (tenant_id, fichier_chemin, fichier_nom, mime, taille, sha256, cree_par)
     VALUES (:tenantId, :chemin, :nom, :mime, :size, :sha256, :userId) RETURNING id`,
    { tenantId, chemin, nom, mime, size, sha256, userId: userId || null });
  enfiler(e.id);
  return { id: String(e.id), statut: 'en_cours', deja_deposee: false };
};

// ── Consultation ────────────────────────────────────────────────────────────
const COLONNES = `e.id::text AS id, e.fichier_nom, e.mime, e.taille, e.statut, e.moteur, e.confiance_ocr, e.message,
  e.facture_id::text AS facture_id, f.numero AS facture_numero, e.cree_le, e.traite_le, e.duree_ms,
  coalesce(u.username, '') AS cree_par_nom,
  e.champs -> 'fournisseur' -> 'valeur' ->> 'nom' AS fournisseur, e.champs -> 'total_ttc' ->> 'valeur' AS total_ttc,
  e.champs -> 'reference' ->> 'valeur' AS reference`;

const lister = async (tenantId, q = {}) => {
  const statut = ['en_cours', 'a_verifier', 'echec', 'utilisee', 'abandonnee'].includes(q.statut) ? q.statut : null;
  const lignes = await Q(
    `SELECT ${COLONNES}
       FROM fin_extractions e LEFT JOIN fin_factures f ON f.id = e.facture_id LEFT JOIN users u ON u.id = e.cree_par
      WHERE e.tenant_id = :tenantId AND (CAST(:statut AS TEXT) IS NULL OR e.statut = :statut)
        AND (CAST(:statut AS TEXT) IS NOT NULL OR e.statut <> 'abandonnee' OR e.cree_le > NOW() - INTERVAL '30 days')
      ORDER BY e.id DESC LIMIT 200`, { tenantId, statut });
  const [compte] = await Q(
    `SELECT count(*) FILTER (WHERE statut = 'en_cours')::int AS en_cours, count(*) FILTER (WHERE statut = 'a_verifier')::int AS a_verifier,
            count(*) FILTER (WHERE statut = 'echec')::int AS echec
       FROM fin_extractions WHERE tenant_id = :tenantId`, { tenantId });
  return { lignes, compte };
};

const lire = async (tenantId, idBrut) => {
  const eid = idValide(idBrut);
  const [e] = await Q(
    `SELECT ${COLONNES}, e.texte, e.champs
       FROM fin_extractions e LEFT JOIN fin_factures f ON f.id = e.facture_id LEFT JOIN users u ON u.id = e.cree_par
      WHERE e.id = :eid AND e.tenant_id = :tenantId`, { eid, tenantId });
  if (!e) throw new ErreurExtraction(404, 'Lecture introuvable.');
  // Taxe proposée : la TVA à 19,25 % du paramétrage du client, si le taux lu est celui-là.
  if (e.champs?.taux_tva?.valeur !== null && e.champs?.taux_tva?.valeur !== undefined) {
    const [t] = await Q(`SELECT id::text AS id, code FROM com_taxes WHERE tenant_id = :tenantId AND actif AND taux = :taux ORDER BY id LIMIT 1`,
      { tenantId, taux: e.champs.taux_tva.valeur });
    e.taxe_proposee = t || null;
  }
  if (e.statut === 'en_cours') e.rang = Math.max(0, file.indexOf(String(eid))) + (actif ? 1 : 0);
  return e;
};

const fichier = async (tenantId, idBrut) => {
  const eid = idValide(idBrut);
  const [e] = await Q('SELECT fichier_chemin, fichier_nom, mime FROM fin_extractions WHERE id = :eid AND tenant_id = :tenantId', { eid, tenantId });
  if (!e) throw new ErreurExtraction(404, 'Pièce introuvable.');
  return { chemin: storage.cheminComplet(e.fichier_chemin), nom: e.fichier_nom, mime: e.mime };
};

const abandonner = async ({ tenantId, id: idBrut }) => {
  const eid = idValide(idBrut);
  const [, n] = await X(`UPDATE fin_extractions SET statut = 'abandonnee' WHERE id = :eid AND tenant_id = :tenantId
                           AND statut IN ('a_verifier', 'echec')`, { eid, tenantId });
  if (!n?.rowCount) throw new ErreurExtraction(409, 'Seule une lecture à vérifier ou en échec s\'abandonne.');
  return { statut: 'abandonnee' };
};

// ── Lien avec la facture (appelé dans la transaction de création) ───────────
const rattacher = async (transaction, tenantId, idBrut, factureId) => {
  const eid = idValide(idBrut);
  const [, n] = await X(`UPDATE fin_extractions SET statut = 'utilisee', facture_id = :factureId
                          WHERE id = :eid AND tenant_id = :tenantId AND statut = 'a_verifier'`,
  { eid, tenantId, factureId }, { transaction });
  if (!n?.rowCount) throw new ErreurExtraction(409, 'Cette lecture n\'est plus à vérifier (déjà utilisée ou abandonnée) : rechargez la page.');
};
/** Brouillon supprimé : sa pièce redevient « à vérifier ». */
const liberer = (transaction, factureId) => X(
  `UPDATE fin_extractions SET statut = 'a_verifier', facture_id = NULL WHERE facture_id = :factureId`, { factureId }, { transaction });

const pourFacture = async (tenantId, factureId) => {
  const [e] = await Q(`SELECT id::text AS id, fichier_nom, mime FROM fin_extractions WHERE tenant_id = :tenantId AND facture_id = :factureId`,
    { tenantId, factureId });
  return e || null;
};

module.exports = {
  ErreurExtraction, deposer, lister, lire, fichier, abandonner, rattacher, liberer, pourFacture, reprendre, fileVide, TAILLE_MAX,
};
