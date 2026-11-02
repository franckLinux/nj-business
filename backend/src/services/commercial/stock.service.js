'use strict';
// NJ COMMERCIAL — moteur de stock (lot 4, migration 056).
//
// Le stock n'est qu'une somme de mouvements (com_stock_mouvements) écrits par des
// documents VALIDÉS. La valorisation est recalculée par REJEU déterministe de
// tous les mouvements non annulés d'un article (tous magasins, dans l'ordre de
// validation) ; soldes, lots FIFO et consommations ne sont que des caches
// reconstruits à l'identique.
//
// Règles de coût (par unité de stock) :
//   • entrée diverse, stock d'ouverture, réception : le coût saisi ou reçu ;
//     stock d'ouverture sans coût → « à valoriser » (coût inconnu, compté 0) ;
//   • sortie (diverse, livraison, retour fournisseur, manquant d'inventaire,
//     départ de transfert) : CMUP du moment, ou lots FIFO du plus ancien au plus récent ;
//   • arrivée de transfert : exactement le coût de sortie du magasin de départ
//     (aucun coût d'acquisition n'est créé par un transfert) ;
//   • excédent d'inventaire : dernier coût connu de l'article dans le magasin.
// La méthode est celle de l'article ; elle ne change plus dès qu'un mouvement valorisé existe.
const { sequelize } = require('../../models');

const T = sequelize.QueryTypes;
const Q = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: T.SELECT, transaction });
const X = (sql, replacements, transaction) => sequelize.query(sql, { replacements, transaction });

const q3 = (n) => Math.round(n * 1000) / 1000;
const m2 = (n) => Math.round(n * 100) / 100;
const c6 = (n) => Math.round(n * 1e6) / 1e6;

const ENTREES = ['stock_initial', 'entree', 'transfert_entree', 'inventaire_plus', 'reception', 'retour_client'];
const SORTIES = ['sortie', 'transfert_sortie', 'inventaire_moins', 'livraison', 'retour_fournisseur'];
const LIBELLES = {
  stock_initial: 'Stock d\'ouverture', entree: 'Entrée diverse', sortie: 'Sortie diverse', transfert_sortie: 'Transfert (départ)',
  transfert_entree: 'Transfert (arrivée)', inventaire_plus: 'Inventaire : excédent', inventaire_moins: 'Inventaire : manquant',
  reception: 'Réception fournisseur', retour_fournisseur: 'Retour fournisseur', livraison: 'Livraison client', retour_client: 'Retour client',
};

// Sérialise tout ce qui touche au stock d'un article (validation, annulation, rejeu).
const verrouiller = (tr, articleId) => Q('SELECT id FROM com_articles WHERE id = :a FOR UPDATE', { a: articleId }, tr);

// Quantité réelle (mouvements non annulés) d'un article dans un magasin, en unité de stock.
const quantite = async (tr, articleId, magasinId) => {
  const [r] = await Q('SELECT COALESCE(SUM(sens * quantite), 0) AS q FROM com_stock_mouvements WHERE article_id = :a AND magasin_id = :m AND NOT annule',
    { a: articleId, m: magasinId }, tr);
  return Number(r.q);
};

// Écrit un mouvement (le rejeu calcule ensuite son coût s'il ne l'a pas).
const ecrire = async (tr, m) => {
  const sens = ENTREES.includes(m.type) ? 1 : -1;
  const [r] = await Q(
    `INSERT INTO com_stock_mouvements (tenant_id, article_id, magasin_id, type, sens, quantite, date_mouvement, piece, observation,
       cout_unitaire, document_type, document_id, ligne_id, mouvement_lie_id, cree_par, modifie_par)
     VALUES (:t, :a, :m, :type, :sens, :q, :d, :piece, :obs, :cout, :dt, :di, :li, :lie, :u, :u) RETURNING id`,
    { t: m.tenantId, a: m.articleId, m: m.magasinId, type: m.type, sens, q: q3(m.quantite), d: m.date, piece: String(m.piece || '').slice(0, 60),
      obs: String(m.observation || '').slice(0, 500), cout: m.cout === undefined || m.cout === null ? null : c6(m.cout),
      dt: m.documentType || '', di: m.documentId || null, li: m.ligneId || null, lie: m.lieId || null, u: m.userId }, tr);
  return Number(r.id);
};

