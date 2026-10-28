import { useState } from 'react';
import { useToast } from '@/context/ToastContext';
import { syncManager } from '@/lib/syncManager';

// Bouton « Rafraîchir » de la barre du haut (27/10/2026), à côté de la cloche.
// Recharge les données sans recharger l'application ni déconnecter :
//   • l'écran affiché (Layout le remonte → il relit ses données) ;
//   • journaux, badges, compteur de notifications ;
//   • droits et modules de l'utilisateur (/auth/me) ;
//   • envoie les saisies hors ligne en attente, s'il y en a.
// Une fenêtre de saisie ouverte serait perdue : on demande confirmation.
export const EVENEMENT_RAFRAICHIR = 'njb-rafraichir';

export default function RafraichirBouton() {
  const toast = useToast();
  const [enCours, setEnCours] = useState(false);

  const rafraichir = async () => {
    if (enCours) return;
    if (!navigator.onLine) {
      toast('Hors ligne : impossible de rafraîchir pour l\'instant.', 'error');
      return;
    }
    if (document.querySelector('.modal-overlay')
      && !window.confirm('Une fenêtre est ouverte : une saisie en cours sera perdue. Rafraîchir quand même ?')) return;
    setEnCours(true);
    const debut = Date.now();
    try {
      if ((await syncManager.countPending()) > 0) await syncManager.replayAll();
    } catch { /* la file reste en place ; elle repartira au prochain essai */ }
    window.dispatchEvent(new CustomEvent(EVENEMENT_RAFRAICHIR));
    // Animation visible au moins 600 ms : retour clair que le clic a été pris en compte.
    setTimeout(() => { setEnCours(false); toast('Données à jour.', 'success', 1800); }, Math.max(0, 600 - (Date.now() - debut)));
  };

  return (
    <button type="button" className={'btn-icon njb-rafraichir' + (enCours ? ' tourne' : '')} onClick={rafraichir}
      title="Rafraîchir les données" aria-label="Rafraîchir les données" aria-busy={enCours} disabled={enCours}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <polyline points="21 3 21 9 15 9" />
      </svg>
    </button>
  );
}
