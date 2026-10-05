import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

// Activation d'un accès de démonstration (lien reçu par e-mail).
// Page publique : le prospect choisit son mot de passe ; aucun mot de passe
// n'a jamais circulé par e-mail.
const dateFr = (d) => (d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '');

export default function ActivationPage({ token }) {
  const [info, setInfo] = useState(null);
  const [erreur, setErreur] = useState('');
  const [mdp, setMdp] = useState('');
  const [mdp2, setMdp2] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [fini, setFini] = useState(null);

  useEffect(() => {
    api.get(`/activation/${encodeURIComponent(token)}`).then((r) => {
      if (r.error) setErreur(r.error); else setInfo(r);
    });
  }, [token]);

  const activer = async () => {
    setErreur('');
    if (mdp.length < 8 || !/[A-Za-z]/.test(mdp) || !/\d/.test(mdp)) { setErreur('8 caractères minimum, avec au moins une lettre et un chiffre.'); return; }
    if (mdp !== mdp2) { setErreur('Les deux mots de passe ne correspondent pas.'); return; }
    setEnCours(true);
    const r = await api.post(`/activation/${encodeURIComponent(token)}`, { mot_de_passe: mdp });
    setEnCours(false);
    if (r.error) { setErreur(r.error); return; }
    setFini(r.identifiant);
  };

  const versConnexion = () => {
    try { sessionStorage.setItem('login_prefill', fini || ''); } catch { /* stockage indisponible */ }
    window.location.replace('/');
  };

  return (
    <div id="screen-login" className="screen" style={{ display: 'block' }}>
      <div className="login-wrap">
        <div className="login-brand">
          <div className="brand-icon">₣</div>
          <h1>NJ Caisse Pro</h1>
          <p>Activation de votre accès de démonstration</p>
        </div>
        <div className="login-card">
          {fini ? (
            <>
              <h2>Accès activé ✓</h2>
              <p style={{ fontSize: 14 }}>Votre identifiant de connexion est <strong>{fini}</strong>.</p>
              <button className="btn-primary" onClick={versConnexion}>Se connecter</button>
            </>
          ) : !info ? (
            <>
              <h2>Activation</h2>
              {erreur ? <div className="alert-err">{erreur}</div> : <p>Vérification du lien…</p>}
              {erreur && <button className="btn-primary" onClick={() => window.location.replace('/')}>Aller à la connexion</button>}
            </>
          ) : (
            <>
              <h2>Bienvenue {info.nom}</h2>
              <p style={{ fontSize: 13 }}>
                Démonstration du {dateFr(info.demo_debut)} au <strong>{dateFr(info.demo_fin)}</strong>.<br />
                Identifiant : <strong>{info.identifiant}</strong>
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Espace de test isolé : n'y saisissez pas de données réelles.</p>
              {erreur && <div className="alert-err">{erreur}</div>}
              <label>Choisissez un mot de passe</label>
              <input type="password" autoComplete="new-password" value={mdp} onChange={(e) => setMdp(e.target.value)} placeholder="8 caractères, lettres et chiffres" />
              <label>Confirmez le mot de passe</label>
              <input type="password" autoComplete="new-password" value={mdp2} onChange={(e) => setMdp2(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') activer(); }} />
              <button className="btn-primary" onClick={activer} disabled={enCours}>{enCours ? 'Activation…' : 'Activer mon accès'}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
