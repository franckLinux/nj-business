import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, configureApi } from '@/lib/api';
import { MOIS, moisCourant, anneeCourante } from '@/lib/format';

// Équivalent React de l'objet `state` global de public/js/app.js.
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

  const loadRubriques = useCallback(async () => {
    const data = await api.get('/rubriques');
    if (data.entrees) setRubriques(data);
  }, []);

  // Chargement des référentiels dès qu'une session est active.
  useEffect(() => {
    if (!token) return;
    loadRubriques();
    loadJournaux();
  }, [token, activeTenantId, loadRubriques, loadJournaux]);

  const selectTenant = useCallback((id, nom, dev) => {
    setActiveTenantId(id);
    setActiveTenantNom(nom);
    if (dev) setDevise(dev);
  }, []);

  const isAdmin = ['super_admin', 'comptable_cabinet'].includes(user?.role);
  const peutVoirAttente = ['directeur', 'super_admin'].includes(user?.role);

  const tenantLabel = activeTenantNom
    || user?.tenantNom
    || user?.tenantSlug
    || (isAdmin && !user?.tenantId ? '— Choisir un client —' : 'Cabinet');

  const value = useMemo(() => ({
    token, user, isAuthenticated: Boolean(token && user),
    login, logout,
    isAdmin, peutVoirAttente,
    activeTenantId, activeTenantNom, tenantLabel, selectTenant,
    devise, setDevise,
    mois, setMois, annee, setAnnee, MOIS,
    journaux, journauxGrouped, loadJournaux,
    rubriques, loadRubriques,
  }), [token, user, login, logout, isAdmin, peutVoirAttente, activeTenantId,
       activeTenantNom, tenantLabel, selectTenant, devise, mois, annee,
       journaux, journauxGrouped, loadJournaux, rubriques, loadRubriques]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
