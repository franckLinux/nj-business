import { useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { fmt } from '@/lib/format';

// Reprend #modal-ran de legacy/js/app.js (openModalRan/saveRan, l. 1478-1638).
export default function RanModal({ journal, ranActuel, onClose, onSaved }) {
  const { mois, annee, devise } = useApp();
  const toast = useToast();

  const [montant, setMontant] = useState(ranActuel || 0);
  const [prevLoading, setPrevLoading] = useState(true);
  const [prevSolde, setPrevSolde] = useState(null);
  const [prevLabel, setPrevLabel] = useState('');
  const [erreur, setErreur] = useState('');
  const [saving, setSaving] = useState(false);

  // Indicatif seulement : le serveur détermine le type de caisse à partir du journal.
  const caisse = ['om', 'momo', 'carte_prepayee'].includes(journal?.type) ? 'om' : 'especes';

  useEffect(() => {
    let annule = false;
    api.get(`/journal/ran?mois=${mois}&annee=${annee}&journal_id=${journal.id}&caisse=${caisse}`).then((data) => {
      if (annule) return;
      setPrevLoading(false);
      if (!data.error && typeof data.solde_precedent === 'number') {
        setPrevSolde(data.solde_precedent);
        setPrevLabel(`Solde de ${data.mois_precedent} ${data.annee_precedente}`);
      }
    });
    return () => { annule = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const appliquerPrevSolde = () => {
    if (typeof prevSolde === 'number') setMontant(prevSolde);
  };

  const onSave = async () => {
    const montantNum = parseFloat(montant);
    if (isNaN(montantNum) || montantNum < 0) { setErreur('Montant invalide.'); return; }
    setSaving(true);
    const res = await api.post('/journal/ran', { mois, annee, caisse, montant: montantNum, journal_id: journal.id });
    setSaving(false);
    if (res.error) { setErreur(res.error); return; }
    toast('RAN mis à jour ✓', 'success');
    onSaved();
  };

  return (
    <div className="modal-overlay" style={{ display: 'flex' }}>
      <div className="modal-box" style={{ maxWidth: 440 }}>
        <div className="modal-head">
          <h3>📊 Report à Nouveau</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ background: '#f0fdf4', border: '1.5px solid #bbf7d0', borderRadius: 12, padding: '14px 16px', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 16 }}>🔄</span>
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .4, color: '#15803d' }}>
                Solde du mois précédent
              </span>
            </div>
            {prevLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#6b7280', fontSize: 13 }}>
                <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                Calcul en cours…
              </div>
            ) : prevSolde ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 12, color: '#166534', marginBottom: 3 }}>{prevLabel}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#15803d' }}>{fmt(prevSolde, devise)}</div>
                </div>
                <button
                  onClick={appliquerPrevSolde}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', background: '#15803d', color: 'white', border: 'none', borderRadius: 9, cursor: 'pointer', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(21,128,61,.25)' }}
                >
                  ↓ Appliquer ce solde
                </button>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: '#6b7280', fontStyle: 'italic' }}>
                Aucun mouvement sur le mois précédent (solde = 0).
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>OU SAISIR MANUELLEMENT</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>

          <div className="form-section">
            <label>Montant RAN <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>({devise})</span></label>
            <div style={{ position: 'relative' }}>
              <input
                type="number" min="0" step="500" value={montant}
                onChange={(e) => setMontant(e.target.value)}
                style={{ paddingRight: 52, fontSize: 15, fontWeight: 700, color: '#78350f', background: '#fffbeb', borderColor: '#fde68a' }}
              />
              <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', pointerEvents: 'none' }}>{devise}</span>
            </div>
          </div>

          {erreur && <div className="alert-err" style={{ marginTop: 8 }}>{erreur}</div>}
        </div>
        <div className="modal-foot" style={{ gap: 10 }}>
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary" style={{ width: 'auto', marginTop: 0 }} onClick={onSave} disabled={saving}>
            💾 Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}
