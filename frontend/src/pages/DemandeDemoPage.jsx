import { useState } from 'react';
import { api } from '@/lib/api';

// Page publique « Demander une démonstration ».
// La demande arrive dans « Prospects & démos » (à traiter) ; c'est le cabinet
// qui décide d'envoyer l'accès. Aucun compte n'est créé ici.
const VIDE = {
  nom_complet: '', entreprise: '', email: '', telephone: '', ville: '', pays: 'Cameroun',
  secteur: '', nb_points_vente: '', nb_utilisateurs: '', besoins: '', site_web: '',
};

export default function DemandeDemoPage() {
  const [f, setF] = useState(VIDE);
  const [consentement, setConsentement] = useState(false);
  const [erreur, setErreur] = useState('');
  const [envoye, setEnvoye] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const envoyer = async () => {
    setErreur('');
    if (!f.nom_complet.trim()) { setErreur('Indiquez votre nom.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) { setErreur('Adresse e-mail invalide.'); return; }
    if (!f.telephone.trim()) { setErreur('Indiquez un numéro de téléphone.'); return; }
    if (!consentement) { setErreur('Merci d\'accepter d\'être recontacté(e).'); return; }
    setEnCours(true);
    const r = await api.post('/demande-demo', { ...f, email: f.email.trim(), consentement: true });
    setEnCours(false);
    if (r.error) { setErreur(r.error); return; }
    setEnvoye(true);
  };

  const champ = (label, k, opts = {}) => (
    <>
      <label>{label}{opts.req && ' *'}</label>
      <input type={opts.type || 'text'} value={f[k]} onChange={set(k)} placeholder={opts.ph} autoComplete={opts.ac} />
    </>
  );

  return (
    <div id="screen-login" className="screen" style={{ display: 'block' }}>
      <div className="login-wrap">
        <div className="login-brand">
          <div className="brand-icon">₣</div>
          <h1>NJ Caisse Pro</h1>
          <p>Gestion de caisse, budgets et appels de fonds — conforme SYSCOHADA</p>
        </div>
        <div className="login-card" style={{ maxWidth: 520 }}>
          {envoye ? (
            <>
              <h2>Demande envoyée ✓</h2>
              <p style={{ fontSize: 14 }}>Merci ! Le cabinet étudie votre demande et vous recontacte rapidement.
                Si elle est acceptée, vous recevrez par e-mail un lien personnel pour activer votre accès de démonstration.</p>
              <button className="btn-primary" onClick={() => window.location.replace('/')}>Retour</button>
            </>
          ) : (
            <>
              <h2>Demander une démonstration</h2>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0 }}>
                Testez gratuitement l'application dans un espace d'essai. Réponse du cabinet sous 48 h ouvrées.
              </p>
              {erreur && <div className="alert-err">{erreur}</div>}
              {champ('Nom et prénom', 'nom_complet', { req: true, ac: 'name' })}
              {champ('Entreprise', 'entreprise', { ac: 'organization' })}
              {champ('E-mail', 'email', { req: true, type: 'email', ac: 'email' })}
              {champ('Téléphone', 'telephone', { req: true, type: 'tel', ac: 'tel', ph: '6XX XX XX XX' })}
              {champ('Ville', 'ville', { ac: 'address-level2' })}
              {champ('Secteur d\'activité', 'secteur', { ph: 'Commerce, pharmacie, ONG, BTP…' })}
              {champ('Nombre de caisses / points de vente', 'nb_points_vente', { type: 'number' })}
              <label>Vos besoins</label>
              <textarea rows={3} value={f.besoins} onChange={set('besoins')} maxLength={2000}
                style={{ width: '100%', padding: 10, border: '1.5px solid var(--border)', borderRadius: 8, fontFamily: 'inherit' }} />
              {/* Champ piège anti-robots : invisible et ignoré par les humains */}
              <input type="text" name="site_web" tabIndex={-1} autoComplete="off" value={f.site_web} onChange={set('site_web')}
                style={{ position: 'absolute', left: '-5000px', width: 1, height: 1, opacity: 0 }} aria-hidden="true" />
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, textTransform: 'none', letterSpacing: 0, marginTop: 10 }}>
                <input type="checkbox" checked={consentement} onChange={(e) => setConsentement(e.target.checked)} style={{ width: 'auto', marginTop: 2 }} />
                J'accepte que le cabinet utilise ces informations pour me recontacter au sujet de cette démonstration.
              </label>
              <button className="btn-primary" onClick={envoyer} disabled={enCours}>{enCours ? 'Envoi…' : 'Envoyer ma demande'}</button>
              <p className="login-hint"><a href="/">Déjà un compte ? Se connecter</a></p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
