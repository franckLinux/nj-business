// db/data/plan-comptable-syscohada.js
// ============================================================================
//  Référentiel du PLAN COMPTABLE SYSCOHADA RÉVISÉ (AUDCIF, applicable depuis
//  le 01/01/2018) — source de vérité versionnée avec le code.
//
//  Format d'une ligne :  [ compte, intitulé, nature? ]
//    - `compte`   : numéro de compte (TEXT, aucune limite de longueur)
//    - `intitulé` : libellé officiel
//    - `nature`   : facultatif. Si absent, il est déduit automatiquement
//                   (voir resolveNature ci-dessous).
//
//  La classe est toujours déduite du 1er chiffre du numéro de compte.
//
//  Pour étendre le référentiel : ajouter les lignes ici puis relancer
//      npm run db:plan
//  Le chargement est idempotent — les comptes personnalisés (source='custom')
//  saisis depuis l'application ne sont jamais écrasés.
// ============================================================================

// Nature par défaut, déduite de la classe (1er chiffre).
const NATURE_PAR_CLASSE = {
  1: 'passif',
  2: 'actif',
  3: 'actif',
  4: 'actif',
  5: 'tresorerie',
  6: 'charge',
  7: 'produit',
  8: 'hors_activites_ordinaires',
  9: null, // comptabilité analytique / engagements : pas de nature bilancielle
};

// La classe 4 (tiers) est mixte : nature par défaut au niveau du compte à 2 chiffres.
const NATURE_TIERS = {
  40: 'passif', // Fournisseurs
  41: 'actif',  // Clients
  42: 'passif', // Personnel
  43: 'passif', // Organismes sociaux
  44: 'passif', // État
  45: 'actif',  // Organismes internationaux
  46: 'passif', // Associés et groupe
  47: 'actif',  // Débiteurs et créditeurs divers
  48: 'passif', // Créances et dettes HAO
  49: 'passif', // Dépréciations et provisions
};

const resolveClasse = (compte) => {
  const d = String(compte).match(/\d/);
  return d ? parseInt(d[0], 10) : null;
};

const resolveNature = (compte, natureExplicite) => {
  if (natureExplicite !== undefined) return natureExplicite;
  const classe = resolveClasse(compte);
  if (classe === 4) {
    const prefixe = parseInt(String(compte).slice(0, 2), 10);
    return NATURE_TIERS[prefixe] ?? 'actif';
  }
  return NATURE_PAR_CLASSE[classe] ?? null;
};

// ============================================================================
//  CLASSE 1 — COMPTES DE RESSOURCES DURABLES
// ============================================================================
const CLASSE_1 = [
  ['10',   "Capital"],
  ['101',  "Capital social"],
  ['1011', "Capital souscrit, non appelé"],
  ['1012', "Capital souscrit, appelé, non versé"],
  ['1013', "Capital souscrit, appelé, versé, non amorti"],
  ['1014', "Capital souscrit, appelé, versé, amorti"],
  ['102',  "Capital par dotation"],
  ['1021', "Dotation initiale"],
  ['1022', "Dotations complémentaires"],
  ['1028', "Autres dotations"],
  ['103',  "Capital personnel"],
  ['1031', "Capital personnel"],
  ['1032', "Capital personnel — apports complémentaires"],
  ['104',  "Compte de l'exploitant"],
  ['105',  "Primes liées aux capitaux propres"],
  ['1051', "Primes d'émission"],
  ['1052', "Primes d'apport"],
  ['1053', "Primes de fusion"],
  ['1054', "Primes de conversion"],
  ['1058', "Autres primes"],
  ['106',  "Écarts de réévaluation"],
  ['1061', "Écarts de réévaluation légale"],
  ['1062', "Écarts de réévaluation libre"],
  ['109',  "Actionnaires, capital souscrit, non appelé", 'actif'],

  ['11',   "Réserves"],
  ['111',  "Réserve légale"],
  ['112',  "Réserves statutaires ou contractuelles"],
  ['113',  "Réserves réglementées"],
  ['118',  "Autres réserves"],

  ['12',   "Report à nouveau"],
  ['121',  "Report à nouveau créditeur"],
  ['129',  "Report à nouveau débiteur"],

  ['13',   "Résultat net de l'exercice"],
  ['130',  "Résultat en instance d'affectation"],
  ['131',  "Résultat net : bénéfice"],
  ['132',  "Marge commerciale"],
  ['133',  "Valeur ajoutée"],
  ['134',  "Excédent brut d'exploitation"],
  ['135',  "Résultat d'exploitation"],
  ['136',  "Résultat financier"],
  ['137',  "Résultat des activités ordinaires"],
  ['138',  "Résultat hors activités ordinaires"],
  ['139',  "Résultat net : perte"],

  ['14',   "Subventions d'investissement"],
  ['141',  "Subventions d'équipement A"],
  ['142',  "Subventions d'équipement B"],
  ['148',  "Autres subventions d'investissement"],

  ['15',   "Provisions réglementées et fonds assimilés"],
  ['151',  "Amortissements dérogatoires"],
  ['152',  "Plus-values de cession à réinvestir"],
  ['153',  "Fonds réglementés"],
  ['154',  "Provision spéciale de réévaluation"],
  ['155',  "Provisions réglementées relatives aux immobilisations"],
  ['156',  "Provisions réglementées relatives aux stocks"],
  ['157',  "Provisions pour investissement"],
  ['158',  "Autres provisions et fonds réglementés"],

  ['16',   "Emprunts et dettes assimilées"],
  ['161',  "Emprunts obligataires"],
  ['162',  "Emprunts et dettes auprès des établissements de crédit"],
  ['163',  "Avances reçues de l'État"],
  ['164',  "Avances reçues et comptes courants bloqués"],
  ['165',  "Dépôts et cautionnements reçus"],
  ['166',  "Intérêts courus sur emprunts et dettes"],
  ['167',  "Avances assorties de conditions particulières"],
  ['168',  "Autres emprunts et dettes"],

  ['17',   "Dettes de location acquisition"],
  ['172',  "Dettes de location acquisition — immobilier"],
  ['173',  "Dettes de location acquisition — mobilier"],
  ['176',  "Dettes sur autres contrats de location acquisition"],
  ['178',  "Intérêts courus sur dettes de location acquisition"],

  ['18',   "Dettes liées à des participations et comptes de liaison"],
  ['181',  "Dettes liées à des participations (groupe)"],
  ['182',  "Dettes liées à des participations (hors groupe)"],
  ['183',  "Comptes permanents bloqués des établissements et succursales"],
  ['184',  "Comptes permanents non bloqués des établissements et succursales"],
  ['185',  "Comptes de liaison charges"],
  ['186',  "Comptes de liaison produits"],
  ['187',  "Comptes de liaison des sociétés en participation"],
  ['188',  "Comptes de liaison des succursales"],

  ['19',   "Provisions pour risques et charges"],
  ['191',  "Provisions pour litiges"],
  ['192',  "Provisions pour garanties données aux clients"],
  ['193',  "Provisions pour pertes sur marchés à achèvement futur"],
  ['194',  "Provisions pour pertes de change"],
  ['195',  "Provisions pour impôts"],
  ['196',  "Provisions pour pensions et obligations similaires"],
  ['197',  "Provisions pour charges à répartir sur plusieurs exercices"],
  ['198',  "Autres provisions pour risques et charges"],
];

