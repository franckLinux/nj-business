// src/services/entreprise.service.js — NJ BUSINESS : configuration centrale de
// l'entreprise (migration 064, lot A).
//
// L'identité de l'entreprise appartient au SOCLE : elle se lit et se modifie
// sans aucun module activé, et tous les modules la lisent ici au lieu de la
// recopier. Trois blocs :
//   • identité et coordonnées (table tenants, seule source) ;
//   • références légales (tenants + entreprise_references pour les références libres) ;
//   • représentant légal (entreprise_representants, avec historique).
// Les réglages propres à un module (plan comptable, signataires de caisse,
// paramètres commerciaux…) n'y figurent pas.
const { query, getClient } = require('../config/database');

class ErreurEntreprise extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const DEVISES = ['FCFA', 'EUR', 'USD'];
const MAX_REFERENCES = 20;
const SIGNATURE_MAX_CARACTERES = 200 * 1024;
const IMAGE_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// [colonne, longueur max, transformation]
const MAJ = (v) => v.toUpperCase();
const MIN = (v) => v.toLowerCase();
const CHAMPS = {
  // A. Identité
  nom: [200], nom_commercial: [150], sigle: [30, MAJ], slogan: [200], forme_juridique: [20, MAJ], activite: [200],
  pays: [100], region: [100], ville: [100], adresse: [300], boite_postale: [60],
  telephone: [60], email: [150, MIN], site_web: [200],
  // B. Références légales
  nui: [20, MAJ], registre_commerce: [80], immatriculation: [80], numero_statistique: [80], agrement: [120],
};
const COLONNES_IDENTITE = [...Object.keys(CHAMPS), 'devise', 'date_creation', 'logo_url'];

const exigerClient = (tenantId) => {
  if (!tenantId) throw new ErreurEntreprise(400, 'Choisissez d\'abord un client.');
};
const texte = (v) => (v === null || v === undefined ? '' : String(v).trim());
const formes = () => require('../controllers/config.controller').FORMES_JURIDIQUES;

const auditer = (db, { tenantId, userId, action, avant, apres, entiteId }) => db.query(
  `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, ancienne_valeur, nouvelle_valeur)
   VALUES ($1, $2, $3, 'entreprise', $4, $5, $6)`,
  [tenantId, userId, action, entiteId || tenantId, avant ? JSON.stringify(avant) : null, apres ? JSON.stringify(apres) : null]);

const nomComplet = (r) => (r ? [r.prenoms, r.nom].filter(Boolean).join(' ').trim() : '');

// ── Lecture ────────────────────────────────────────────────────────────────
const lireIdentite = async (tenantId, db = { query }) => {
  const { rows } = await db.query(
    `SELECT id, slug, ${COLONNES_IDENTITE.join(', ')}, updated_at FROM tenants WHERE id = $1`, [tenantId]);
  if (!rows[0]) throw new ErreurEntreprise(404, 'Entreprise introuvable.');
  const t = rows[0];
  for (const k of Object.keys(CHAMPS)) t[k] = t[k] || '';
  t.devise = t.devise || 'FCFA';
  t.logo_url = t.logo_url || '';
  return t;
};

const lireRepresentants = async (tenantId, db = { query }) => (await db.query(
  `SELECT r.id, r.nom, r.prenoms, r.fonction, r.telephone, r.email, r.adresse, r.signature_url,
          to_char(r.debut, 'YYYY-MM-DD') AS debut, to_char(r.fin, 'YYYY-MM-DD') AS fin, r.origine,
          r.cree_le, r.modifie_le, uc.username AS cree_par_nom, um.username AS modifie_par_nom
     FROM entreprise_representants r
     LEFT JOIN users uc ON uc.id = r.cree_par
     LEFT JOIN users um ON um.id = r.modifie_par
    WHERE r.tenant_id = $1
    ORDER BY (r.fin IS NULL) DESC, r.debut DESC, r.id DESC`, [tenantId])).rows.map((r) => ({ ...r, id: Number(r.id) }));

const lire = async (tenantId) => {
  exigerClient(tenantId);
  const [identite, refs, representants, modules] = await Promise.all([
    lireIdentite(tenantId),
    query('SELECT id, libelle, valeur, ordre FROM entreprise_references WHERE tenant_id = $1 ORDER BY ordre, id', [tenantId]),
    lireRepresentants(tenantId),
    query(`SELECT COUNT(*)::int AS n FROM tenant_modules tm JOIN modules m ON m.code = tm.module_code
            WHERE tm.tenant_id = $1 AND tm.actif AND m.statut = 'operationnel'`, [tenantId]).catch(() => ({ rows: [{ n: null }] })),
  ]);
  return {
    identite,
    references: refs.rows.map((r) => ({ ...r, id: Number(r.id) })),
    representant: representants.find((r) => !r.fin) || null,
    historique_representants: representants.filter((r) => r.fin),
    modules_actifs: modules.rows[0]?.n ?? null,
    formes_juridiques: formes(),
    devises: DEVISES,
  };
};

