// lib/modules.js — NJ BUSINESS : modules de l'espace (migration 048).
//
// `user.modules` vient de /auth/login et /auth/me :
//   • tableau [{ code, nom, description, statut, route_accueil, actif }] ;
//   • null / absent : système de modules pas encore installé sur le serveur →
//     comportement d'avant (NJ CAISSE PRO seul, entrée directe).
// L'interface ne fait que présenter : c'est le serveur qui refuse l'accès
// (403 MODULE_INACTIF) à un module désactivé.

export const systemeInstalle = (user) => Array.isArray(user?.modules);

/** Modules activés et opérationnels pour l'espace de l'utilisateur. */
export const modulesActifs = (user) => (systemeInstalle(user)
  ? user.modules.filter((m) => m.actif && m.statut === 'operationnel')
  : []);

/** Le module est-il utilisable ? Sans système installé : NJ CAISSE PRO seul. */
export const moduleActif = (user, code) => (systemeInstalle(user)
  ? modulesActifs(user).some((m) => m.code === code)
  : code === 'caisse');

/** Utilisateur rattaché à un client : c'est à lui que l'accueil NJ BUSINESS s'adresse. */
export const utiliseAccueil = (user) => Boolean(user?.tenantId) && !['super_admin', 'commercial'].includes(user?.role);

/**
 * Où aller juste après la connexion (décision D1) :
 *   • un seul module activé → entrée directe dans ce module (comportement actuel) ;
 *   • plusieurs, ou aucun → accueil NJ BUSINESS.
 * null = laisser la route par défaut décider (cabinet, super_admin, système absent).
 */
export const routeApresConnexion = (user) => {
  if (!utiliseAccueil(user) || !systemeInstalle(user)) return null;
  const actifs = modulesActifs(user);
  if (actifs.length === 1) return actifs[0].route_accueil || '/';
  return '/accueil';
};

// Marque posée à la connexion : la redirection ci-dessus ne joue qu'une fois,
// pour que « Accéder au module » depuis l'accueil ne ramène pas à l'accueil.
const CLE_ENTREE = 'njb_entree';
export const marquerEntree = () => { try { sessionStorage.setItem(CLE_ENTREE, '1'); } catch { /* indisponible */ } };
export const consommerEntree = () => {
  try {
    const v = sessionStorage.getItem(CLE_ENTREE) === '1';
    sessionStorage.removeItem(CLE_ENTREE);
    return v;
  } catch { return false; }
};

export const CONTACT_CABINET = 'contact@nj-business.net';
