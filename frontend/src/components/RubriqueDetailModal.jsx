import { useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { api } from '@/lib/api';
import { fmt } from '@/lib/format';

// Reprend showRubriqueDetail() de legacy/js/app.js (l. 2750-2867).
export default function RubriqueDetailModal({ code, intitule, dotation, realise, onClose }) {
  const { mois, annee, devise } = useApp();
  const [mouvements, setMouvements] = useState(null);

  useEffect(() => {
    let annule = false;
    api.get(`/journal?mois=${mois}&annee=${annee}&rubrique_code=${encodeURIComponent(code)}`).then((data) => {
      if (annule) return;
      setMouvements((data && data.mouvements) || []);
    });
    return () => { annule = true; };
  }, [code, mois, annee]);

  const pct = dotation > 0 ? Math.round((realise / dotation) * 100) : 0;
  const ecart = dotation - realise;
  const couleurEcart = ecart >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
  const couleurPct = pct > 90 ? 'var(--accent-red)' : pct > 70 ? '#f59e0b' : 'var(--accent-green)';
  const totalMvt = (mouvements || []).reduce((s, m) => s + (parseFloat(m.sortie || 0) || parseFloat(m.entree || 0)), 0);

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 720 }}>
        <div className="modal-head">
          <h3><span className="badge-rubrique" style={{ fontSize: 12 }}>{code}</span>&nbsp;{intitule}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 18 }}>
            <div style={{ background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: 'var(--text-muted)', marginBottom: 6 }}>Dotation</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)' }}>{fmt(dotation, devise)}</div>
            </div>
            <div style={{ background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: 'var(--text-muted)', marginBottom: 6 }}>Réalisé</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent-red)' }}>{fmt(realise, devise)}</div>
            </div>
            <div style={{ background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: 'var(--text-muted)', marginBottom: 6 }}>{ecart >= 0 ? 'Économies' : 'Dépassement'}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: couleurEcart }}>{fmt(Math.abs(ecart), devise)}</div>
            </div>
          </div>

          <div style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Taux d'exécution</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: couleurPct }}>{pct}%</span>
            </div>
            <div style={{ height: 8, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: couleurPct, borderRadius: 4 }} />
            </div>
          </div>

          <div className="form-section" style={{ marginTop: 0 }}>Mouvements — {mois} {annee}</div>

          <div style={{ marginTop: 12 }}>
            {mouvements === null ? (
              <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                <div className="spinner spinner-lg" style={{ margin: '0 auto 10px' }} />
                Chargement des mouvements…
              </div>
            ) : mouvements.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>
                Aucun mouvement enregistré pour cette rubrique ce mois-ci.
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Date</th><th>Journal</th><th>Intitulé</th><th>Bénéficiaire / Objet</th><th style={{ textAlign: 'right' }}>Montant</th></tr>
                  </thead>
                  <tbody>
                    {mouvements.map((m) => {
                      const montant = parseFloat(m.sortie || 0) || parseFloat(m.entree || 0);
                      const isSortie = parseFloat(m.sortie || 0) !== 0;
                      const dateStr = m.date ? new Date(m.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
                      return (
                        <tr key={m.id}>
                          <td style={{ whiteSpace: 'nowrap' }}>{dateStr}</td>
                          <td><span style={{ fontSize: 11, background: '#eff6ff', color: '#1d4ed8', padding: '2px 7px', borderRadius: 4, fontWeight: 600 }}>{m.journal_nom || m.journal_code || '—'}</span></td>
                          <td>
                            <span style={m.annule ? { textDecoration: 'line-through', opacity: .6 } : undefined}>{m.intitule || '—'}</span>
                            {m.annule && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#b91c1c', background: '#fee2e2', borderRadius: 4, padding: '1px 5px' }}>ANNULÉE</span>}
                            {m.annulation_de_id && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#9a3412', background: '#ffedd5', borderRadius: 4, padding: '1px 5px' }}>CONTRE-PASSATION</span>}
                          </td>
                          <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.beneficiaire || m.objet || ''}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap', color: m.annulation_de_id ? '#c2410c' : isSortie ? 'var(--accent-red)' : 'var(--accent-green)', ...(m.annule ? { textDecoration: 'line-through', opacity: .6 } : {}) }}>
                            {/* Contre-passation : restitue le montant annulé, en déduction du total dépensé. */}
                            {m.annulation_de_id ? `+ ${fmt(Math.abs(montant), devise)}` : `${isSortie ? '-' : '+'} ${fmt(montant, devise)}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
                      <td colSpan={4}>TOTAL NET ({mouvements.length} mouvement{mouvements.length > 1 ? 's' : ''})</td>
                      <td style={{ textAlign: 'right', color: 'var(--accent-red)' }}>{fmt(totalMvt, devise)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
