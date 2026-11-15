// db/data/plan-comptable-sycebnl.js
// ============================================================================
//  Référentiel du PLAN DE COMPTES SYCEBNL — Système Comptable des Entités à
//  But Non Lucratif (OHADA, applicable depuis le 01/01/2024) : associations,
//  ONG, fondations, projets de développement…
//
//  Construction : le SYCEBNL reprend la structure du SYSCOHADA révisé. On part
//  donc du référentiel SYSCOHADA embarqué (db/data/plan-comptable-syscohada.js)
//  et on applique les différences propres aux EBNL :
//    • classe 1  : entièrement remplacée (dotations, fonds affectés…) ;
//    • classe 4  : comptes 41 (adhérents, clients-usagers), 45 (fondateurs,
//                  apporteurs) et 46 (bailleurs, fonds d'administration)
//                  remplacés ; 475 « Générosités financières à recevoir » ;
//    • classe 6  : 636, 652, 654 propres aux EBNL ;
//    • classe 7  : 70 (revenus : cotisations, dons, legs…), 71 (subventions),
//                  75 et 79 remplacés ; 72, 73, 77, 78 inchangés ;
//    • classe 8  : 842/843 (contributions volontaires), 88x (subventions
//                  d'équilibre) ;
//    • classe 9  : contributions volontaires en nature (remplace les
//                  engagements hors bilan du SYSCOHADA).
//  Chaque compte propre au SYCEBNL (absent du SYSCOHADA ou de libellé
//  différent) porte specifique = true : l'écran l'affiche en badge.
//
//  Sources : Acte uniforme relatif au SYCEBNL et guide d'application OHADA
//  (ohada.org, avril 2023), synthèse Forvis Mazars. Le cabinet peut compléter
//  le plan de chaque client (comptes additifs) depuis Configuration → Plan
//  comptable ; pour enrichir le référentiel lui-même, ajoutez les lignes ici
//  puis relancez `npm run db:plan` (chargement idempotent, ajouts seulement).
// ============================================================================
const SYSCOHADA = require('./plan-comptable-syscohada');

const { resolveClasse, resolveNature } = SYSCOHADA;

// Préfixes SYSCOHADA retirés (remplacés par les comptes SYCEBNL ci-dessous).
// Un préfixe retire le compte lui-même et tous ses sous-comptes.
const PREFIXES_RETIRES = [
  '1',                       // classe 1 entière
  '41', '45', '46',          // tiers propres aux EBNL
  '70', '71', '75', '79',    // produits propres aux EBNL
  '9',                       // classe 9 entière
];

