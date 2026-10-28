import { useState } from 'react';
import { api } from '@/lib/api';

// Page publique « Demander une démonstration ».
// La demande arrive dans « Prospects & démos » (à traiter) ; c'est le cabinet
// qui décide d'envoyer l'accès. Aucun compte n'est créé ici.
// Exception : un commercial autorisé (permission « prospects.validation_directe »)
// peut valider la demande sur place avec son identifiant + son code personnel.
// Tout est vérifié côté serveur (code haché, blocage, audit) — rien n'est décidé ici.
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
  // Validation directe par un commercial du cabinet
  const [commercialOuvert, setCommercialOuvert] = useState(false);
  const [etape, setEtape] = useState(null); // null | 'confirmer' | 'code'
  const [identifiant, setIdentifiant] = useState('');
  const [code, setCode] = useState('');
  const [erreurCode, setErreurCode] = useState('');
  const [valide, setValide] = useState(null); // réponse du serveur après validation directe
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const controler = () => {
    if (!f.nom_complet.trim()) return 'Indiquez votre nom.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) return 'Adresse e-mail invalide.';
    if (!f.telephone.trim()) return 'Indiquez un numéro de téléphone.';
    if (!consentement) return 'Merci d\'accepter d\'être recontacté(e).';
    return '';
  };

  const ouvrirValidation = () => {
    const e = controler();
    setErreur(e);
    if (e) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    setErreurCode(''); setCode(''); setEtape('confirmer');
  };

  const fermerValidation = () => { if (!enCours) { setEtape(null); setCode(''); setErreurCode(''); } };

  const validerDirectement = async () => {
    setErreurCode('');
    if (!identifiant.trim()) { setErreurCode('Indiquez votre identifiant.'); return; }
    if (!code) { setErreurCode('Saisissez votre code de validation.'); return; }
    setEnCours(true);
    const r = await api.post('/demande-demo/validation-directe', {
      ...f, email: f.email.trim(), consentement: true,
      identifiant: identifiant.trim(), validationCode: code,
    });
    setEnCours(false);
    setCode(''); // le code ne reste jamais en mémoire après l'envoi
    if (r.error) { setErreurCode(r.error); return; }
    setEtape(null);
    setValide(r);
  };

  const envoyer = async () => {
    const e = controler();
    setErreur(e);
    if (e) return;
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
          {valide ? (
            <>
              <h2>✓ Prospect validé avec succès</h2>
              <p style={{ fontSize: 14 }}>
                La demande de <strong>{f.entreprise || f.nom_complet}</strong> est acceptée et attribuée à
                {' '}<strong>{valide.commercial || identifiant}</strong>. L'espace de démonstration est ouvert.
              </p>
              {['envoye', 'renvoye'].includes(valide.statut_email) ? (
                <p style={{ fontSize: 14 }}>Le lien d'activation a été envoyé à <strong>{valide.email || f.email}</strong>.</p>
              ) : valide.lien ? (
                <>
                  <p style={{ fontSize: 14 }}>L'e-mail n'a pas pu partir. Transmettez ce lien d'activation au prospect :</p>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input readOnly value={valide.lien} onFocus={(e) => e.target.select()} style={{ flex: 1, minWidth: 0 }} />
                    <button type="button" className="btn-ghost" onClick={() => navigator.clipboard?.writeText(valide.lien)}>Copier</button>
                  </div>
                </>
              ) : (
                <p style={{ fontSize: 14 }}>Le prospect recevra son lien d'activation par e-mail.</p>
              )}
              {valide.code_expire_le && (new Date(valide.code_expire_le) - Date.now()) / 864e5 <= 7 && (
                <p style={{ fontSize: 13, color: '#9a3412', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '8px 12px' }}>
                  🔁 Votre code expire le <b>{new Date(valide.code_expire_le).toLocaleDateString('fr-FR')}</b> : demandez le nouveau code au Super Admin.
                </p>
              )}
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Cette validation est enregistrée dans le journal d'audit.</p>
              <button className="btn-primary" onClick={() => window.location.replace('/')}>Terminer</button>
            </>
          ) : envoye ? (
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

              <div style={{ borderTop: '1px solid var(--border)', marginTop: 18, paddingTop: 12 }}>
                <button type="button" onClick={() => setCommercialOuvert((o) => !o)} aria-expanded={commercialOuvert}
                  style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)', fontFamily: 'inherit' }}>
                  {commercialOuvert ? '▾' : '▸'} Vous êtes commercial du cabinet ?
                </button>
                {commercialOuvert && (
                  <div style={{ marginTop: 10 }}>
                    <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 10px' }}>
                      Si vous êtes autorisé(e), vous pouvez valider cette demande tout de suite avec votre code personnel :
                      la démonstration est ouverte immédiatement et le prospect vous est attribué.
                    </p>
                    <button type="button" className="btn-ghost" onClick={ouvrirValidation} disabled={enCours} style={{ width: '100%' }}>
                      Valider directement
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {etape === 'confirmer' && (
        <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) fermerValidation(); }}>
          <div className="modal-box" style={{ maxWidth: 440 }} role="dialog" aria-modal="true">
            <div className="modal-head"><h3>Validation directe</h3><button className="modal-close" onClick={fermerValidation}>✕</button></div>
            <div className="modal-body">
              <p style={{ fontSize: 14, margin: 0 }}>
                Vous êtes sur le point de valider directement ce prospect
                {(f.entreprise || f.nom_complet) && <> (<strong>{f.entreprise || f.nom_complet}</strong>)</>}.
                Cette action sera enregistrée dans le journal d'audit. Continuer ?
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn-ghost" onClick={fermerValidation}>Annuler</button>
              <button className="btn-primary" onClick={() => setEtape('code')}>Continuer</button>
            </div>
          </div>
        </div>
      )}

      {etape === 'code' && (
        <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) fermerValidation(); }}>
          <form className="modal-box" style={{ maxWidth: 440 }} role="dialog" aria-modal="true" autoComplete="off"
            onSubmit={(e) => { e.preventDefault(); validerDirectement(); }}>
            <div className="modal-head"><h3>Code de validation</h3><button type="button" className="modal-close" onClick={fermerValidation}>✕</button></div>
            <div className="modal-body">
              {erreurCode && <div className="alert-err" style={{ marginTop: 0 }}>{erreurCode}</div>}
              <label>Votre identifiant <span className="req">*</span></label>
              <input value={identifiant} onChange={(e) => setIdentifiant(e.target.value)} autoComplete="username"
                placeholder="Nom d'utilisateur ou e-mail" autoFocus={!identifiant} />
              <label>Code de validation <span className="req">*</span></label>
              <input type="password" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code"
                inputMode="text" maxLength={12} autoFocus={!!identifiant} />
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0' }}>
                Code personnel remis par la direction. Après 5 erreurs, il est bloqué 15 minutes.
              </p>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn-ghost" onClick={fermerValidation} disabled={enCours}>Annuler</button>
              <button type="submit" className="btn-primary" disabled={enCours}>{enCours ? 'Validation…' : 'Valider'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
