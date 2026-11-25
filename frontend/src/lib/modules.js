// lib/modules.js — NJ BUSINESS : modules de l'espace (migration 048).
//
// `user.modules` vient de /auth/login et /auth/me :
//   • tableau [{ code, nom, description, statut, route_accueil, actif }] ;
//   • null / absent : système de modules pas encore installé sur le serveur →
//     comportement d'avant (NJ CAISSE PRO seul, entrée directe).
// L'interface ne fait que présenter : c'est le serveur qui refuse l'accès
// (403 MODULE_INACTIF) à un module désactivé.

export const systemeInstalle = (user) => Array.isArray(user?.modules);

/**
 * La PERSONNE a-t-elle de quoi travailler dans ce module ? (050)
 *   • NJ CAISSE PRO : tous les rôles sauf « collaborateur » (aucun droit de caisse) ;
 *   • NJ COMMERCIAL : au moins une permission com.* ;
 *   • NJ COMPTABILITÉ : au moins une permission compta.* ;
 * Le serveur reste seul juge : chaque route exige sa permission.
 */
export const accesModule = (user, code) => {
  if (user?.role === 'super_admin') return true;
  // 066 : rattachement au module (contrôle appliqué) : il décide.
  const m = Array.isArray(user?.modules) ? user.modules.find((x) => x.code === code) : null;
  if (m && m.membre === false) return false;
  if (code === 'caisse') return user?.role !== 'collaborateur';
  if (code === 'commercial') return Array.isArray(user?.permissions) && user.permissions.some((p) => p.startsWith('com.'));
  // 076 : NJ COMPTABILITÉ, au moins une permission compta.*
  if (code === 'comptabilite') return Array.isArray(user?.permissions) && user.permissions.some((p) => p.startsWith('compta.'));
  return true;
};

/** Modules activés et opérationnels pour l'espace de l'utilisateur, et ouverts à cette personne. */
export const modulesActifs = (user) => (systemeInstalle(user)
  ? user.modules.filter((m) => m.actif && m.statut === 'operationnel' && accesModule(user, m.code))
  : []);

/** Le module est-il utilisable ? Sans système installé : NJ CAISSE PRO seul. */
export const moduleActif = (user, code) => (systemeInstalle(user)
  ? modulesActifs(user).some((m) => m.code === code)
  : code === 'caisse');

/** Utilisateur rattaché à un client : c'est à lui que l'accueil NJ BUSINESS s'adresse. */
export const utiliseAccueil = (user) => Boolean(user?.tenantId) && !['super_admin', 'commercial'].includes(user?.role);

/**
 * Où aller juste après la connexion — lot E, décision n° 4 de Franck (17/11/2026) :
 * TOUJOURS l'accueil NJ BUSINESS pour une personne d'un client, même avec un
 * seul module (remplace l'entrée directe de la décision D1). L'accueil ne
 * montre que ses modules et dit pourquoi les autres sont fermés.
 * null = laisser la route par défaut décider (cabinet, super_admin, système absent).
 */
export const routeApresConnexion = (user) => {
  if (!utiliseAccueil(user) || !systemeInstalle(user)) return null;
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
