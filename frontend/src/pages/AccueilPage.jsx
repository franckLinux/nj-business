import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import NjMarque from '@/components/NjMarque';
import MonCompteModal from '@/components/MonCompteModal';
import { CONTACT_CABINET, modulesActifs, systemeInstalle } from '@/lib/modules';

// Accueil NJ BUSINESS (26/10/2026) : point d'entrée vers les modules de l'espace.
// Présente seulement : l'accès réel est contrôlé par le serveur (403 MODULE_INACTIF).
// Aucun chiffre ni indicateur ici tant qu'il n'est pas calculé par le serveur.
const LIBELLE_ROLE = {
  directeur: 'Directeur', caissier: 'Caissier(ère)', auditeur: 'Comptable', comptable_cabinet: 'Comptable cabinet',
};

const INITIALES = { commercial: 'CM', comptabilite: 'CT', cg: 'CG', dsf: 'DSF', revis: 'RV', rh: 'RH' };

export default function AccueilPage() {
  const { user, logout } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [monCompte, setMonCompte] = useState(false);
  const raison = location.state?.raison || null;

  useEffect(() => { document.title = 'Accueil — NJ BUSINESS'; return () => { document.title = 'NJ BUSINESS — Plateforme de gestion'; }; }, []);

  // Système de modules absent côté serveur : NJ CAISSE PRO seul, comme avant.
  const tous = systemeInstalle(user) ? user.modules : [{
    code: 'caisse', nom: 'NJ CAISSE PRO', description: 'Trésorerie, budget, demandes de fonds et contrôle comptable',
    statut: 'operationnel', route_accueil: '/', actif: true,
  }];
  const actifs = systemeInstalle(user) ? modulesActifs(user) : tous;
  // Modules en préparation : présentés comme « bientôt disponibles », jamais accessibles (décision D2).
  // Un module opérationnel mais désactivé pour ce client n'est pas affiché.
  const aVenir = tous.filter((m) => m.statut === 'en_preparation');

  const deconnexion = () => {
    if (window.confirm('Se déconnecter ?')) { logout(); navigate('/', { replace: true }); }
  };

  return (
    <div className="njb-accueil">
      <header className="njb-barre">
        <img src="/brand/nj-business-logo-fond-sombre.svg" alt="NJ BUSINESS" />
        <div className="njb-barre-droite">
          <span className="njb-utilisateur"><b>{user?.username}</b> · {LIBELLE_ROLE[user?.role] || user?.role}</span>
          <button type="button" className="njb-barre-btn" onClick={() => setMonCompte(true)} aria-label="Mon profil">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>
            <span>Mon profil</span>
          </button>
          <button type="button" className="njb-barre-btn" onClick={deconnexion} aria-label="Se déconnecter">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
            <span>Se déconnecter</span>
          </button>
        </div>
      </header>

      <main className="njb-contenu">
        <h1>Bonjour, bienvenue dans votre espace</h1>
        <p className="njb-espace">
          {user?.tenantNom || 'Votre entreprise'} · {actifs.length === 0 ? 'aucun module activé' : `${actifs.length} module${actifs.length > 1 ? 's' : ''} activé${actifs.length > 1 ? 's' : ''}`}
        </p>

        {(raison === 'module-inactif' || actifs.length === 0) && (
          <div className="njb-alerte" role="status">
            {raison === 'module-inactif' ? 'Ce module a été désactivé pour votre espace. ' : ''}
            {actifs.length === 0 ? 'Aucun module n\'est activé pour votre espace. ' : ''}
            Contactez le cabinet : <a href={`mailto:${CONTACT_CABINET}`}>{CONTACT_CABINET}</a>
          </div>
        )}

        {actifs.length > 0 && (
          <>
            <p className="njb-surtitre">Vos modules</p>
            <div className="njb-grille">
              {actifs.map((m) => (
                <article key={m.code} className="njb-carte active">
                  <NjMarque taille={40} module titre={m.nom} />
                  <h2>{m.nom}</h2>
                  <p>{m.description}</p>
                  <span className="njb-badge ok">Activé</span>
                  <button type="button" className="njb-bouton" onClick={() => navigate(m.route_accueil || '/')}>Accéder au module</button>
                </article>
              ))}
            </div>
          </>
        )}

        {aVenir.length > 0 && (
          <>
            <p className="njb-surtitre">Bientôt disponibles</p>
            <div className="njb-grille">
              {aVenir.map((m) => (
                <article key={m.code} className="njb-carte a-venir" aria-label={`${m.nom}, bientôt disponible`}>
                  <span className="njb-ico-vide" aria-hidden="true">{INITIALES[m.code] || m.code.slice(0, 2).toUpperCase()}</span>
                  <h2>{m.nom}</h2>
                  <p>{m.description}</p>
                  <span className="njb-badge bientot">Bientôt disponible</span>
                  <span className="njb-contact">Intéressé ? <a href={`mailto:${CONTACT_CABINET}?subject=${encodeURIComponent(`Module ${m.nom}`)}`}>Nous contacter</a></span>
                </article>
              ))}
            </div>
          </>
        )}
      </main>
      {monCompte && <MonCompteModal onClose={() => setMonCompte(false)} />}
    </div>
  );
}