// ============================================================================
//  CLASSE 2 — COMPTES D'ACTIF IMMOBILISÉ
// ============================================================================
const CLASSE_2 = [
  ['21',   "Immobilisations incorporelles"],
  ['211',  "Frais de développement"],
  ['212',  "Brevets, licences, concessions et droits similaires"],
  ['213',  "Logiciels et sites internet"],
  ['2131', "Logiciels"],
  ['2132', "Sites internet"],
  ['214',  "Marques"],
  ['215',  "Fonds commercial"],
  ['216',  "Droit au bail"],
  ['217',  "Investissements de création"],
  ['218',  "Autres droits et valeurs incorporels"],
  ['219',  "Immobilisations incorporelles en cours"],

  ['22',   "Terrains"],
  ['221',  "Terrains agricoles et forestiers"],
  ['222',  "Terrains nus"],
  ['223',  "Terrains bâtis"],
  ['224',  "Travaux de mise en valeur des terrains"],
  ['225',  "Terrains de gisement"],
  ['226',  "Terrains aménagés"],
  ['227',  "Terrains mis en concession"],
  ['228',  "Autres terrains"],
  ['229',  "Aménagements de terrains en cours"],

  ['23',   "Bâtiments, installations techniques et agencements"],
  ['231',  "Bâtiments industriels, agricoles, administratifs et commerciaux sur sol propre"],
  ['232',  "Bâtiments industriels, agricoles, administratifs et commerciaux sur sol d'autrui"],
  ['233',  "Ouvrages d'infrastructure"],
  ['234',  "Installations techniques"],
  ['235',  "Aménagements de bureaux"],
  ['237',  "Bâtiments industriels, agricoles et commerciaux mis en concession"],
  ['238',  "Autres installations et agencements"],
  ['239',  "Bâtiments et installations en cours"],

  ['24',   "Matériel, mobilier et actifs biologiques"],
  ['241',  "Matériel et outillage industriel et commercial"],
  ['242',  "Matériel et outillage agricole"],
  ['243',  "Matériel d'emballage récupérable et identifiable"],
  ['244',  "Matériel et mobilier"],
  ['2441', "Matériel de bureau"],
  ['2442', "Matériel informatique"],
  ['2443', "Matériel bureautique"],
  ['2444', "Mobilier de bureau"],
  ['2447', "Matériel et mobilier des logements du personnel"],
  ['245',  "Matériel de transport"],
  ['2451', "Matériel automobile"],
  ['2452', "Matériel ferroviaire"],
  ['2453', "Matériel fluvial et lagunaire"],
  ['2454', "Matériel naval"],
  ['2455', "Matériel aérien"],
  ['2458', "Autres matériels de transport"],
  ['246',  "Actifs biologiques"],
  ['2461', "Plantations agricoles"],
  ['2462', "Animaux de production"],
  ['247',  "Agencements et aménagements du matériel"],
  ['248',  "Autres matériels"],
  ['249',  "Matériel en cours"],

  ['25',   "Avances et acomptes versés sur immobilisations"],
  ['251',  "Avances et acomptes versés sur immobilisations incorporelles"],
  ['252',  "Avances et acomptes versés sur immobilisations corporelles"],

  ['26',   "Titres de participation"],
  ['261',  "Titres de participation dans des sociétés sous contrôle exclusif"],
  ['262',  "Titres de participation dans des sociétés sous contrôle conjoint"],
  ['263',  "Titres de participation dans des sociétés conférant une influence notable"],
  ['265',  "Participations dans des organismes professionnels"],
  ['266',  "Parts dans des groupements d'intérêt économique (GIE)"],
  ['268',  "Autres titres de participation"],

  ['27',   "Autres immobilisations financières"],
  ['271',  "Prêts et créances non commerciales"],
  ['272',  "Prêts au personnel"],
  ['273',  "Créances sur l'État"],
  ['274',  "Titres immobilisés"],
  ['275',  "Dépôts et cautionnements versés"],
  ['2751', "Dépôts pour loyers d'avance"],
  ['2752', "Dépôts pour eau, gaz, électricité"],
  ['2753', "Dépôts pour téléphone"],
  ['2758', "Autres dépôts et cautionnements"],
  ['276',  "Intérêts courus sur immobilisations financières"],
  ['277',  "Créances de location acquisition"],
  ['278',  "Immobilisations financières diverses"],

  ['28',   "Amortissements"],
  ['281',  "Amortissements des immobilisations incorporelles"],
  ['282',  "Amortissements des terrains"],
  ['283',  "Amortissements des bâtiments, installations techniques et agencements"],
  ['284',  "Amortissements du matériel, mobilier et actifs biologiques"],

  ['29',   "Dépréciations des immobilisations"],
  ['291',  "Dépréciations des immobilisations incorporelles"],
  ['292',  "Dépréciations des terrains"],
  ['293',  "Dépréciations des bâtiments, installations techniques et agencements"],
  ['294',  "Dépréciations du matériel, mobilier et actifs biologiques"],
  ['295',  "Dépréciations des avances et acomptes versés sur immobilisations"],
  ['296',  "Dépréciations des titres de participation"],
  ['297',  "Dépréciations des autres immobilisations financières"],
];

