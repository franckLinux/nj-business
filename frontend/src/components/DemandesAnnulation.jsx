import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { fmt } from '@/lib/format';

// Demandes d'annulation d'écritures (caissière → directeur).
// Autoriser = la contre-passation (écriture négative) est passée ;
// refuser = l'écriture reste en l'état (motif obligatoire).
export default function DemandesAnnulation() {
  const { devise } = useApp();
  const toast = useToast();
  const [liste, setListe] = useState(null);

  const charger = useCallback(async () => {
    const r = await api.get('/journal/annulations?statut=en_attente');
    setListe(Array.isArray(r) ? r : []);
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const decider = async (d, decision) => {
    let commentaire = '';
    if (decision === 'refuser') {
      commentaire = window.prompt(`Refuser l'annulation de l'écriture n°${d.numero} ?\nMotif du refus :`) || '';
      if (!commentaire.trim()) return;
    } else if (!window.confirm(`Autoriser l'annulation de l'écriture n°${d.numero} « ${d.intitule} » ?\nUne contre-passation (montant négatif) sera enregistrée.`)) return;
    const r = await api.patch(`/journal/annulations/${d.id}`, { decision, commentaire });
    if (r.error) { toast(r.error, 'error'); return; }
    toast(r.message, decision === 'approuver' ? 'success' : 'warning');
    charger();
  };

  if (!liste || liste.length === 0) return null;
  return (
    <div style={{ background: 'white', border: '1px solid #fecaca', borderRadius: 14, padding: 16, marginBottom: 18 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: '#991b1b', marginBottom: 10 }}>
        ↩ Demandes d'annulation d'écritures ({liste.length})
      </div>
      <div className="table-wrap" style={{ margin: 0 }}>
        <table>
          <thead><tr><th>N°</th><th>Caisse</th><th>Date</th><th>Écriture</th><th style={{ textAlign: 'right' }}>Montant</th><th>Motif</th><th>Demandé par</th><th /></tr></thead>
          <tbody>
            {liste.map((d) => {
              const e = parseFloat(d.entree) || 0;
              const s = parseFloat(d.sortie) || 0;
              return (
                <tr key={d.id}>
                  <td style={{ fontWeight: 700 }}>{d.numero}</td>
                  <td style={{ fontSize: 12 }}>{d.journal_code || d.journal_nom || '—'}</td>
                  <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{new Date(d.date).toLocaleDateString('fr-FR')}</td>
                  <td style={{ fontSize: 13 }}>{d.intitule}<div style={{ fontSize: 11, color: '#94a3b8' }}>{d.rubrique_code} · {d.mois} {d.annee}</div></td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: e ? '#16a34a' : '#dc2626' }}>{e ? `+${fmt(e, devise)}` : `−${fmt(s, devise)}`}</td>
                  <td style={{ fontSize: 12 }}>{d.motif}</td>
                  <td style={{ fontSize: 12 }}>{d.demandeur}<div style={{ color: '#94a3b8' }}>{new Date(d.demande_le).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn-secondary" style={{ color: '#15803d', marginRight: 4 }} onClick={() => decider(d, 'approuver')}>✓ Autoriser</button>
                    <button className="btn-secondary" style={{ color: '#b91c1c' }} onClick={() => decider(d, 'refuser')}>Refuser</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
