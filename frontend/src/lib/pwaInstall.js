// Port de la logique installPWA()/beforeinstallprompt de legacy/js/app.js
// (l. 6172-6176, 6306-6309) — remplace la variable globale
// `window._pwaInstallPrompt` par un petit module d'état partagé, observable
// par InstallPwaButton.jsx.
let deferredPrompt = null;
const listeners = new Set();

const notify = () => listeners.forEach((cb) => cb(Boolean(deferredPrompt)));

export const pwaInstall = {
  capture: (event) => {
    deferredPrompt = event;
    notify();
  },
  isAvailable: () => Boolean(deferredPrompt),
  subscribe: (cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  prompt: async () => {
    if (!deferredPrompt) return false;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    notify();
    return true;
  },
};