// ============================================================================
//  CLASSE 3 — COMPTES DE STOCKS
// ============================================================================
const CLASSE_3 = [
  ['31',   "Marchandises"],
  ['311',  "Marchandises A"],
  ['312',  "Marchandises B"],
  ['318',  "Marchandises hors activités ordinaires"],

  ['32',   "Matières premières et fournitures liées"],
  ['321',  "Matières premières"],
  ['322',  "Fournitures liées"],

  ['33',   "Autres approvisionnements"],
  ['331',  "Matières consommables"],
  ['332',  "Fournitures d'atelier et d'usine"],
  ['333',  "Fournitures de magasin"],
  ['334',  "Fournitures de bureau"],
  ['335',  "Emballages"],
  ['3351', "Emballages perdus"],
  ['3352', "Emballages récupérables non identifiables"],
  ['3353', "Emballages à usage mixte"],
  ['338',  "Autres matières"],

  ['34',   "Produits en cours"],
  ['341',  "Produits en cours"],
  ['342',  "Travaux en cours"],

  ['35',   "Services en cours"],
  ['351',  "Études en cours"],
  ['352',  "Prestations de services en cours"],

  ['36',   "Produits finis"],
  ['361',  "Produits finis A"],
  ['362',  "Produits finis B"],

  ['37',   "Produits intermédiaires et résiduels"],
  ['371',  "Produits intermédiaires"],
  ['372',  "Produits résiduels (déchets et rebuts)"],

  ['38',   "Stocks en cours de route, en consignation ou en dépôt"],
  ['381',  "Marchandises en cours de route"],
  ['382',  "Matières premières et fournitures liées en cours de route"],
  ['383',  "Autres approvisionnements en cours de route"],
  ['386',  "Stocks en consignation ou en dépôt"],
  ['388',  "Stock provenant d'immobilisations mises hors service ou au rebut"],

  ['39',   "Dépréciations des stocks"],
  ['391',  "Dépréciations des stocks de marchandises"],
  ['392',  "Dépréciations des stocks de matières premières et fournitures liées"],
  ['393',  "Dépréciations des stocks d'autres approvisionnements"],
  ['394',  "Dépréciations des productions en cours"],
  ['395',  "Dépréciations des services en cours"],
  ['396',  "Dépréciations des stocks de produits finis"],
  ['397',  "Dépréciations des stocks de produits intermédiaires et résiduels"],
  ['398',  "Dépréciations des stocks en cours de route, en consignation ou en dépôt"],
];

