import { useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { api } from '@/lib/api';
import { fmt } from '@/lib/format';

// Reprend showCEEmploiDetail() de legacy/js/app.js (l. 3756-3856).
export default function CEEmploiDetailModal({ code, intitule, esp, om, total, onClose }) {
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

  const totalSorties = (mouvements || []).reduce((s, m) => s + (parseFloat(m.sortie || 0)), 0);

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 760 }}>
        <div className="modal-head">
          <h3><span className="badge-rubrique" style={{ fontSize: 12 }}>{code}</span>&nbsp;{intitule}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 20 }}>
            <div style={{ background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: 'var(--text-muted)', marginBottom: 6 }}>Espèces</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#991b1b' }}>{fmt(esp, devise)}</div>
            </div>
            <div style={{ background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: 'var(--text-muted)', marginBottom: 6 }}>Mobile Money</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#991b1b' }}>{fmt(om, devise)}</div>
            </div>
            <div style={{ background: '#fff1f2', border: '1px solid #fca5a5', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: '#991b1b', marginBottom: 6 }}>Total dépensé</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#991b1b' }}>{fmt(total, devise)}</div>
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
                    <tr><th>Date</th><th>Journal</th><th>Caisse</th><th>Intitulé</th><th>Bénéficiaire / Objet</th><th style={{ textAlign: 'right' }}>Montant</th></tr>
                  </thead>
                  <tbody>
                    {mouvements.map((m) => {
                      const sortie = parseFloat(m.sortie || 0);
                      const entree = parseFloat(m.entree || 0);
                      const montant = sortie || entree;
                      const isSortie = sortie > 0;
                      const dateStr = m.date ? new Date(m.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
                      return (
                        <tr key={m.id}>
                          <td style={{ whiteSpace: 'nowrap' }}>{dateStr}</td>
                          <td><span style={{ fontSize: 11, background: '#eff6ff', color: '#1d4ed8', padding: '2px 7px', borderRadius: 4, fontWeight: 600 }}>{m.journal_nom || m.journal_code || '—'}</span></td>
                          <td>
                            {m.type_caisse === 'especes'
                              ? <span style={{ fontSize: 10, background: '#dcfce7', color: '#166534', padding: '2px 6px', borderRadius: 3 }}>Espèces</span>
                              : <span style={{ fontSize: 10, background: '#fef3c7', color: '#92400e', padding: '2px 6px', borderRadius: 3 }}>Mobile Money</span>}
                          </td>
                          <td>{m.intitule || '—'}</td>
                          <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.beneficiaire || m.objet || ''}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600, color: isSortie ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                            {isSortie ? '-' : '+'} {fmt(montant, devise)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
                      <td colSpan={5}>TOTAL ({mouvements.length} mouvement{mouvements.length > 1 ? 's' : ''})</td>
                      <td style={{ textAlign: 'right', color: 'var(--accent-red)' }}>{fmt(totalSorties, devise)}</td>
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
