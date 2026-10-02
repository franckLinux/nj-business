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
let onUnauthorized = null;

export const configureApi = (opts = {}) => {
  if ('token' in opts) authToken = opts.token;
  if ('tenantId' in opts) tenantId = opts.tenantId;
  if ('onUnauthorized' in opts) onUnauthorized = opts.onUnauthorized;
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

  if (res.status === 401 && onUnauthorized) onUnauthorized();

  // Certaines routes (DELETE) peuvent répondre sans corps JSON.
  const text = await res.text();
  if (!text) return res.ok ? {} : { error: `Erreur ${res.status}` };
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.success === 'boolean') {
      return parsed.data ?? (parsed.success ? {} : { error: parsed.message });
    }
    return parsed;
  } catch {
    return { error: `Réponse inattendue du serveur (${res.status}).` };
  }
};

export const api = {
  get:    (url)       => request('GET', url),
  post:   (url, body) => request('POST', url, body ?? {}),
  put:    (url, body) => request('PUT', url, body ?? {}),
  patch:  (url, body) => request('PATCH', url, body ?? {}),
  delete: (url)       => request('DELETE', url),
};