// ============================================================================
//  CLASSE 4 — COMPTES DE TIERS
// ============================================================================
const CLASSE_4 = [
  ['40',   "Fournisseurs et comptes rattachés"],
  ['401',  "Fournisseurs, dettes en compte"],
  ['402',  "Fournisseurs, effets à payer"],
  ['408',  "Fournisseurs, factures non parvenues"],
  ['409',  "Fournisseurs débiteurs", 'actif'],
  ['4091', "Fournisseurs, avances et acomptes versés", 'actif'],
  ['4092', "Fournisseurs, rabais, remises et ristournes à obtenir", 'actif'],
  ['4093', "Fournisseurs, créances pour emballages et matériels à rendre", 'actif'],
  ['4098', "Rabais, remises, ristournes et autres avoirs à obtenir", 'actif'],

  ['41',   "Clients et comptes rattachés"],
  ['411',  "Clients"],
  ['412',  "Clients, effets à recevoir"],
  ['414',  "Créances sur cessions courantes d'immobilisations"],
  ['415',  "Clients, effets escomptés non échus"],
  ['416',  "Créances clients litigieuses ou douteuses"],
  ['418',  "Clients, produits à recevoir (factures à établir)"],
  ['419',  "Clients créditeurs", 'passif'],
  ['4191', "Clients, avances et acomptes reçus", 'passif'],
  ['4192', "Clients, rabais, remises et ristournes à accorder", 'passif'],
  ['4194', "Clients, dettes pour emballages et matériels consignés", 'passif'],

  ['42',   "Personnel"],
  ['421',  "Personnel, avances et acomptes", 'actif'],
  ['422',  "Personnel, rémunérations dues"],
  ['423',  "Personnel, oppositions et saisies-arrêts"],
  ['424',  "Personnel, œuvres sociales internes"],
  ['425',  "Représentants du personnel"],
  ['426',  "Personnel, participation aux bénéfices"],
  ['427',  "Personnel, dépôts"],
  ['428',  "Personnel, charges à payer et produits à recevoir"],

  ['43',   "Organismes sociaux"],
  ['431',  "Sécurité sociale"],
  ['432',  "Caisses de retraite complémentaire"],
  ['433',  "Autres organismes sociaux"],
  ['438',  "Organismes sociaux, charges à payer et produits à recevoir"],

  ['44',   "État et collectivités publiques"],
  ['441',  "État, impôt sur les bénéfices"],
  ['442',  "État, autres impôts et taxes"],
  ['443',  "État, TVA facturée"],
  ['4431', "TVA facturée sur ventes"],
  ['4432', "TVA facturée sur prestations de services"],
  ['4433', "TVA facturée sur travaux"],
  ['4434', "TVA facturée sur production livrée à soi-même"],
  ['444',  "État, TVA due ou crédit de TVA"],
  ['4441', "État, TVA due"],
  ['4449', "État, crédit de TVA à reporter", 'actif'],
  ['445',  "État, TVA récupérable", 'actif'],
  ['4451', "TVA récupérable sur immobilisations", 'actif'],
  ['4452', "TVA récupérable sur achats", 'actif'],
  ['4453', "TVA récupérable sur transport", 'actif'],
  ['4454', "TVA récupérable sur services extérieurs et autres charges", 'actif'],
  ['4455', "TVA récupérable sur factures non parvenues", 'actif'],
  ['446',  "État, autres taxes sur le chiffre d'affaires"],
  ['447',  "État, impôts retenus à la source"],
  ['448',  "État, charges à payer et produits à recevoir"],
  ['449',  "État, créances et dettes diverses"],

  ['45',   "Organismes internationaux"],
  ['451',  "Opérations avec les organismes africains"],
  ['452',  "Opérations avec les autres organismes internationaux"],
  ['458',  "Organismes internationaux, fonds de dotation et subventions à recevoir"],

  ['46',   "Associés et groupe"],
  ['461',  "Associés, opérations sur le capital"],
  ['4611', "Associés, apports en nature"],
  ['4612', "Associés, apports en numéraire"],
  ['462',  "Associés, comptes courants"],
  ['463',  "Associés, opérations faites en commun"],
  ['465',  "Associés, dividendes à payer"],
  ['466',  "Groupe, comptes courants"],
  ['467',  "Actionnaires, restant dû sur capital appelé", 'actif'],
  ['468',  "Associés, charges à payer et produits à recevoir"],

  ['47',   "Débiteurs et créditeurs divers"],
  ['471',  "Comptes d'attente"],
  ['472',  "Versements restant à effectuer sur titres non libérés", 'passif'],
  ['473',  "Comptes de répartition périodique des charges et des produits"],
  ['475',  "Créances sur travaux non facturables"],
  ['476',  "Charges constatées d'avance", 'actif'],
  ['477',  "Produits constatés d'avance", 'passif'],
  ['478',  "Écarts de conversion — Actif", 'actif'],
  ['479',  "Écarts de conversion — Passif", 'passif'],

  ['48',   "Créances et dettes hors activités ordinaires (HAO)"],
  ['481',  "Fournisseurs d'investissements"],
  ['482',  "Fournisseurs d'investissements, effets à payer"],
  ['483',  "Dettes sur acquisition de titres de placement"],
  ['484',  "Autres dettes hors activités ordinaires"],
  ['485',  "Créances sur cessions d'immobilisations", 'actif'],
  ['486',  "Créances sur cessions de titres de placement", 'actif'],
  ['488',  "Autres créances hors activités ordinaires", 'actif'],

  ['49',   "Dépréciations et provisions pour risques à court terme"],
  ['490',  "Dépréciations des comptes fournisseurs"],
  ['491',  "Dépréciations des comptes clients"],
  ['492',  "Dépréciations des comptes personnel"],
  ['493',  "Dépréciations des comptes organismes sociaux"],
  ['494',  "Dépréciations des comptes État et collectivités publiques"],
  ['495',  "Dépréciations des comptes organismes internationaux"],
  ['496',  "Dépréciations des comptes associés et groupe"],
  ['497',  "Dépréciations des comptes débiteurs et créditeurs divers"],
  ['498',  "Dépréciations des comptes de créances HAO"],
  ['499',  "Provisions pour risques à court terme"],
];

