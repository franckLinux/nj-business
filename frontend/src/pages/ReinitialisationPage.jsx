import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

// Page publique de réinitialisation du mot de passe (C9) : lien reçu par
// e-mail, valable 1 heure et une seule fois.
export default function ReinitialisationPage({ token }) {
  const [info, setInfo] = useState(null);
  const [erreur, setErreur] = useState('');
  const [mdp, setMdp] = useState('');
  const [mdp2, setMdp2] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [fini, setFini] = useState(null);

  useEffect(() => {
    api.get(`/auth/reinitialisation/${encodeURIComponent(token)}`).then((r) => {
      if (r.error) setErreur(r.error); else setInfo(r);
    });
  }, [token]);

  const valider = async () => {
    setErreur('');
    if (mdp.length < 8 || !/[A-Za-z]/.test(mdp) || !/\d/.test(mdp)) { setErreur('8 caractères minimum, avec au moins une lettre et un chiffre.'); return; }
    if (mdp !== mdp2) { setErreur('Les deux mots de passe ne correspondent pas.'); return; }
    setEnCours(true);
    const r = await api.post(`/auth/reinitialisation/${encodeURIComponent(token)}`, { mot_de_passe: mdp });
    setEnCours(false);
    if (r.error) { setErreur(r.error); return; }
    setFini(r.identifiant || info?.identifiant || '');
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
          <p>{info?.invitation ? 'Bienvenue — création du mot de passe' : 'Réinitialisation du mot de passe'}</p>
        </div>
        <div className="login-card">
          {fini !== null ? (
            <>
              <h2>{info?.invitation ? 'Mot de passe créé ✓' : 'Mot de passe modifié ✓'}</h2>
              <p style={{ fontSize: 14 }}>Vous pouvez vous connecter avec votre nouveau mot de passe{fini ? <> (identifiant : <strong>{fini}</strong>)</> : ''}.</p>
              <button className="btn-primary" onClick={versConnexion}>Se connecter</button>
            </>
          ) : !info ? (
            <>
              <h2>Réinitialisation</h2>
              {erreur ? <div className="alert-err">{erreur}</div> : <p>Vérification du lien…</p>}
              {erreur && <button className="btn-primary" onClick={() => window.location.replace('/')}>Aller à la connexion</button>}
            </>
          ) : (
            <>
              <h2>{info.invitation ? 'Créez votre mot de passe' : 'Nouveau mot de passe'}</h2>
              <p style={{ fontSize: 13 }}>Compte : <strong>{info.identifiant}</strong></p>
              {erreur && <div className="alert-err">{erreur}</div>}
              <label>Nouveau mot de passe</label>
              <input type="password" autoComplete="new-password" value={mdp} onChange={(e) => setMdp(e.target.value)} placeholder="8 caractères, lettres et chiffres" />
              <label>Confirmez le mot de passe</label>
              <input type="password" autoComplete="new-password" value={mdp2} onChange={(e) => setMdp2(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') valider(); }} />
              <button className="btn-primary" onClick={valider} disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer le mot de passe'}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
