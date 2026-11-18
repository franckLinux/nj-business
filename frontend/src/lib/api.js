// Couche API — reprend le contrat de legacy/js/app.js :
// les réponses sont renvoyées telles quelles, une erreur métier arrive
// sous la forme { error: '...' }. Les pages migrées gardent donc le même code.
//
// Le backend enveloppe désormais toutes ses réponses JSON dans
// { success, message, data, errors } (voir backend/src/middleware/responseEnvelope.js).
// On déballe ici `data` — qui contient toujours le corps exact que le controller
// aurait renvoyé avant l'enveloppe — pour que le reste du frontend n'ait rien à changer.

// VITE_API_URL est vide par défaut (même domaine que le frontend, cas
// PlanetHoster standard où le backend sert aussi le build React). À
// renseigner uniquement si backend et frontend sont déployés sur deux
// domaines/sous-domaines distincts — voir frontend/.env.example.
export const API_BASE = import.meta.env.VITE_API_URL || '';
const API = API_BASE + '/api';

// Le token et le tenant actif sont injectés par AppContext au démarrage
// et à chaque changement, pour éviter de passer le state à chaque appel.
let authToken = null;
let tenantId = null;
let userId = null;
let onUnauthorized = null;

export const configureApi = (opts = {}) => {
  if ('token' in opts) authToken = opts.token;
  if ('tenantId' in opts) tenantId = opts.tenantId;
  if ('userId' in opts) userId = opts.userId;
  if ('onUnauthorized' in opts) onUnauthorized = opts.onUnauthorized;
};

// 067 (lot D) : jeton et compte ACTUELS, pour la file hors ligne (une saisie
// en attente repart avec la session en cours, jamais avec un ancien jeton).
export const sessionCourante = () => ({ token: authToken, userId, tenantId });

// Fin de session constatée par le serveur : message affiché sur l'écran de connexion.
const CODES_FIN_SESSION = ['SESSION_REMPLACEE', 'SESSION_REVOQUEE', 'SESSION_EXPIREE', 'SESSION_FERMEE', 'SESSION_INVALIDE'];
export const noterFinSession = (corps) => {
  if (!corps || !CODES_FIN_SESSION.includes(corps.code) || typeof window === 'undefined') return;
  try { sessionStorage.setItem('login_message', corps.error || corps.message || 'Votre session est terminée. Reconnectez-vous.'); } catch { /* indisponible */ }
};

const headers = () => ({
  'Content-Type': 'application/json',
  ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
  ...(tenantId ? { 'X-Tenant-Id': tenantId } : {}),
});

const request = async (method, url, body) => {
  let res;
  try {
    res = await fetch(API + url, {
      method,
      headers: headers(),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    // Réseau indisponible : on garde la forme { error } attendue par les pages.
    return { error: 'Connexion au serveur impossible.' };
  }

  // Certaines routes (DELETE) peuvent répondre sans corps JSON.
  const text = await res.text();
  if (!text) {
    if (res.status === 401 && onUnauthorized) onUnauthorized();
    return res.ok ? {} : { error: `Erreur ${res.status}` };
  }
  try {
    const parsed = JSON.parse(text);
    let out = parsed;
    if (parsed && typeof parsed.success === 'boolean') {
      out = parsed.data ?? (parsed.success ? {} : { error: parsed.message });
    }
    // Jeton refusé : session fermée, remplacée, révoquée ou expirée (067) → message puis écran de connexion.
    if (res.status === 401 && onUnauthorized) {
      if (authToken) noterFinSession(out);
      onUnauthorized();
    }
    // Interface plus récente que le serveur : la route n'existe pas encore
    // côté backend. Message explicite plutôt que « Route API inconnue ».
    if (res.status === 404 && out?.error === 'Route API inconnue.') {
      return { ...out, error: 'Cette fonction n\'est pas encore disponible sur le serveur : le backend déployé est plus ancien que l\'interface. Redéployez le backend (dossier src/) puis redémarrez l\'application.' };
    }
    // super_admin sans accès support sur un écran de caisse (réforme, étape 8) :
    // la fenêtre de demande d'accès support s'ouvre (Layout.jsx).
    if (res.status === 403 && out?.code === 'SUPPORT_REQUIS' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('support-requis', { detail: { tenantId: out.tenant_id } }));
    }
    // NJ BUSINESS (048) : module désactivé pour l'espace. AppContext relit les
    // modules et App ramène l'utilisateur à l'accueil NJ BUSINESS.
    // 066 : personne non rattachée au module (MODULE_NON_AUTORISE) : même retour à l'accueil.
    if (res.status === 403 && ['MODULE_INACTIF', 'MODULE_NON_AUTORISE'].includes(out?.code) && authToken && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('module-inactif', { detail: { module: out.module } }));
    }
    // Démonstration expirée (contrôle serveur) : AppContext ferme la session
    // et la page de connexion affiche le message.
    if (res.status === 403 && out?.code === 'DEMO_EXPIREE' && authToken && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('demo-expiree', { detail: { message: out.error } }));
    }
    return out;
  } catch {
    if (res.status === 401 && onUnauthorized) onUnauthorized();
    return { error: `Réponse inattendue du serveur (${res.status}).` };
  }
};

// Fichier protégé (ex. PV scanné, 046) : lu avec le jeton, jamais par une URL publique.
// Renvoie { blob, type } ou { error }.
const fichier = async (url) => {
  let res;
  try {
    res = await fetch(API + url, { headers: headers() });
  } catch {
    return { error: 'Connexion au serveur impossible.' };
  }
  if (res.status === 401 && onUnauthorized) onUnauthorized();
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    try { const j = JSON.parse(t); return { error: j.message || j.error || `Erreur ${res.status}` }; } catch { return { error: `Erreur ${res.status}` }; }
  }
  return { blob: await res.blob(), type: res.headers.get('content-type') || '' };
};

export const api = {
  fichier,
  get:    (url)       => request('GET', url),
  post:   (url, body) => request('POST', url, body ?? {}),
  put:    (url, body) => request('PUT', url, body ?? {}),
  patch:  (url, body) => request('PATCH', url, body ?? {}),
  delete: (url, body) => request('DELETE', url, body),   // corps facultatif (motif d'un retrait, 066)
};