// ── Rejeu ────────────────────────────────────────────────────────────────
const rejouer = async (tr, tenantId, articleId) => {
  const [art] = await Q('SELECT methode_valorisation FROM com_articles WHERE id = :a', { a: articleId }, tr);
  const fifo = art?.methode_valorisation === 'fifo';
  const mvts = await Q(`SELECT id, magasin_id, type, sens, quantite, date_mouvement, cout_unitaire, valeur, mouvement_lie_id
                          FROM com_stock_mouvements WHERE article_id = :a AND NOT annule ORDER BY id`, { a: articleId }, tr);
  const etats = new Map();
  const etat = (mag) => {
    if (!etats.has(mag)) etats.set(mag, { q: 0, v: 0, cmup: null, dernier: null, lots: [], aValoriser: false, date: null });
    return etats.get(mag);
  };
  const coutSortie = new Map();     // mouvement → coût unitaire de sortie (pour l'arrivée d'un transfert)
  const resultats = [];             // [id, cout, valeur]
  const consommations = [];         // [mouvementId, lotIndex(magasin, i), quantite, cout]
  for (const m of mvts) {
    const s = etat(Number(m.magasin_id));
    const qte = Number(m.quantite);
    s.date = m.date_mouvement;
    if (Number(m.sens) === 1) {
      let cout;
      if (m.type === 'transfert_entree') cout = coutSortie.has(Number(m.mouvement_lie_id)) ? coutSortie.get(Number(m.mouvement_lie_id)) : null;
      else if (m.type === 'inventaire_plus') cout = s.dernier;
      else cout = m.cout_unitaire === null ? null : Number(m.cout_unitaire);
      if (cout === null) s.aValoriser = true;
      const c = cout ?? 0;
      if (fifo) s.lots.push({ mouvement: Number(m.id), date: m.date_mouvement, qi: qte, qr: qte, cout });
      const nq = q3(s.q + qte);
      s.v = s.v + qte * c;
      s.cmup = nq > 0 ? s.v / nq : (cout ?? s.cmup);
      s.q = nq;
      if (cout !== null) s.dernier = cout;
      resultats.push([Number(m.id), cout, cout === null ? null : m2(qte * cout)]);
    } else {
      let cout; let valeur;
      if (fifo) {
        let reste = qte; let total = 0; let inconnu = false;
        for (const l of s.lots) {
          if (reste <= 0) break;
          if (l.qr <= 0) continue;
          const pris = Math.min(l.qr, reste);
          l.qr = q3(l.qr - pris); reste = q3(reste - pris);
          if (l.cout === null) inconnu = true; else total += pris * l.cout;
          consommations.push({ mouvement: Number(m.id), lot: l, quantite: pris, cout: l.cout });
        }
        if (reste > 0) {               // stock négatif autorisé : le surplus au dernier coût connu
          if (s.dernier === null) inconnu = true; else total += reste * s.dernier;
        }
        cout = inconnu ? null : (qte > 0 ? total / qte : 0);
        valeur = inconnu ? null : m2(total);
        s.v -= total;
      } else {
        cout = s.aValoriser ? null : s.cmup;   // une part du stock n'a pas de coût : sortie « à valoriser »
        valeur = cout === null ? null : m2(qte * cout);
        s.v -= qte * (s.cmup ?? 0);
      }
      s.q = q3(s.q - qte);
      if (s.q <= 0) { s.v = s.q < 0 ? s.q * (s.cmup ?? 0) : 0; if (s.q === 0 && !fifo) s.aValoriser = false; }
      coutSortie.set(Number(m.id), cout === null ? null : c6(cout));
      resultats.push([Number(m.id), cout === null ? null : c6(cout), valeur]);
    }
  }
  // Coûts et valeurs des mouvements (seules colonnes que le déclencheur laisse changer).
  for (const [id, cout, valeur] of resultats) {
    await X('UPDATE com_stock_mouvements SET cout_unitaire = :c, valeur = :v WHERE id = :id AND (cout_unitaire IS DISTINCT FROM :c OR valeur IS DISTINCT FROM :v)',
      { id, c: cout === null ? null : c6(cout), v: valeur }, tr);
  }
  // Caches : lots, consommations, soldes.
  await X('DELETE FROM com_stock_consommations WHERE mouvement_id IN (SELECT id FROM com_stock_mouvements WHERE article_id = :a)', { a: articleId }, tr);
  await X('DELETE FROM com_stock_lots WHERE article_id = :a', { a: articleId }, tr);
  if (fifo) {
    for (const [mag, s] of etats) {
      for (const l of s.lots) {
        const [r] = await Q(`INSERT INTO com_stock_lots (tenant_id, article_id, magasin_id, mouvement_id, date_entree, quantite_initiale, quantite_restante, cout_unitaire)
                             VALUES (:t, :a, :m, :mv, :d, :qi, :qr, :c) RETURNING id`,
        { t: tenantId, a: articleId, m: mag, mv: l.mouvement, d: l.date, qi: l.qi, qr: l.qr, c: l.cout === null ? null : c6(l.cout) }, tr);
        l.id = Number(r.id);
      }
    }
    for (const c of consommations) {
      await X(`INSERT INTO com_stock_consommations (mouvement_id, lot_id, tenant_id, quantite, cout_unitaire) VALUES (:mv, :l, :t, :q, :c)
               ON CONFLICT (mouvement_id, lot_id) DO UPDATE SET quantite = com_stock_consommations.quantite + EXCLUDED.quantite`,
      { mv: c.mouvement, l: c.lot.id, t: tenantId, q: q3(c.quantite), c: c.cout === null ? null : c6(c.cout) }, tr);
    }
  }
  // Magasins qui ont eu des mouvements (même tous annulés) : solde à jour.
  const tous = await Q('SELECT DISTINCT magasin_id FROM com_stock_mouvements WHERE article_id = :a', { a: articleId }, tr);
  for (const { magasin_id: mid } of tous) {
    const s = etats.get(Number(mid)) || { q: 0, v: 0, cmup: null, lots: [], aValoriser: false, date: null };
    const valeur = fifo ? s.lots.reduce((t, l) => t + l.qr * (l.cout ?? 0), 0) : s.v;
    await X(`INSERT INTO com_stock_soldes (tenant_id, article_id, magasin_id, quantite, valeur, cmup, a_valoriser, dernier_mouvement, calcule_le)
             VALUES (:t, :a, :m, :q, :v, :c, :av, :d, NOW())
             ON CONFLICT (article_id, magasin_id) DO UPDATE SET quantite = :q, valeur = :v, cmup = :c, a_valoriser = :av, dernier_mouvement = :d, calcule_le = NOW()`,
    { t: tenantId, a: articleId, m: Number(mid), q: q3(s.q), v: m2(valeur), c: s.cmup === null ? null : c6(s.cmup),
      av: fifo ? s.lots.some((l) => l.qr > 0 && l.cout === null) : s.aValoriser && s.q > 0, d: s.date }, tr);
  }
};