// ── Identité et références ─────────────────────────────────────────────────
const validerIdentite = (body, avant) => {
  const n = {};
  for (const [k, [max, f]] of Object.entries(CHAMPS)) {
    if (body[k] === undefined) continue;                  // absent : inchangé
    let v = texte(body[k]);
    if (v.length > max) throw new ErreurEntreprise(400, `${k.replace(/_/g, ' ')} : ${max} caractères au plus.`);
    if (f) v = f(v);
    n[k] = v;
  }
  if (n.nom !== undefined && !n.nom) throw new ErreurEntreprise(400, 'La raison sociale est obligatoire.');
  if (n.forme_juridique && !formes().some((x) => x.code === n.forme_juridique)) {
    throw new ErreurEntreprise(400, 'Forme juridique inconnue.');
  }
  if (n.email && !EMAIL_RE.test(n.email)) throw new ErreurEntreprise(400, 'Adresse e-mail invalide.');
  if (body.devise !== undefined) {
    const d = texte(body.devise).toUpperCase();
    if (!DEVISES.includes(d) && d !== avant.devise) throw new ErreurEntreprise(400, `Devise inconnue (${DEVISES.join(', ')}).`);
    n.devise = d;
  }
  if (body.date_creation !== undefined) {
    const d = texte(body.date_creation);
    if (d && (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d)))) throw new ErreurEntreprise(400, 'Date de création invalide.');
    if (d && d > new Date().toISOString().slice(0, 10)) throw new ErreurEntreprise(400, 'La date de création ne peut pas être dans le futur.');
    n.date_creation = d || null;
  }
  return n;
};

const validerReferences = (liste) => {
  if (!Array.isArray(liste)) throw new ErreurEntreprise(400, 'Références : liste attendue.');
  if (liste.length > MAX_REFERENCES) throw new ErreurEntreprise(400, `${MAX_REFERENCES} références au plus.`);
  return liste.map((r, i) => {
    const libelle = texte(r?.libelle);
    const valeur = texte(r?.valeur);
    if (!libelle || !valeur) throw new ErreurEntreprise(400, `Référence n° ${i + 1} : libellé et valeur sont obligatoires.`);
    if (libelle.length > 80 || valeur.length > 120) throw new ErreurEntreprise(400, `Référence n° ${i + 1} : trop longue.`);
    return { libelle, valeur, ordre: i };
  });
};

const comparer = (avant, apres) => {
  const a = {}; const b = {};
  for (const [k, v] of Object.entries(apres)) {
    const ancien = avant[k] instanceof Date ? avant[k].toISOString().slice(0, 10) : (avant[k] ?? null);
    if (String(ancien ?? '') !== String(v ?? '')) { a[k] = ancien; b[k] = v; }
  }
  return Object.keys(b).length ? { avant: a, apres: b } : null;
};

/**
 * Modifie l'identité et, si `references` est fourni, remplace la liste des
 * références libres. Ne touche ni au plan comptable ni à aucun réglage de module.
 */
