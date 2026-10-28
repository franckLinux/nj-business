import { useEffect, useState } from 'react';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';

// Suppression définitive : uniquement un client suspendu, sans aucune donnée,
// hors circuit commercial. Le serveur revérifie tout dans la transaction.
export default function SuppressionClient({ id, onAnnuler, onSupprime }) {
  const toast = useToast();
  const [b, setB] = useState(null);
  const [erreur, setErreur] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [motif, setMotif] = useState('');
  const [enCours, setEnCours] = useState(false);
  useEffect(() => {
    api.get(`/plateforme/clients/${id}/suppression`).then((r) => (r.error ? setErreur(r.error) : setB(r)));
  }, [id]);
  const pret = b?.supprimable && confirmation.trim().toLowerCase() === b.client.slug.toLowerCase() && motif.trim().length >= 5;
  const supprimer = async () => {
    setEnCours(true);
    const r = await api.post(`/plateforme/clients/${id}/suppression`, { confirmation: confirmation.trim(), motif: motif.trim() });
    setEnCours(false);
    if (r.error) { setErreur(r.error); return; }
    toast(`Client « ${b.client.nom} » supprimé définitivement.`, 'success');
    onSupprime();
  };
  return (
    <div className="modal-overlay" style={{ display: 'flex', zIndex: 1100 }} onClick={(e) => { if (e.target === e.currentTarget) onAnnuler(); }}>
      <div className="modal-box" style={{ maxWidth: 560 }} role="dialog" aria-labelledby="supp-titre">
        <div className="modal-head" style={{ background: '#fef2f2' }}>
          <h3 id="supp-titre" style={{ color: '#991b1b' }}>🗑 Supprimer définitivement {b ? `« ${b.client.nom} »` : 'le client'}</h3>
          <button className="modal-close" onClick={onAnnuler} aria-label="Fermer">✕</button>
        </div>
        <div className="modal-body">
          {erreur && <div className="alert-err" style={{ marginBottom: 10 }}>{erreur}</div>}
          {!b ? (!erreur && <div className="loading-msg">Vérification du client…</div>) : !b.supprimable ? (
            <>
              <p style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px' }}>Ce client ne peut pas être supprimé :</p>
              <ul style={{ fontSize: 13, lineHeight: 1.6, paddingLeft: 18, margin: 0 }}>
                {b.raisons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12 }}>
                La suppression est réservée aux clients ajoutés manuellement et jamais utilisés (créés par erreur, doublons, essais).
                Pour un client qui a travaillé, la suspension suffit : ses données restent conservées.
              </p>
            </>
          ) : (
            <>
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#7f1d1d', marginBottom: 14, lineHeight: 1.5 }}>
                <strong>Action irréversible.</strong> Le client, ses {b.nb_utilisateurs} utilisateur(s) et tout son paramétrage
                (rubriques, caisses, plan comptable, modules, permissions) seront effacés. Aucune donnée comptable n'est concernée :
                ce client n'en contient pas. La suppression reste tracée dans le journal d'audit.
              </div>
              <div className="form-section">
                <label htmlFor="supp-motif">Motif de la suppression</label>
                <input id="supp-motif" value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Ex. : client créé en double" maxLength={300} />
              </div>
              <div className="form-section">
                <label htmlFor="supp-slug">Pour confirmer, tapez l'identifiant <code style={{ fontWeight: 700 }}>{b.client.slug}</code></label>
                <input id="supp-slug" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" spellCheck={false}
                  onKeyDown={(e) => { if (e.key === 'Enter' && pret && !enCours) supprimer(); }} />
              </div>
            </>
          )}
        </div>
        <div className="modal-foot" style={{ gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn-secondary" onClick={onAnnuler}>{b?.supprimable ? 'Annuler' : 'Fermer'}</button>
          {b?.supprimable && (
            <button onClick={supprimer} disabled={!pret || enCours}
              style={{ background: pret ? '#dc2626' : '#fca5a5', color: 'white', border: 0, borderRadius: 8, padding: '0 16px', height: 38, fontWeight: 700, cursor: pret && !enCours ? 'pointer' : 'not-allowed' }}>
              {enCours ? 'Suppression…' : 'Supprimer définitivement'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
