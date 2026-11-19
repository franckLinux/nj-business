import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import NjMarque from '@/components/NjMarque';
import MonCompteModal from '@/components/MonCompteModal';
import { CONTACT_CABINET, modulesActifs, systemeInstalle, accesModule } from '@/lib/modules';

// Accueil NJ BUSINESS (26/10/2026) : point d'entrée vers les modules de l'espace.
// Présente seulement : l'accès réel est contrôlé par le serveur (403 MODULE_INACTIF).
// Aucun chiffre ni indicateur ici tant qu'il n'est pas calculé par le serveur.
const LIBELLE_ROLE = {
  directeur: 'Directeur', caissier: 'Caissier(ère)', auditeur: 'Comptable', collaborateur: 'Collaborateur', comptable_cabinet: 'Comptable cabinet',
};

const INITIALES = { commercial: 'CM', comptabilite: 'CT', cg: 'CG', dsf: 'DSF', revis: 'RV', rh: 'RH' };

export default function AccueilPage() {
  const { user, logout, can } = useApp();
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
  const aVenir = tous.filter((m) => m.statut === 'en_preparation');
  // Modules opérationnels que la personne ne peut pas ouvrir : on dit pourquoi au lieu de les cacher.
  //   • activé pour l'espace, mais aucun droit attribué à cette personne ;
  //   • pas encore activé pour l'espace (l'activation se fait par le cabinet).
  // 066 / lot E : la caisse aussi, quand la personne n'y est pas rattachée (contrôle appliqué).
  const sansDroits = systemeInstalle(user)
    ? tous.filter((m) => m.statut === 'operationnel' && m.actif && !accesModule(user, m.code) && (m.code !== 'caisse' || m.membre === false))
    : [];
  const activesEspace = systemeInstalle(user) ? tous.filter((m) => m.statut === 'operationnel' && m.actif).length : 1;
  const directeur = user?.role === 'directeur';
  const nomRaison = location.state?.module ? (tous.find((m) => m.code === location.state.module)?.nom || 'Ce module') : 'Ce module';
  const nonActives = systemeInstalle(user) ? tous.filter((m) => m.statut === 'operationnel' && !m.actif) : [];

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
          {user?.tenantNom || 'Votre entreprise'} · {actifs.length === 0
            ? (activesEspace === 0 ? 'aucun module activé' : 'aucun module attribué')
            : `${actifs.length} module${actifs.length > 1 ? 's' : ''} à votre disposition`}
        </p>

        {can('entreprise.view') && (
          <button type="button" className="njb-raccourci" onClick={() => navigate('/entreprise')}>
            <span className="njb-raccourci-ico" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><path d="M9 21v-6h6v6" /><path d="M9 10h.01M15 10h.01" /></svg>
            </span>
            <span><b>Configuration de l'entreprise</b><span>Identité, informations légales, logo et représentant légal, communs à tous les modules</span></span>
            <span className="njb-raccourci-fleche" aria-hidden="true">›</span>
          </button>
        )}

        {/* Lot E : chaque situation a son message et la bonne personne à contacter. */}
        {raison === 'module-inactif' && (
          <div className="njb-alerte" role="status">{nomRaison} a été désactivé pour votre espace. Pour le réactiver, contactez le cabinet : <a href={`mailto:${CONTACT_CABINET}`}>{CONTACT_CABINET}</a></div>
        )}
        {raison === 'module-non-autorise' && (
          <div className="njb-alerte" role="status">Votre accès à {nomRaison === 'Ce module' ? 'ce module' : nomRaison} a été retiré. {directeur ? 'Si c\'est une erreur, contactez le cabinet.' : 'Si c\'est une erreur, demandez à votre directeur de vous y rattacher à nouveau.'}</div>
        )}
        {!raison && actifs.length === 0 && activesEspace === 0 && (
          <div className="njb-alerte" role="status">Aucun module n'est encore activé pour votre espace. Contactez le cabinet : <a href={`mailto:${CONTACT_CABINET}`}>{CONTACT_CABINET}</a></div>
        )}
        {!raison && actifs.length === 0 && activesEspace > 0 && (
          <div className="njb-alerte" role="status">
            Aucun module ne vous est encore attribué.{' '}
            {directeur ? <>Contactez le cabinet : <a href={`mailto:${CONTACT_CABINET}`}>{CONTACT_CABINET}</a></> : 'Demandez à votre directeur de vous rattacher au module où vous travaillez.'}
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

        {(sansDroits.length > 0 || nonActives.length > 0) && (
          <>
            <p className="njb-surtitre">Autres modules</p>
            <div className="njb-grille">
              {sansDroits.map((m) => (
                <article key={m.code} className="njb-carte a-venir" aria-label={`${m.nom}, accès non attribué`}>
                  <span className="njb-ico-vide" aria-hidden="true">{INITIALES[m.code] || m.code.slice(0, 2).toUpperCase()}</span>
                  <h2>{m.nom}</h2>
                  <p>{m.description}</p>
                  <span className="njb-badge bientot">Activé · accès non attribué</span>
                  <span className="njb-contact">{m.membre === false
                    ? `Vous n'êtes pas rattaché(e) à ce module.${directeur ? ' Contactez le cabinet pour y être rattaché(e).' : ' Demandez à votre directeur de vous y ajouter.'}`
                    : `Le module est activé pour votre espace, mais aucun droit ne vous y est encore attribué.${directeur ? ' Contactez le cabinet.' : ' Demandez à votre directeur de vous attribuer un profil.'}`}</span>
                </article>
              ))}
              {nonActives.map((m) => (
                <article key={m.code} className="njb-carte a-venir" aria-label={`${m.nom}, non activé`}>
                  <span className="njb-ico-vide" aria-hidden="true">{INITIALES[m.code] || m.code.slice(0, 2).toUpperCase()}</span>
                  <h2>{m.nom}</h2>
                  <p>{m.description}</p>
                  <span className="njb-badge bientot">Disponible · non activé</span>
                  <span className="njb-contact">Pas encore activé pour votre espace. <a href={`mailto:${CONTACT_CABINET}?subject=${encodeURIComponent(`Activation du module ${m.nom}`)}`}>Demander l'activation</a></span>
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