const modifier = async ({ tenantId, userId, body }) => {
  exigerClient(tenantId);
  const db = await getClient();
  try {
    await db.query('BEGIN');
    await db.query('SELECT id FROM tenants WHERE id = $1 FOR UPDATE', [tenantId]);
    const avant = await lireIdentite(tenantId, db);
    const n = validerIdentite(body || {}, avant);
    const d = comparer(avant, n);
    if (d) {
      const cles = Object.keys(d.apres);
      await db.query(
        `UPDATE tenants SET ${cles.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = NOW() WHERE id = $1`,
        [tenantId, ...cles.map((k) => d.apres[k])]);
      await auditer(db, { tenantId, userId, action: 'ENTREPRISE_IDENTITE', avant: d.avant, apres: d.apres });
    }
    if (body?.references !== undefined) {
      const refs = validerReferences(body.references);
      const { rows: anciennes } = await db.query(
        'SELECT libelle, valeur FROM entreprise_references WHERE tenant_id = $1 ORDER BY ordre, id', [tenantId]);
      const avantR = anciennes.map((r) => `${r.libelle}=${r.valeur}`).join('|');
      const apresR = refs.map((r) => `${r.libelle}=${r.valeur}`).join('|');
      if (avantR !== apresR) {
        await db.query('DELETE FROM entreprise_references WHERE tenant_id = $1', [tenantId]);
        for (const r of refs) {
          await db.query('INSERT INTO entreprise_references (tenant_id, libelle, valeur, ordre, modifie_par) VALUES ($1, $2, $3, $4, $5)',
            [tenantId, r.libelle, r.valeur, r.ordre, userId]);
        }
        await auditer(db, { tenantId, userId, action: 'ENTREPRISE_REFERENCES', avant: anciennes, apres: refs.map(({ libelle, valeur }) => ({ libelle, valeur })) });
      }
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

// ── Logo ───────────────────────────────────────────────────────────────────
const definirLogo = async ({ tenantId, userId, logo }) => {
  exigerClient(tenantId);
  const { verifierLogo } = require('../controllers/config.controller');
  const v = verifierLogo(logo === undefined ? null : logo);
  if (v.erreur) throw new ErreurEntreprise(400, v.erreur);
  if (!v.valeur && logo !== null && logo !== '') throw new ErreurEntreprise(400, 'Choisissez une image.');
  const db = await getClient();
  try {
    await db.query('BEGIN');
    const { rows } = await db.query('SELECT logo_url FROM tenants WHERE id = $1 FOR UPDATE', [tenantId]);
    if (!rows[0]) throw new ErreurEntreprise(404, 'Entreprise introuvable.');
    const avait = Boolean(rows[0].logo_url);
    await db.query('UPDATE tenants SET logo_url = $2, updated_at = NOW() WHERE id = $1', [tenantId, v.valeur]);
    // Le journal garde la trace de l'opération, pas l'image.
    await auditer(db, { tenantId, userId, action: v.valeur ? (avait ? 'ENTREPRISE_LOGO_REMPLACE' : 'ENTREPRISE_LOGO_AJOUTE') : 'ENTREPRISE_LOGO_SUPPRIME',
      avant: { logo: avait }, apres: { logo: Boolean(v.valeur), taille: v.valeur ? v.valeur.length : 0 } });
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    db.release();
  }
  return lire(tenantId);
};

// ── Représentant légal ─────────────────────────────────────────────────────
const CHAMPS_REP = { nom: 120, prenoms: 150, fonction: 120, telephone: 60, email: 150, adresse: 300 };
const validerRepresentant = (body, { partiel = false } = {}) => {
  const n = {};
  for (const [k, max] of Object.entries(CHAMPS_REP)) {
    if (body[k] === undefined) { if (!partiel) n[k] = ''; continue; }
    const v = k === 'email' ? texte(body[k]).toLowerCase() : texte(body[k]);
    if (v.length > max) throw new ErreurEntreprise(400, `Représentant — ${k} : ${max} caractères au plus.`);
    n[k] = v;
  }
  if ((!partiel || n.nom !== undefined) && !n.nom) throw new ErreurEntreprise(400, 'Le nom du représentant légal est obligatoire.');
  if (n.email && !EMAIL_RE.test(n.email)) throw new ErreurEntreprise(400, 'Adresse e-mail du représentant invalide.');
  if (body.signature_url !== undefined) {
    const s = body.signature_url;
    if (s === null || s === '') n.signature_url = null;
    else if (typeof s !== 'string' || !IMAGE_RE.test(s)) throw new ErreurEntreprise(400, 'Signature invalide : image PNG, JPEG ou WebP.');
    else if (s.length > SIGNATURE_MAX_CARACTERES) throw new ErreurEntreprise(400, 'Image de signature trop volumineuse (150 Ko maximum).');
    else n.signature_url = s;
  }
  return n;
};

// Le nom du dirigeant reste recopié dans tenants (dirigeant_nom, directeur_nom)
// pour les écrans et documents de la caisse qui le lisent encore (compatibilité).
const refleterDirigeant = (db, tenantId, rep) => db.query(
  'UPDATE tenants SET dirigeant_nom = $2, directeur_nom = $2, updated_at = NOW() WHERE id = $1', [tenantId, nomComplet(rep)]);

/** Corrige le représentant en fonction (coordonnées, faute de frappe…) sans créer d'historique. */
const modifierRepresentant = async ({ tenantId, userId, body }) => {
  exigerClient(tenantId);
  const n = validerRepresentant(body || {}, { partiel: true });
  const db = await getClient();
  try {
    await db.query('BEGIN');
    const { rows } = await db.query(
      'SELECT * FROM entreprise_representants WHERE tenant_id = $1 AND fin IS NULL FOR UPDATE', [tenantId]);
    if (!rows[0]) throw new ErreurEntreprise(404, 'Aucun représentant légal en fonction : déclarez-en un.');
    const r = rows[0];
    const d = comparer(r, n);
    if (d) {
      const cles = Object.keys(d.apres);
      await db.query(`UPDATE entreprise_representants SET ${cles.map((k, i) => `${k} = $${i + 2}`).join(', ')},
                        modifie_par = $${cles.length + 2}, modifie_le = NOW() WHERE id = $1`,
      [r.id, ...cles.map((k) => d.apres[k]), userId]);
      const sansImage = (o) => { const c = { ...o }; if ('signature_url' in c) c.signature_url = c.signature_url ? '(image)' : null; return c; };
      await auditer(db, { tenantId, userId, action: 'ENTREPRISE_REPRESENTANT_MODIFIE', entiteId: String(r.id), avant: sansImage(d.avant), apres: sansImage(d.apres) });
      if (d.apres.nom !== undefined || d.apres.prenoms !== undefined) await refleterDirigeant(db, tenantId, { ...r, ...n });
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

/**
 * Changement de représentant légal : la personne en fonction est clôturée à la
 * veille de la prise de fonction du nouveau, qui devient le représentant en cours.
 * L'identité de l'entreprise n'est pas modifiée.
 */
const changerRepresentant = async ({ tenantId, userId, body }) => {
  exigerClient(tenantId);
  const n = validerRepresentant(body || {});
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const debut = texte(body?.debut) || aujourdhui;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(debut) || Number.isNaN(Date.parse(debut))) throw new ErreurEntreprise(400, 'Date de prise de fonction invalide.');
  const db = await getClient();
  try {
    await db.query('BEGIN');
    await db.query('SELECT id FROM tenants WHERE id = $1 FOR UPDATE', [tenantId]);   // sérialise les changements
    const { rows } = await db.query(
      `SELECT id, nom, prenoms, to_char(debut, 'YYYY-MM-DD') AS debut FROM entreprise_representants
        WHERE tenant_id = $1 AND fin IS NULL FOR UPDATE`, [tenantId]);
    const actuel = rows[0];
    if (actuel) {
      if (debut <= actuel.debut) {
        throw new ErreurEntreprise(400, `La prise de fonction doit être postérieure à celle du représentant actuel (${actuel.debut.split('-').reverse().join('/')}).`);
      }
      await db.query(`UPDATE entreprise_representants SET fin = ($2::date - 1), modifie_par = $3, modifie_le = NOW() WHERE id = $1`,
        [actuel.id, debut, userId]);
    }
    const { rows: [cree] } = await db.query(
      `INSERT INTO entreprise_representants (tenant_id, nom, prenoms, fonction, telephone, email, adresse, signature_url, debut, cree_par, modifie_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) RETURNING id`,
      [tenantId, n.nom, n.prenoms, n.fonction, n.telephone, n.email, n.adresse, n.signature_url ?? null, debut, userId]);
    await refleterDirigeant(db, tenantId, n);
    await auditer(db, { tenantId, userId, action: 'ENTREPRISE_REPRESENTANT_CHANGE', entiteId: String(cree.id),
      avant: actuel ? { id: Number(actuel.id), nom: nomComplet(actuel) } : null,
      apres: { id: Number(cree.id), nom: nomComplet(n), fonction: n.fonction, debut } });
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    db.release();
  }
  return lire(tenantId);
};

// ── Identité pour les documents des modules ────────────────────────────────
/**
 * Identité de l'émetteur telle qu'elle s'imprime sur les documents de TOUS les
 * modules. `db` permet de la lire dans la transaction d'émission.
 */
const identiteDocuments = async (tenantId, db = { query }) => {
  const t = await lireIdentite(tenantId, db);
  const [{ rows: refs }, { rows: rep }] = await Promise.all([
    db.query('SELECT libelle, valeur FROM entreprise_references WHERE tenant_id = $1 ORDER BY ordre, id', [tenantId]),
    db.query('SELECT nom, prenoms, fonction FROM entreprise_representants WHERE tenant_id = $1 AND fin IS NULL', [tenantId]),
  ]);
  return {
    raison_sociale: t.nom, nom_commercial: t.nom_commercial, nom_affiche: t.nom_commercial || t.nom,
    sigle: t.sigle, slogan: t.slogan, forme_juridique: t.forme_juridique, activite: t.activite,
    logo_url: t.logo_url, adresse: t.adresse, boite_postale: t.boite_postale, ville: t.ville, region: t.region, pays: t.pays,
    telephone: t.telephone, email: t.email, site_web: t.site_web, devise: t.devise,
    nui: t.nui, registre_commerce: t.registre_commerce, immatriculation: t.immatriculation,
    numero_statistique: t.numero_statistique, agrement: t.agrement, references: refs,
    representant: rep[0] ? { nom: nomComplet(rep[0]), fonction: rep[0].fonction } : null,
    figee_le: new Date().toISOString(),
  };
};

/** Identité à imprimer : celle figée sur un document émis, sinon l'identité actuelle. */
const identitePour = async (tenantId, figee, db) => (figee && typeof figee === 'object' && figee.raison_sociale
  ? figee : identiteDocuments(tenantId, db));

module.exports = {
  ErreurEntreprise, DEVISES, lire, modifier, definirLogo, modifierRepresentant, changerRepresentant,
  identiteDocuments, identitePour,
};
