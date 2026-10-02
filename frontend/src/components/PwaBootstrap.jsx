import { useEffect } from 'react';
import { useToast } from '@/context/ToastContext';
import { syncManager } from '@/lib/syncManager';
import { pwaInstall } from '@/lib/pwaInstall';

// Reprend le bloc BOOT de legacy/js/app.js (l. 6293-6314) : enregistrement
// du service worker, capture de `beforeinstallprompt`, init de SyncManager.
// Monté une seule fois, tout en haut de l'arbre (App.jsx), pour fonctionner
// dès l'écran de connexion — comme en legacy où ce bloc tourne avant
// `launchApp()`.
export default function PwaBootstrap() {
  const toast = useToast();

  useEffect(() => {
    syncManager.setToast(toast);
    syncManager.init();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
        .then((reg) => {
          reg.addEventListener('updatefound', () => {
            const sw = reg.installing;
            sw.addEventListener('statechange', () => {
              if (sw.state === 'installed' && navigator.serviceWorker.controller) {
                toast('Mise à jour disponible — rechargez.', '');
              }
            });
          });
        })
        .catch((err) => console.warn('[PWA]', err));
    }

    const onBeforeInstall = (e) => {
      e.preventDefault();
      pwaInstall.capture(e);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, [toast]);

  return null;
}