// ============================================================================
//  CLASSE 5 — COMPTES DE TRÉSORERIE
// ============================================================================
const CLASSE_5 = [
  ['50',   "Titres de placement"],
  ['501',  "Titres du Trésor et bons de caisse à court terme"],
  ['502',  "Actions"],
  ['503',  "Obligations"],
  ['504',  "Bons de souscription"],
  ['505',  "Titres négociables hors région"],
  ['506',  "Intérêts courus sur titres de placement"],
  ['508',  "Autres valeurs assimilées"],

  ['51',   "Valeurs à encaisser"],
  ['511',  "Effets à encaisser"],
  ['512',  "Effets à l'encaissement"],
  ['513',  "Chèques à encaisser"],
  ['514',  "Chèques à l'encaissement"],
  ['515',  "Cartes de crédit à encaisser"],
  ['516',  "Coupons échus"],
  ['518',  "Autres valeurs à l'encaissement"],

  ['52',   "Banques"],
  ['521',  "Banques locales"],
  ['522',  "Banques autres États de la région"],
  ['523',  "Banques autres États de la zone monétaire"],
  ['524',  "Banques hors zone monétaire"],
  ['526',  "Banques, intérêts courus"],

  ['53',   "Établissements financiers et assimilés"],
  ['531',  "Chèques postaux"],
  ['532',  "Trésor"],
  ['533',  "Sociétés de gestion et d'intermédiation (SGI)"],
  ['538',  "Autres organismes financiers"],

  ['54',   "Instruments de trésorerie"],
  ['541',  "Options de taux d'intérêt"],
  ['542',  "Options de taux de change"],
  ['543',  "Instruments de marchés à terme"],
  ['544',  "Avoirs d'or et autres métaux précieux"],

  ['55',   "Instruments de monnaie électronique"],
  ['551',  "Porte-monnaie électronique"],
  ['552',  "Monnaie électronique — opérateurs de téléphonie (mobile money)"],
  ['558',  "Autres instruments de monnaie électronique"],

  ['56',   "Banques, crédits de trésorerie et d'escompte"],
  ['561',  "Crédits de trésorerie"],
  ['564',  "Escompte de crédits de campagne"],
  ['565',  "Escompte de crédits ordinaires"],
  ['566',  "Banques, crédits de trésorerie, intérêts courus"],

  ['57',   "Caisse"],
  ['571',  "Caisse siège social"],
  ['5711', "Caisse siège social en unité monétaire légale"],
  ['5712', "Caisse siège social en devises"],
  ['572',  "Caisse succursale A"],
  ['573',  "Caisse succursale B"],
  ['578',  "Autres caisses"],

  ['58',   "Régies d'avances, accréditifs et virements internes"],
  ['581',  "Régies d'avances"],
  ['582',  "Accréditifs"],
  ['585',  "Virements de fonds"],
  ['588',  "Autres virements internes"],

  ['59',   "Dépréciations et provisions pour risques à court terme (trésorerie)"],
  ['591',  "Dépréciations des titres de placement"],
  ['592',  "Dépréciations des comptes banques"],
  ['593',  "Dépréciations des comptes établissements financiers et assimilés"],
  ['594',  "Dépréciations des comptes d'instruments de trésorerie"],
  ['599',  "Provisions pour risques à caractère financier"],
];

