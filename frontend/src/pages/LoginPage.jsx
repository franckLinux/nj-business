import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { api } from '@/lib/api';
import NjMarque from '@/components/NjMarque';
import { marquerEntree } from '@/lib/modules';

// Écran de connexion NJ BUSINESS (26/10/2026).
// Même logique que l'ancien écran : même API (/auth/login), mêmes comptes,
// même lien « mot de passe oublié » (C9), même pré-remplissage après
// activation d'une démo et même message après expiration.
const IconeOeil = ({ barre }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
    {barre && <line x1="3" y1="3" x2="21" y2="21" />}
  </svg>
);

export default function LoginPage() {
  const { login } = useApp();
  // Après activation d'une démo : identifiant pré-rempli. Après expiration :
  // message de fin de démonstration. Lus une seule fois puis effacés.
  const lireUneFois = (cle) => {
    try { const v = sessionStorage.getItem(cle) || ''; sessionStorage.removeItem(cle); return v; } catch { return ''; }
  };
  const [username, setUsername] = useState(() => lireUneFois('login_prefill'));
  const [password, setPassword] = useState('');
  const [voirMdp, setVoirMdp] = useState(false);
  const [erreur, setErreur] = useState(() => lireUneFois('login_message'));
  const [enCours, setEnCours] = useState(false);
  // Mot de passe oublié (C9) : envoi d'un lien de réinitialisation par e-mail.
  const [oubli, setOubli] = useState(false);
  const [oubliMsg, setOubliMsg] = useState('');
  // 067 (lot D) : compte déjà connecté ailleurs → choix explicite de remplacer.
  const [autreSession, setAutreSession] = useState(null);

  const demanderLien = async (e) => {
    e?.preventDefault();
    if (!username.trim()) { setErreur('Saisissez votre identifiant ou votre adresse e-mail.'); return; }
    setEnCours(true); setErreur('');
    const r = await api.post('/auth/mot-de-passe-oublie', { identifiant: username.trim() });
    setEnCours(false);
    if (r.error) { setErreur(r.error); return; }
    setOubliMsg(r.message);
  };

  const doLogin = async (e) => {
    e?.preventDefault();
    if (!username.trim() || !password) {
      setErreur('Identifiant et mot de passe requis.');
      return;
    }
    setEnCours(true);
    setErreur('');
    marquerEntree(); // la redirection « après connexion » ne jouera qu'une fois
    const res = await login(username.trim(), password);
    setEnCours(false);
    if (res.code === 'SESSION_ACTIVE') { setAutreSession(res.session || {}); return; }
    if (res.error) setErreur(res.error);
    // En cas de succès, App bascule seul sur l'application : pas de navigation manuelle.
  };

  // Remplacement : même identifiant et même mot de passe, vérifiés à nouveau
  // par le serveur. L'autre appareil est déconnecté et le titulaire prévenu par e-mail.
  const remplacer = async () => {
    setEnCours(true);
    setErreur('');
    const res = await login(username.trim(), password, true);
    setEnCours(false);
    if (res.error) { setAutreSession(null); setErreur(res.error); }
  };
  const annulerRemplacement = () => { setAutreSession(null); setPassword(''); };
  const quand = (d) => (d ? new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null);

  const retourConnexion = () => { setOubli(false); setOubliMsg(''); setErreur(''); };

  return (
    <div id="screen-login" className="njb-login">
      <div className="njb-login-shell">
        <aside className="njb-login-marque" aria-label="NJ BUSINESS">
          <img src="/brand/nj-business-logo-fond-sombre.svg" alt="NJ BUSINESS" width="230" height="45" />
          <p className="njb-login-accroche">Plateforme de gestion intégrée pour les entreprises de la zone CEMAC, accompagnées par leur cabinet d'expertise comptable.</p>
          <div className="njb-login-modules">
            <p className="njb-surtitre">Module disponible</p>
            <div className="njb-login-module">
              <NjMarque taille={36} fond="#243655" module titre="NJ CAISSE PRO" />
              <div><b>NJ CAISSE PRO</b><span>Trésorerie, budget, contrôle comptable</span></div>
            </div>
          </div>
          <p className="njb-login-pied">Cabinet Expert-Comptable · Zone CEMAC</p>
        </aside>

        <main className="njb-login-form">
          {autreSession ? (
            <div className="njb-session" role="alertdialog" aria-labelledby="njb-session-titre" aria-describedby="njb-session-texte">
              <div className="njb-session-icone" aria-hidden="true">
                <svg viewBox="0 0 24 24"><rect x="3" y="4" width="13" height="10" rx="1.5" /><path d="M7 18h5M9.5 14v4" /><rect x="17" y="9" width="5" height="10" rx="1.2" /></svg>
              </div>
              <h1 id="njb-session-titre">Compte déjà connecté</h1>
              <p id="njb-session-texte" className="njb-sous-titre">Ce compte est déjà connecté sur un autre appareil. Veuillez fermer la session existante avant de vous connecter à nouveau.</p>
              <dl className="njb-session-detail">
                <div><dt>Appareil</dt><dd>{autreSession.appareil || 'Non identifié'}</dd></div>
                {quand(autreSession.depuis) && <div><dt>Connecté depuis</dt><dd>{quand(autreSession.depuis)}</dd></div>}
                {quand(autreSession.derniere_activite) && <div><dt>Dernière activité</dt><dd>{quand(autreSession.derniere_activite)}</dd></div>}
              </dl>
              {erreur && <div className="njb-erreur" role="alert">{erreur}</div>}
              <button type="button" className="njb-bouton" onClick={remplacer} disabled={enCours} autoFocus>
                {enCours && <span className="njb-spin" aria-hidden="true" />}
                {enCours ? 'Connexion…' : 'Fermer l\'autre session et me connecter ici'}
              </button>
              <button type="button" className="njb-bouton-second" onClick={annulerRemplacement} disabled={enCours}>Annuler</button>
              <p className="njb-session-note">L'autre appareil sera déconnecté immédiatement ; un e-mail vous confirmera ce changement. Si vous ne reconnaissez pas cette session, connectez-vous ici puis changez votre mot de passe.</p>
            </div>
          ) : oubli ? (
            <>
              <h1>Mot de passe oublié</h1>
              <p className="njb-sous-titre">Indiquez votre identifiant ou votre adresse e-mail : vous recevrez un lien pour choisir un nouveau mot de passe (valable 1 heure).</p>
              {erreur && <div className="njb-erreur" role="alert">{erreur}</div>}
              {oubliMsg ? <div className="njb-succes" role="status">{oubliMsg}</div> : (
                <form onSubmit={demanderLien} noValidate>
                  <div className="njb-champ">
                    <label htmlFor="njb-oubli-id">Identifiant ou adresse e-mail</label>
                    <input id="njb-oubli-id" type="text" autoComplete="username" value={username}
                      onChange={(e) => setUsername(e.target.value)} autoFocus />
                  </div>
                  <button type="submit" className="njb-bouton" disabled={enCours}>
                    {enCours && <span className="njb-spin" aria-hidden="true" />}
                    {enCours ? 'Envoi…' : 'Recevoir le lien'}
                  </button>
                </form>
              )}
              <p className="njb-demo"><button type="button" className="njb-lien" onClick={retourConnexion}>← Retour à la connexion</button></p>
            </>
          ) : (
            <>
              <h1>Bienvenue sur NJ BUSINESS</h1>
              <p className="njb-sous-titre">Votre espace de gestion professionnel, centralisé et sécurisé</p>
              {erreur && <div className="njb-erreur" role="alert">{erreur}</div>}
              <form onSubmit={doLogin} noValidate>
                <div className="njb-champ">
                  <label htmlFor="njb-identifiant">Identifiant ou adresse e-mail</label>
                  <input id="njb-identifiant" type="text" placeholder="ex. caissiere ou nom@entreprise.cm" autoComplete="username"
                    value={username} onChange={(e) => setUsername(e.target.value)} autoFocus={!username} />
                </div>
                <div className="njb-champ">
                  <label htmlFor="njb-mdp">Mot de passe</label>
                  <div className="njb-mdp">
                    <input id="njb-mdp" type={voirMdp ? 'text' : 'password'} autoComplete="current-password"
                      value={password} onChange={(e) => setPassword(e.target.value)} autoFocus={Boolean(username)} />
                    <button type="button" className="njb-afficher" onClick={() => setVoirMdp((v) => !v)}
                      aria-pressed={voirMdp} aria-controls="njb-mdp">
                      <IconeOeil barre={voirMdp} />{voirMdp ? 'Masquer' : 'Afficher'}
                    </button>
                  </div>
                </div>
                <div className="njb-lien-ligne">
                  <button type="button" className="njb-lien" onClick={() => { setOubli(true); setErreur(''); }}>Mot de passe oublié ?</button>
                </div>
                <button type="submit" className="njb-bouton" disabled={enCours}>
                  {enCours && <span className="njb-spin" aria-hidden="true" />}
                  {enCours ? 'Connexion…' : 'Se connecter'}
                </button>
              </form>
              <p className="njb-demo">Pas encore client ? <a href="/demande-demo">Demander une démonstration</a></p>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