// [compte, intitulé, nature?] — nature déduite de la classe si absente.
const SPECIFIQUES = [
  // ── Classe 1 — Fonds propres et ressources durables ──────────────────────
  ['10',   "Dotation", 'passif'],
  ['101',  "Dotation non consomptible sans droit de reprise", 'passif'],
  ['1011', "Dotation non consomptible sans droit de reprise, en numéraire", 'passif'],
  ['1015', "Dotation non consomptible sans droit de reprise, en nature", 'passif'],
  ['102',  "Dotation non consomptible avec droit de reprise", 'passif'],
  ['1021', "Dotation non consomptible avec droit de reprise, en numéraire", 'passif'],
  ['1025', "Dotation non consomptible avec droit de reprise, en nature", 'passif'],
  ['103',  "Droit d'entrée", 'passif'],
  ['104',  "Dotation consomptible", 'passif'],
  ['1041', "Dotation consomptible", 'passif'],
  ['1049', "Dotation consomptible inscrite au compte de résultat", 'passif'],
  ['106',  "Écarts de réévaluation", 'passif'],
  ['11',   "Réserves", 'passif'],
  ['112',  "Réserves statutaires ou contractuelles", 'passif'],
  ['118',  "Autres réserves", 'passif'],
  ['12',   "Report à nouveau", 'passif'],
  ['121',  "Report à nouveau des excédents", 'passif'],
  ['129',  "Report à nouveau des déficits", 'passif'],
  ['13',   "Résultat net de l'exercice", 'passif'],
  ['131',  "Excédent de l'exercice", 'passif'],
  ['139',  "Déficit de l'exercice", 'passif'],
  ['14',   "Subventions d'investissement", 'passif'],
  ['141',  "Subventions d'équipement", 'passif'],
  ['148',  "Autres subventions d'investissement", 'passif'],
  ['15',   "Provisions réglementées et fonds assimilés", 'passif'],
  ['154',  "Provisions spéciales de réévaluation", 'passif'],
  ['158',  "Autres provisions réglementées et fonds assimilés", 'passif'],
  ['16',   "Fonds affectés", 'passif'],
  ['161',  "Fonds projet de développement — avances de fonds à justifier", 'passif'],
  ['162',  "Fonds affectés aux investissements du projet de développement — bailleurs de fonds", 'passif'],
  ['163',  "Fonds affectés aux investissements du projet de développement — État", 'passif'],
  ['164',  "Fonds affectés aux investissements des autres organismes de financement assimilés", 'passif'],
  ['165',  "Fonds affectés à un projet spécifique", 'passif'],
  ['167',  "Fonds provenant de dons et legs d'immobilisations", 'passif'],
  ['168',  "Autres fonds affectés", 'passif'],
  ['169',  "Fonds affectés à recevoir", 'passif'],
  ['17',   "Fonds reportés liés aux legs et donations", 'passif'],
  ['171',  "Donation temporaire d'usufruit", 'passif'],
  ['172',  "Legs non encore reçus d'immobilisations destinées à la vente", 'passif'],
  ['178',  "Autres fonds reportés", 'passif'],
  ['18',   "Emprunts et dettes assimilées", 'passif'],
  ['181',  "Emprunts obligataires", 'passif'],
  ['182',  "Emprunts et dettes auprès des établissements de crédit", 'passif'],
  ['183',  "Avances reçues de l'État", 'passif'],
  ['185',  "Dépôts et cautionnements reçus", 'passif'],
  ['186',  "Intérêts courus", 'passif'],
  ['187',  "Dettes de location-acquisition", 'passif'],
  ['188',  "Autres emprunts et dettes", 'passif'],
  ['19',   "Provisions pour risques et charges", 'passif'],
  ['191',  "Provisions pour litiges", 'passif'],
  ['192',  "Provisions pour charges sur donations et legs", 'passif'],
  ['196',  "Provisions pour pensions et obligations similaires", 'passif'],
  ['198',  "Autres provisions pour risques et charges", 'passif'],

  // ── Classe 4 — Tiers propres aux EBNL ────────────────────────────────────
  ['41',   "Adhérents, clients-usagers et comptes rattachés", 'actif'],
  ['411',  "Adhérents", 'actif'],
  ['412',  "Clients-usagers", 'actif'],
  ['416',  "Créances adhérents, clients-usagers litigieuses ou douteuses", 'actif'],
  ['45',   "Fondateurs, apporteurs et comptes courants", 'passif'],
  ['451',  "Associations et assimilées", 'passif'],
  ['457',  "Mécènes, bénévoles et assimilés", 'passif'],
  ['46',   "Bailleurs, fonds d'administration", 'passif'],
  ['462',  "Bailleurs — projet de développement, fonds d'administration", 'passif'],
  ['463',  "État — projet de développement, fonds d'administration", 'passif'],
  ['464',  "Autres tiers ou organismes de financement assimilés — fonds d'administration", 'passif'],
  ['469',  "Fonds d'administration à recevoir", 'actif'],
  ['4692', "Bailleurs — fonds d'administration à recevoir", 'actif'],
  ['475',  "Générosités financières à recevoir", 'actif'],

  // ── Classe 6 — Charges propres aux EBNL ──────────────────────────────────
  ['636',  "Frais de recherche de fonds", 'charge'],
  ['652',  "Subventions versées par l'entité", 'charge'],
  ['654',  "Dons en nature courants à distribuer", 'charge'],

  // ── Classe 7 — Produits des activités ordinaires ─────────────────────────
  ['70',   "Revenus", 'produit'],
  ['701',  "Cotisations des adhérents", 'produit'],
  ['702',  "Quote-part de fonds d'administration transférés", 'produit'],
  ['703',  "Quote-part de dotation consomptible transférée", 'produit'],
  ['704',  "Revenus liés à la générosité", 'produit'],
  ['7041', "Dons", 'produit'],
  ['7042', "Legs", 'produit'],
  ['7043', "Deniers du culte", 'produit'],
  ['7044', "Zakat, dîme, quête et assimilés", 'produit'],
  ['7045', "Célébrations", 'produit'],
  ['7046', "Mécénats", 'produit'],
  ['7047', "Parrainages", 'produit'],
  ['7048', "Autres revenus liés à la générosité", 'produit'],
  ['705',  "Ventes de marchandises, services et produits finis", 'produit'],
  ['706',  "Revenus des manifestations", 'produit'],
  ['707',  "Produits accessoires", 'produit'],
  ['708',  "Autres revenus", 'produit'],
  ['71',   "Subventions d'exploitation", 'produit'],
  ['711',  "Subventions d'exploitation versées par l'État et les collectivités publiques", 'produit'],
  ['713',  "Subventions d'exploitation versées par les organismes nationaux et internationaux", 'produit'],
  ['718',  "Autres subventions d'exploitation", 'produit'],
  ['75',   "Autres produits", 'produit'],
  ['751',  "Profits sur créances adhérents, clients-usagers et autres débiteurs", 'produit'],
  ['752',  "Contribution du fondateur", 'produit'],
  ['754',  "Dons en nature courants", 'produit'],
  ['758',  "Produits divers", 'produit'],
  ['79',   "Reprises de provisions, de dépréciations et autres", 'produit'],
  ['791',  "Reprises de provisions et dépréciations d'exploitation", 'produit'],
  ['792',  "Reprises de fonds affectés et provenant de legs d'immobilisations", 'produit'],
  ['7925', "Reprises de fonds affectés à un projet spécifique", 'produit'],
  ['797',  "Reprises de provisions et dépréciations financières", 'produit'],
  ['798',  "Reprises d'amortissements", 'produit'],
  ['799',  "Reprises de subventions d'investissement", 'produit'],

  // ── Classe 8 — Autres charges et autres produits ─────────────────────────
  ['842',  "Contributions volontaires en nature", 'hors_activites_ordinaires'],
  ['843',  "Contributions volontaires en numéraire", 'hors_activites_ordinaires'],
  ['88',   "Subventions d'équilibre", 'hors_activites_ordinaires'],
  ['881',  "Subventions d'équilibre — État", 'hors_activites_ordinaires'],
  ['884',  "Subventions d'équilibre — collectivités publiques", 'hors_activites_ordinaires'],
  ['888',  "Autres subventions d'équilibre", 'hors_activites_ordinaires'],

  // ── Classe 9 — Contributions volontaires en nature ───────────────────────
  ['90',   "Emplois des contributions volontaires en nature", null],
  ['900',  "Secours en nature", null],
  ['901',  "Mises à disposition gratuite de biens", null],
  ['902',  "Prestations en nature", null],
  ['904',  "Personnel bénévole", null],
  ['91',   "Contributions volontaires en nature", null],
  ['910',  "Dons en nature", null],
  ['911',  "Prestations en nature reçues", null],
  ['914',  "Bénévolat", null],
  ['93',   "Comptes de reclassements", null],
  ['94',   "Comptes de coûts", null],
  ['95',   "Comptes de stocks (comptabilité analytique)", null],
  ['96',   "Comptes d'écarts sur coûts préétablis", null],
  ['98',   "Comptes de résultats analytiques", null],
  ['99',   "Comptes de liaisons internes", null],
];

const estRetire = (compte) => PREFIXES_RETIRES.some((p) => compte.startsWith(p));
const specifiques = new Map(SPECIFIQUES.map(([c, i, n]) => [c, { intitule: i, nature: n }]));

// Base commune : comptes SYSCOHADA conservés (hors préfixes retirés et hors
// comptes redéfinis), puis comptes propres au SYCEBNL.
const communs = SYSCOHADA.PLAN_COMPTABLE
  .filter((c) => !estRetire(c.compte) && !specifiques.has(c.compte))
  .map((c) => ({ ...c, specifique: false }));
const propres = SPECIFIQUES.map(([compte, intitule, nature]) => ({
  compte: compte.trim(),
  intitule: intitule.trim(),
  classe: resolveClasse(compte),
  nature: nature === undefined ? resolveNature(compte) : nature,
  specifique: true,
}));

/** Référentiel normalisé, trié : [{ compte, intitule, classe, nature, specifique }] */
const PLAN_COMPTABLE_SYCEBNL = [...communs, ...propres]
  .sort((a, b) => a.compte.localeCompare(b.compte, 'fr', { numeric: false }));

module.exports = { PLAN_COMPTABLE_SYCEBNL, PREFIXES_RETIRES };