// ============================================================================
//  CLASSE 6 — CHARGES DES ACTIVITÉS ORDINAIRES
// ============================================================================
const CLASSE_6 = [
  ['60',   "Achats et variations de stocks"],
  ['601',  "Achats de marchandises"],
  ['6011', "Achats de marchandises dans la région"],
  ['6012', "Achats de marchandises hors région"],
  ['602',  "Achats de matières premières et fournitures liées"],
  ['603',  "Variations des stocks de biens achetés"],
  ['6031', "Variations des stocks de marchandises"],
  ['6032', "Variations des stocks de matières premières et fournitures liées"],
  ['6033', "Variations des stocks d'autres approvisionnements"],
  ['604',  "Achats stockés de matières et fournitures consommables"],
  ['605',  "Autres achats"],
  ['6051', "Fournitures non stockables — Eau"],
  ['6052', "Fournitures non stockables — Électricité"],
  ['6053', "Fournitures non stockables — Autres énergies"],
  ['6054', "Fournitures d'entretien non stockables"],
  ['6055', "Fournitures de bureau non stockables"],
  ['6056', "Achats de petit matériel et outillage"],
  ['6057', "Achats d'études et prestations de services"],
  ['6058', "Achats de travaux, matériels et équipements"],
  ['608',  "Achats d'emballages"],
  ['6081', "Emballages perdus"],
  ['6082', "Emballages récupérables non identifiables"],
  ['6083', "Emballages à usage mixte"],
  ['609',  "Rabais, remises et ristournes obtenus sur achats"],

  ['61',   "Transports"],
  ['611',  "Transports sur achats"],
  ['612',  "Transports sur ventes"],
  ['613',  "Transports pour le compte de tiers"],
  ['614',  "Transports du personnel"],
  ['616',  "Transports de plis"],
  ['618',  "Autres frais de transport"],

  ['62',   "Services extérieurs A"],
  ['621',  "Sous-traitance générale"],
  ['622',  "Locations et charges locatives"],
  ['6221', "Locations de terrains"],
  ['6222', "Locations de bâtiments"],
  ['6223', "Locations de matériels et outillages"],
  ['6224', "Malis sur emballages"],
  ['6228', "Autres locations et charges locatives"],
  ['623',  "Redevances de location acquisition"],
  ['624',  "Entretien, réparations et maintenance"],
  ['6241', "Entretien et réparations des biens immobiliers"],
  ['6242', "Entretien et réparations des biens mobiliers"],
  ['6243', "Maintenance"],
  ['625',  "Primes d'assurance"],
  ['6251', "Assurances multirisques"],
  ['6252', "Assurances matériel de transport"],
  ['6253', "Assurances risques d'exploitation"],
  ['6254', "Assurances responsabilité du producteur"],
  ['6255', "Assurances insolvabilité clients"],
  ['626',  "Études, recherches et documentation"],
  ['627',  "Publicité, publications, relations publiques"],
  ['628',  "Frais de télécommunications"],
  ['6281', "Frais de téléphone"],
  ['6282', "Frais d'internet"],
  ['6283', "Frais de télex et de fax"],

  ['63',   "Services extérieurs B"],
  ['631',  "Frais bancaires"],
  ['6311', "Frais sur titres (achat, vente, garde)"],
  ['6312', "Frais sur effets"],
  ['6315', "Commissions et frais sur virements"],
  ['632',  "Rémunérations d'intermédiaires et de conseils"],
  ['6321', "Commissions et courtages sur achats"],
  ['6322', "Commissions et courtages sur ventes"],
  ['6324', "Honoraires"],
  ['6325', "Frais d'actes et de contentieux"],
  ['633',  "Frais de formation du personnel"],
  ['634',  "Redevances pour brevets, licences, logiciels et droits similaires"],
  ['635',  "Cotisations"],
  ['637',  "Rémunérations de personnel extérieur"],
  ['638',  "Autres charges externes"],
  ['6381', "Frais de recrutement du personnel"],
  ['6382', "Frais de déménagement"],
  ['6383', "Réceptions"],
  ['6384', "Missions"],
  ['6385', "Réceptions et frais de représentation"],

  ['64',   "Impôts et taxes"],
  ['641',  "Impôts et taxes directs"],
  ['6411', "Impôts fonciers et taxes annexes"],
  ['6412', "Patentes, licences et taxes annexes"],
  ['6413', "Taxes sur appointements et salaires"],
  ['6414', "Taxes d'apprentissage"],
  ['6415', "Formation professionnelle continue"],
  ['645',  "Impôts et taxes indirects"],
  ['646',  "Droits d'enregistrement"],
  ['6461', "Droits de mutation"],
  ['6462', "Droits de timbre"],
  ['6463', "Taxes sur les véhicules de société"],
  ['647',  "Pénalités et amendes fiscales"],
  ['648',  "Autres impôts et taxes"],

  ['65',   "Autres charges"],
  ['651',  "Pertes sur créances clients et autres débiteurs"],
  ['652',  "Quote-part de résultat sur opérations faites en commun"],
  ['653',  "Quote-part de résultat annulée sur exécution partielle de contrats pluri-exercices"],
  ['654',  "Valeurs comptables des cessions courantes d'immobilisations"],
  ['658',  "Charges diverses"],
  ['659',  "Charges pour dépréciations et provisions pour risques à court terme"],

  ['66',   "Charges de personnel"],
  ['661',  "Rémunérations directes versées au personnel national"],
  ['6611', "Appointements, salaires et commissions"],
  ['6612', "Primes et gratifications"],
  ['6613', "Congés payés"],
  ['6614', "Indemnités de préavis, de licenciement et de recherche d'embauche"],
  ['6615', "Indemnités de maladie versées aux travailleurs"],
  ['662',  "Rémunérations directes versées au personnel non national"],
  ['663',  "Indemnités forfaitaires versées au personnel"],
  ['6631', "Indemnités de logement"],
  ['6632', "Indemnités de représentation"],
  ['6633', "Indemnités d'expatriation"],
  ['664',  "Charges sociales"],
  ['6641', "Charges sociales sur rémunération du personnel national"],
  ['6642', "Charges sociales sur rémunération du personnel non national"],
  ['666',  "Rémunération et charges sociales de l'exploitant individuel"],
  ['667',  "Rémunération transférée de personnel extérieur"],
  ['668',  "Autres charges sociales"],

  ['67',   "Frais financiers et charges assimilées"],
  ['671',  "Intérêts des emprunts"],
  ['672',  "Intérêts dans loyers de location acquisition"],
  ['673',  "Escomptes accordés"],
  ['674',  "Autres intérêts"],
  ['6741', "Intérêts sur emprunts et dettes auprès des établissements de crédit"],
  ['6742', "Intérêts sur comptes courants d'associés"],
  ['675',  "Escomptes des effets de commerce"],
  ['676',  "Pertes de change"],
  ['677',  "Pertes sur titres de placement"],
  ['678',  "Pertes sur risques financiers"],
  ['679',  "Charges pour dépréciations et provisions financières"],

  ['68',   "Dotations aux amortissements"],
  ['681',  "Dotations aux amortissements d'exploitation"],
  ['6812', "Dotations aux amortissements des immobilisations incorporelles"],
  ['6813', "Dotations aux amortissements des immobilisations corporelles"],
  ['687',  "Dotations aux amortissements à caractère financier"],

  ['69',   "Dotations aux provisions et aux dépréciations"],
  ['691',  "Dotations aux provisions et dépréciations d'exploitation"],
  ['6911', "Dotations aux provisions pour risques et charges"],
  ['6913', "Dotations aux dépréciations des immobilisations"],
  ['6914', "Dotations aux dépréciations des stocks"],
  ['6915', "Dotations aux dépréciations des comptes de tiers"],
  ['697',  "Dotations aux provisions et dépréciations financières"],
];

