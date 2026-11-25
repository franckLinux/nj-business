// lib/acces.js — permission « d'entrée » de chaque écran.
// Source unique pour le menu latéral, les onglets de Configuration et la
// garde des routes : un écran dont la personne n'a pas la permission de
// consultation n'est ni affiché dans le menu, ni accessible par l'URL.
// Les codes sont ceux exigés par l'API de l'écran (routes/index.js) : sans
// eux, l'écran ne ferait qu'afficher « Permission requise : … ».

// Une liste = toutes requises (l'écran appelle plusieurs API).
export const PAGE_PERMS = {
  '/journaux-recap': 'journal.view',
  '/budget':         ['budget.view', 'journal.view'],
  '/previsions':     ['previsions.view', 'budget.view'],
  '/appel-fonds':    ['appel_fonds.view', 'banque.view'],
  '/compte-emploi':  'rapport.view',
  '/attente':        'journal.validate',
  '/activites':      'rapport.view',
  // Contrôle comptable (041) : menu réservé au comptable / contrôleur et au directeur.
  // 25/10/2026 : l'entrée de menu est « Contrôle de régularité formelle » ;
  // le rapport (/controle/pieces) s'ouvre par le bouton « Rapport » de la page.
  '/controle/pieces':     'controle.view',
  '/controle/regularite': 'controle.view',   // 045 : contrôle de régularité formelle
  '/controle/registre':   'controle.view',
  '/controle/arretes':    'controle.view',   // 046 : arrêtés de caisse & inventaires (PV)
  '/controle/ecarts':     'controle.view',   // 061 : registre des écarts de caisse
  '/controle/passerelle': ['controle.view', 'passerelle.view'],
  // NJ FINANCE (F4, 078) : clients et fournisseurs.
  '/finance/tiers':    'finance.tiers.voir',
  '/finance/creances': 'finance.tiers.voir',
  '/finance/dettes':   'finance.tiers.voir',
  // NJ FINANCE (F6, 080) : achats.
  '/finance/achats':            'finance.achats.voir',
  '/finance/achats/nouvelle':   'finance.achats.saisir',
  '/finance/achats/lecture':    'finance.achats.importer',   // F7 (082)
  '/finance/achats/echeancier': 'finance.achats.voir',
  // NJ FINANCE (F8, 081) : ventes et facturation.
  '/finance/ventes':            'finance.ventes.voir',
  '/finance/ventes/nouvelle':   'finance.ventes.facturer',
  '/finance/ventes/echeancier': 'finance.ventes.voir',
};

// Onglets de la page Configuration.
// Un onglet n'est affiché qu'à qui peut AGIR dessus (permission de gestion).
// La simple consultation ne suffit pas : la caissière a besoin de
// `rubriques.view`, `users.view`, `pieces.view`… pour saisir (listes
// déroulantes, pièces jointes), sans pour autant devoir voir les écrans de
// paramétrage correspondants. Exception : le comptable (code « auditeur »,
// ex-Auditeur), en consultation sur la Configuration, voit les onglets qu'il
// peut consulter. Et un onglet qu'un administrateur a
// explicitement accordé à la personne (exception individuelle, par ex.
// « Voir les rubriques » cochée pour une caissière) réapparaît aussi.
export const CONFIG_TABS = {
  entite:    { voir: 'config.view',         gerer: ['config.edit'] },
  users:     { voir: 'users.view',          gerer: ['users.create', 'users.edit', 'users.delete'] },
  journaux:  { voir: 'journaux.view',       gerer: ['journaux.edit'] },
  plan:      { voir: 'plan_comptable.view', gerer: ['plan_comptable.edit', 'plan_comptable.delete'] },
  // rubriques.create (044) : la caissière ajoute des rubriques pour sa saisie.
  rubriques: { voir: 'rubriques.view',      gerer: ['rubriques.edit', 'rubriques.create'] },
  pieces:    { voir: 'pieces.view',         gerer: ['pieces.edit'] },
  activites: { voir: 'activites.view',      gerer: ['activites.edit'] },
  // NJ FINANCE (menu réorganisé le 25/11/2026) : clients et fournisseurs dans la Configuration.
  // La consultation suffit (la caissière consulte les fiches) : voirSuffit.
  clients:      { voir: 'finance.tiers.voir', gerer: ['finance.tiers.gerer'], voirSuffit: true },
  fournisseurs: { voir: 'finance.tiers.voir', gerer: ['finance.tiers.gerer'], voirSuffit: true },
  // NJ FINANCE F5 (079) : paramétrage de la facturation.
  facturation: { voir: 'finance.config.facturation', gerer: ['finance.config.facturation'] },
  // La passerelle comptable a quitté la Configuration (041) : menu « Contrôle comptable ».
};

export const voitOngletConfig = (user, can, id) => {
  const t = CONFIG_TABS[id];
  if (!t) return false;
  if (t.gerer.some((c) => can(c))) return true;
  if (!can(t.voir)) return false;
  if (t.voirSuffit || user?.role === 'auditeur') return true;
  const accordees = Array.isArray(user?.permissionsAccordees) ? user.permissionsAccordees : [];
  return [t.voir, ...t.gerer].some((c) => accordees.includes(c));
};

export const voitConfiguration = (user, can) => Object.keys(CONFIG_TABS).some((id) => voitOngletConfig(user, can, id));

// can() étendu aux listes de codes (tous requis).
export const peut = (can, code) => (Array.isArray(code) ? code.every((c) => can(c)) : can(code));

// Prospects et démonstrations : super_admin, ou membre du cabinet (sans client
// de rattachement) titulaire de « prospects.gerer ». La permission accordée
// individuellement compte même quand un client est sélectionné (le plafond du
// client consulté ne concerne pas cette fonction plateforme).
export const peutGererProspects = (user, can) => Boolean(user) && (
  user.role === 'super_admin'
  || ((user.role === 'comptable_cabinet' || user.role === 'commercial') && !user.tenantId
      && (can('prospects.gerer') || (user.permissionsAccordees || []).includes('prospects.gerer')))
);