// ── Lecture ──────────────────────────────────────────────────────────────
const etat = async (ctx, { q = '', magasin_id = '', agence_id = '', famille_id = '', alertes = '', a_valoriser = '' } = {}) => {
  const r = { t: ctx.tenantId, q: String(q || '').trim().toLowerCase(), mg: Number.parseInt(magasin_id, 10) || 0, ag: Number.parseInt(agence_id, 10) || 0,
    fa: Number.parseInt(famille_id, 10) || 0, mags: ctx.magasins ? `{${ctx.magasins.join(',')}}` : null };
  r.like = `%${r.q}%`;
  const rows = await Q(
    `SELECT s.article_id, s.magasin_id, s.quantite, s.valeur, s.cmup, s.a_valoriser, s.dernier_mouvement,
            a.reference, a.designation, a.unite, a.seuil_alerte, a.methode_valorisation, a.famille_id, f.nom AS famille_nom,
            m.code AS magasin_code, m.nom AS magasin_nom, g.code AS agence_code
       FROM com_stock_soldes s
       JOIN com_articles a ON a.id = s.article_id JOIN com_familles f ON f.id = a.famille_id
       JOIN com_magasins m ON m.id = s.magasin_id JOIN com_agences g ON g.id = m.agence_id
      WHERE s.tenant_id = :t
        AND (CAST(:mags AS BIGINT[]) IS NULL OR s.magasin_id = ANY(CAST(:mags AS BIGINT[])))
        AND (:mg = 0 OR s.magasin_id = :mg) AND (:ag = 0 OR m.agence_id = :ag) AND (:fa = 0 OR a.famille_id = :fa)
        AND (:q = '' OR lower(a.reference) LIKE :like OR lower(a.designation) LIKE :like)
        ${alertes === '1' ? 'AND a.seuil_alerte IS NOT NULL AND s.quantite <= a.seuil_alerte' : ''}
        ${a_valoriser === '1' ? 'AND s.a_valoriser' : ''}
      ORDER BY upper(a.reference), upper(m.code) LIMIT 2000`, r);
  return rows.map((x) => ({
    ...x, article_id: Number(x.article_id), magasin_id: Number(x.magasin_id), famille_id: Number(x.famille_id), quantite: Number(x.quantite),
    valeur: Number(x.valeur), cmup: x.cmup === null ? null : Number(x.cmup), seuil_alerte: x.seuil_alerte === null ? null : Number(x.seuil_alerte),
    sous_seuil: x.seuil_alerte !== null && Number(x.quantite) <= Number(x.seuil_alerte),
  }));
};