// ============================================================================
//  CLASSE 7 — PRODUITS DES ACTIVITÉS ORDINAIRES
// ============================================================================
const CLASSE_7 = [
  ['70',   "Ventes"],
  ['701',  "Ventes de marchandises"],
  ['7011', "Ventes de marchandises dans la région"],
  ['7012', "Ventes de marchandises hors région"],
  ['702',  "Ventes de produits finis"],
  ['703',  "Ventes de produits intermédiaires"],
  ['704',  "Ventes de produits résiduels"],
  ['705',  "Travaux facturés"],
  ['706',  "Services vendus"],
  ['707',  "Produits accessoires"],
  ['7071', "Ports, emballages perdus et autres frais facturés"],
  ['7072', "Commissions et courtages"],
  ['7073', "Locations"],
  ['7074', "Bonis sur reprises et cessions d'emballages"],
  ['7075', "Mise à disposition de personnel"],
  ['7078', "Autres produits accessoires"],
  ['709',  "Rabais, remises et ristournes accordés"],

  ['71',   "Subventions d'exploitation"],
  ['711',  "Subventions d'exploitation sur produits à l'exportation"],
  ['712',  "Subventions d'exploitation sur produits à l'importation"],
  ['713',  "Subventions d'exploitation sur produits de péréquation"],
  ['718',  "Autres subventions d'exploitation"],

  ['72',   "Production immobilisée"],
  ['721',  "Immobilisations incorporelles"],
  ['722',  "Immobilisations corporelles"],
  ['726',  "Immobilisations financières"],

  ['73',   "Variations des stocks de biens et de services produits"],
  ['734',  "Variations des stocks de produits en cours"],
  ['735',  "Variations des en-cours de services"],
  ['736',  "Variations des stocks de produits finis"],
  ['737',  "Variations des stocks de produits intermédiaires et résiduels"],

  ['75',   "Autres produits"],
  ['751',  "Profits sur créances clients et autres débiteurs"],
  ['752',  "Quote-part de résultat sur opérations faites en commun"],
  ['753',  "Quote-part de résultat sur exécution partielle de contrats pluri-exercices"],
  ['754',  "Produits des cessions courantes d'immobilisations"],
  ['758',  "Produits divers"],
  ['759',  "Reprises de charges pour dépréciations et provisions d'exploitation"],

  ['77',   "Revenus financiers et produits assimilés"],
  ['771',  "Intérêts de prêts"],
  ['772',  "Revenus de participations"],
  ['773',  "Escomptes obtenus"],
  ['774',  "Revenus de titres de placement"],
  ['776',  "Gains de change"],
  ['777',  "Gains sur cessions de titres de placement"],
  ['778',  "Gains sur risques financiers"],
  ['779',  "Reprises de charges pour dépréciations et provisions financières"],

  ['78',   "Transferts de charges"],
  ['781',  "Transferts de charges d'exploitation"],
  ['787',  "Transferts de charges financières"],

  ['79',   "Reprises de provisions, de dépréciations et autres"],
  ['791',  "Reprises de provisions et dépréciations d'exploitation"],
  ['797',  "Reprises de provisions et dépréciations financières"],
  ['798',  "Reprises d'amortissements"],
];

