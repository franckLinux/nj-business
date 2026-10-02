import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, configureApi } from '@/lib/api';
import { MOIS, moisCourant, anneeCourante } from '@/lib/format';
import { syncManager } from '@/lib/syncManager';

// Équivalent React de l'objet `state` global de legacy/js/app.js.
// Mêmes clés de localStorage que l'app vanilla (caisse_token / caisse_user) :
// une session ouverte sur / reste valide sur /v2 et inversement.
const AppContext = createContext(null);

export const useApp = () => useContext(AppContext);

const TOKEN_KEY = 'caisse_token';
const USER_KEY = 'caisse_user';

const readSession = () => {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const raw = localStorage.getItem(USER_KEY);
    if (token && raw) return { token, user: JSON.parse(raw) };
  } catch { /* stockage illisible : on repart d'une session vide */ }
  return { token: null, user: null };
};

export function AppProvider({ children }) {
  const initial = readSession();
  const [token, setToken] = useState(initial.token);
  const [user, setUser] = useState(initial.user);

  const [activeTenantId, setActiveTenantId] = useState(null);
  const [activeTenantNom, setActiveTenantNom] = useState(null);
  const [devise, setDevise] = useState(initial.user?.devise || 'FCFA');
  const [tenantSelectorOpen, setTenantSelectorOpen] = useState(false);

  const [mois, setMois] = useState(moisCourant());
  const [annee, setAnnee] = useState(anneeCourante());

  const [journaux, setJournaux] = useState([]);
  const [journauxGrouped, setJournauxGrouped] = useState({});
  const [rubriques, setRubriques] = useState({ entrees: [], depenses: [] });

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
    setActiveTenantId(null);
    setActiveTenantNom(null);
    setJournaux([]);
    setJournauxGrouped({});
  }, []);

  // Le token doit être posé sur la couche API avant tout appel réseau.
  useEffect(() => {
    configureApi({
      token,
      tenantId: activeTenantId || user?.tenantId || null,
      onUnauthorized: logout,
    });
  }, [token, activeTenantId, user, logout]);

  const login = useCallback(async (username, password) => {
    const res = await api.post('/auth/login', { username, password });
    if (res.error) return res;
    localStorage.setItem(TOKEN_KEY, res.accessToken);
    localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    configureApi({ token: res.accessToken, tenantId: res.user?.tenantId || null });
    setToken(res.accessToken);
    setUser(res.user);
    setDevise(res.user?.devise || 'FCFA');
    return res;
  }, []);

  const loadJournaux = useCallback(async () => {
    const data = await api.get('/journaux');
    if (data.error) return;
    setJournaux(data.journaux || []);
    setJournauxGrouped(data.grouped || {});
  }, []);

  // Reprend loadRubriques() de legacy/js/app.js (l. 224-226) : mise en cache
  // pour la saisie hors-ligne, avec repli sur le cache si le réseau est coupé.
  const loadRubriques = useCallback(async () => {
    const data = await api.get('/rubriques');
    if (data.entrees) {
      setRubriques(data);
      try { await syncManager.cacheRubriques(data); } catch { /* IndexedDB indisponible */ }
    } else if (!navigator.onLine) {
      try {
        const cached = await syncManager.getCachedRubriques();
        if (cached.entrees.length > 0) setRubriques(cached);
      } catch { /* pas de cache disponible */ }
    }
  }, []);

  // Chargement des référentiels dès qu'une session est active.
  useEffect(() => {
    if (!token) return;
    loadRubriques();
    loadJournaux();
  }, [token, activeTenantId, loadRubriques, loadJournaux]);

  // Les permissions gouvernent tout l'affichage : on les rafraîchit à chaque
  // chargement de page, sinon une permission accordée par un administrateur
  // n'apparaîtrait qu'à la prochaine reconnexion de la personne concernée.
  // On ne récupère que `permissions` et `role` : /auth/me renvoie le reste des
  // champs en snake_case, les fusionner écraserait l'objet user du login.
  useEffect(() => {
    if (!token) return;
    let annule = false;
    api.get('/auth/me').then((me) => {
      if (annule || me?.error || !me) return;
      setUser((precedent) => {
        if (!precedent) return precedent;
        const suivant = { ...precedent, role: me.role, permissions: me.permissions };
        try { localStorage.setItem(USER_KEY, JSON.stringify(suivant)); } catch { /* stockage plein ou indisponible */ }
        return suivant;
      });
    });
    return () => { annule = true; };
  }, [token]);

  const selectTenant = useCallback((id, nom, dev) => {
    setActiveTenantId(id);
    setActiveTenantNom(nom);
    if (dev) setDevise(dev);
  }, []);

  // État global du sélecteur de client — ouvert par le clic sur le badge tenant
  // (Topbar) ou automatiquement au login pour un super_admin sans tenant actif
  // (voir Layout.jsx), reprend showTenantSelector() de legacy/js/app.js.
  const openTenantSelector = useCallback(() => setTenantSelectorOpen(true), []);
  const closeTenantSelector = useCallback(() => setTenantSelectorOpen(false), []);

  // Test d'autorisation unique de l'interface : `can('rubriques.edit')`.
  // Applique exactement la règle du backend (services/permission.service.js),
  // à partir de la liste résolue que /auth/login et /auth/me renvoient.
  // `permissions` à null = super_admin (aucune restriction) ; absent = liste
  // pas encore chargée, on refuse par défaut le temps que /auth/me réponde.
  const can = useCallback((code) => {
    if (!user) return false;
    if (user.role === 'super_admin' || user.permissions === null) return true;
    return Array.isArray(user.permissions) && user.permissions.includes(code);
  }, [user]);

  // Appartenance au cabinet (choix du client à administrer) : c'est une
  // identité, pas une fonctionnalité — reste porté par le rôle. Même règle que
  // le serveur (middleware/auth.js → isCabinet) : un comptable_cabinet
  // rattaché à un client n'est PAS membre du cabinet.
  const isAdmin = user?.role === 'super_admin'
    || (user?.role === 'comptable_cabinet' && !user?.tenantId);
  const peutVoirAttente = can('journal.validate');

  const tenantLabel = activeTenantNom
    || user?.tenantNom
    || user?.tenantSlug
    || (isAdmin && !user?.tenantId ? '— Choisir un client —' : 'Cabinet');

  const value = useMemo(() => ({
    token, user, isAuthenticated: Boolean(token && user),
    login, logout,
    can, isAdmin, peutVoirAttente,
    activeTenantId, activeTenantNom, tenantLabel, selectTenant,
    tenantSelectorOpen, openTenantSelector, closeTenantSelector,
    devise, setDevise,
    mois, setMois, annee, setAnnee, MOIS,
    journaux, journauxGrouped, loadJournaux,
    rubriques, loadRubriques,
  }), [token, user, login, logout, can, isAdmin, peutVoirAttente, activeTenantId,
       activeTenantNom, tenantLabel, selectTenant, tenantSelectorOpen,
       openTenantSelector, closeTenantSelector, devise, mois, annee,
       journaux, journauxGrouped, loadJournaux, rubriques, loadRubriques]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