const mouvements = async (ctx, { article_id = '', magasin_id = '', type = '', du = '', au = '', q = '' } = {}) => {
  const r = { t: ctx.tenantId, a: Number.parseInt(article_id, 10) || 0, mg: Number.parseInt(magasin_id, 10) || 0, type: LIBELLES[type] ? type : '',
    du: /^\d{4}-\d{2}-\d{2}$/.test(du) ? du : null, au: /^\d{4}-\d{2}-\d{2}$/.test(au) ? au : null,
    mags: ctx.magasins ? `{${ctx.magasins.join(',')}}` : null, q: String(q || '').trim().toLowerCase() };
  r.like = `%${r.q}%`;
  const rows = await Q(
    `SELECT s.id, s.type, s.sens, s.quantite, s.date_mouvement, s.cout_unitaire, s.valeur, s.annule, s.annule_le, s.document_type, s.document_id,
            s.piece, s.observation, a.reference, a.designation, a.unite, m.code AS magasin_code, d.numero AS document_numero, u.username AS par_nom
       FROM com_stock_mouvements s
       JOIN com_articles a ON a.id = s.article_id JOIN com_magasins m ON m.id = s.magasin_id
       LEFT JOIN com_stock_documents d ON s.document_type IN ('entree', 'sortie', 'transfert', 'inventaire') AND d.id = s.document_id
       LEFT JOIN users u ON u.id = s.cree_par
      WHERE s.tenant_id = :t
        AND (CAST(:mags AS BIGINT[]) IS NULL OR s.magasin_id = ANY(CAST(:mags AS BIGINT[])))
        AND (:a = 0 OR s.article_id = :a) AND (:mg = 0 OR s.magasin_id = :mg) AND (:type = '' OR s.type = :type)
        AND (CAST(:du AS DATE) IS NULL OR s.date_mouvement >= CAST(:du AS DATE)) AND (CAST(:au AS DATE) IS NULL OR s.date_mouvement <= CAST(:au AS DATE))
        AND (:q = '' OR lower(a.reference) LIKE :like OR lower(a.designation) LIKE :like OR lower(COALESCE(d.numero, '')) LIKE :like)
      ORDER BY s.date_mouvement DESC, s.id DESC LIMIT 1000`, r);
  return rows.map((x) => ({
    ...x, id: Number(x.id), sens: Number(x.sens), quantite: Number(x.quantite), document_id: x.document_id ? Number(x.document_id) : null,
    cout_unitaire: x.cout_unitaire === null ? null : Number(x.cout_unitaire), valeur: x.valeur === null ? null : Number(x.valeur), libelle: LIBELLES[x.type],
  }));
};

// Valorisation : totaux par magasin (et pour le client).
const valorisation = async (ctx, query = {}) => {
  const lignes = await etat(ctx, query);
  const parMagasin = new Map();
  for (const l of lignes) {
    const k = l.magasin_id;
    const x = parMagasin.get(k) || { magasin_id: k, magasin_code: l.magasin_code, magasin_nom: l.magasin_nom, agence_code: l.agence_code, articles: 0, valeur: 0, a_valoriser: 0 };
    if (l.quantite !== 0) x.articles += 1;
    x.valeur = m2(x.valeur + l.valeur);
    if (l.a_valoriser) x.a_valoriser += 1;
    parMagasin.set(k, x);
  }
  const magasins = [...parMagasin.values()].sort((a, b) => a.magasin_code.localeCompare(b.magasin_code));
  return { magasins, total: m2(magasins.reduce((t, x) => t + x.valeur, 0)), a_valoriser: magasins.reduce((t, x) => t + x.a_valoriser, 0) };
};

module.exports = { ENTREES, SORTIES, LIBELLES, verrouiller, quantite, ecrire, rejouer, etat, mouvements, valorisation };