// ============================================================================
//  CLASSE 8 — AUTRES CHARGES ET AUTRES PRODUITS (HORS ACTIVITÉS ORDINAIRES)
// ============================================================================
const CLASSE_8 = [
  ['81',   "Valeurs comptables des cessions d'immobilisations"],
  ['811',  "Immobilisations incorporelles"],
  ['812',  "Immobilisations corporelles"],
  ['816',  "Immobilisations financières"],

  ['82',   "Produits des cessions d'immobilisations"],
  ['821',  "Immobilisations incorporelles"],
  ['822',  "Immobilisations corporelles"],
  ['826',  "Immobilisations financières"],

  ['83',   "Charges hors activités ordinaires"],
  ['831',  "Charges HAO constatées"],
  ['834',  "Pertes sur créances HAO"],
  ['835',  "Dons et libéralités accordés"],
  ['836',  "Abandons de créances consentis"],
  ['839',  "Charges pour provisions et dépréciations HAO"],

  ['84',   "Produits hors activités ordinaires"],
  ['841',  "Produits HAO constatés"],
  ['845',  "Dons et libéralités obtenus"],
  ['846',  "Abandons de créances obtenus"],
  ['848',  "Transferts de charges HAO"],
  ['849',  "Reprises de provisions et dépréciations HAO"],

  ['85',   "Dotations hors activités ordinaires"],
  ['851',  "Dotations aux provisions réglementées"],
  ['852',  "Dotations aux amortissements HAO"],
  ['853',  "Dotations aux provisions pour risques et charges HAO"],
  ['854',  "Dotations aux dépréciations HAO"],
  ['858',  "Autres dotations HAO"],

  ['86',   "Reprises hors activités ordinaires"],
  ['861',  "Reprises de provisions réglementées"],
  ['862',  "Reprises d'amortissements HAO"],
  ['863',  "Reprises de provisions pour risques et charges HAO"],
  ['865',  "Reprises de dépréciations HAO"],

  ['87',   "Participation des travailleurs"],
  ['871',  "Participation légale aux bénéfices"],
  ['878',  "Autres participations"],

  ['88',   "Subventions d'équilibre"],
  ['881',  "Subventions d'équilibre reçues de l'État"],
  ['884',  "Subventions d'équilibre reçues d'autres organismes"],

  ['89',   "Impôts sur le résultat"],
  ['891',  "Impôts sur les bénéfices de l'exercice"],
  ['892',  "Rappel d'impôts sur résultats antérieurs"],
  ['895',  "Impôt minimum forfaitaire (IMF)"],
  ['899',  "Dégrèvements et annulations d'impôts sur résultats antérieurs"],
];

// ============================================================================
//  CLASSE 9 — ENGAGEMENTS HORS BILAN ET COMPTABILITÉ ANALYTIQUE
// ============================================================================
const CLASSE_9 = [
  ['90',   "Engagements obtenus et engagements accordés"],
  ['901',  "Engagements obtenus de tiers"],
  ['902',  "Engagements accordés à des tiers"],
  ['903',  "Engagements réciproques"],
  ['91',   "Contrepartie des engagements"],
  ['92',   "Comptes réfléchis"],
  ['93',   "Comptes de reclassements"],
  ['94',   "Comptes de coûts"],
  ['95',   "Comptes de stocks (comptabilité analytique)"],
  ['96',   "Comptes d'écarts sur coûts préétablis"],
  ['97',   "Comptes de différences de traitement comptable"],
  ['98',   "Comptes de résultats analytiques"],
  ['99',   "Comptes de liaisons internes"],
];

const LIGNES = [
  ...CLASSE_1, ...CLASSE_2, ...CLASSE_3, ...CLASSE_4, ...CLASSE_5,
  ...CLASSE_6, ...CLASSE_7, ...CLASSE_8, ...CLASSE_9,
];

/** Référentiel normalisé : [{ compte, intitule, classe, nature }, ...] */
const PLAN_COMPTABLE = LIGNES.map(([compte, intitule, nature]) => ({
  compte:   compte.trim(),
  intitule: intitule.trim(),
  classe:   resolveClasse(compte),
  nature:   resolveNature(compte, nature),
}));

module.exports = { PLAN_COMPTABLE, resolveClasse, resolveNature };
