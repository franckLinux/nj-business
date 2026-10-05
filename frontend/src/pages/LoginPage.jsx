import { useState } from 'react';
import { useApp } from '@/context/AppContext';

// Écran de connexion — même markup et mêmes libellés que #screen-login
// dans legacy/index.html.
export default function LoginPage() {
  const { login } = useApp();
  // Après activation d'une démo : identifiant pré-rempli. Après expiration :
  // message de fin de démonstration. Lus une seule fois puis effacés.
  const lireUneFois = (cle) => {
    try { const v = sessionStorage.getItem(cle) || ''; sessionStorage.removeItem(cle); return v; } catch { return ''; }
  };
  const [username, setUsername] = useState(() => lireUneFois('login_prefill'));
  const [password, setPassword] = useState('');
  const [erreur, setErreur] = useState(() => lireUneFois('login_message'));
  const [enCours, setEnCours] = useState(false);

  const doLogin = async () => {
    if (!username.trim() || !password) {
      setErreur('Identifiant et mot de passe requis.');
      return;
    }
    setEnCours(true);
    setErreur('');
    const res = await login(username.trim(), password);
    setEnCours(false);
    if (res.error) setErreur(res.error);
    // En cas de succès, App bascule seul sur le layout : pas de navigation manuelle.
  };

  return (
    <div id="screen-login" className="screen" style={{ display: 'block' }}>
      <div className="login-wrap">
        <div className="login-brand">
          <div className="brand-icon">₣</div>
          <h1>NJ Caisse Pro</h1>
          <p>Plateforme de Gestion de Caisse — Cabinet Expert-Comptable</p>
        </div>
        <div className="login-card">
          <h2>Connexion</h2>
          {erreur && <div className="alert-err">{erreur}</div>}
          <label>Identifiant</label>
          <input
            type="text"
            placeholder="Ex: caissiere ou adresse e-mail"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <label>Mot de passe</label>
          <input
            type="password"
            placeholder="••••••••"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') doLogin(); }}
          />
          <button className="btn-primary" onClick={doLogin} disabled={enCours}>
            {enCours ? 'Connexion…' : 'Se connecter'}
          </button>
          <p className="login-hint">Cabinet Expert-Comptable · Zone CEMAC</p>
        </div>
      </div>
    </div>
  );
}
