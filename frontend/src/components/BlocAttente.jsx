import { useState } from 'react';
import { fmt } from '@/lib/format';

// Reprend buildBlocSelect() de legacy/js/app.js (l. 3074-3144) — formulaire
// d'ajout + tableau, réutilisé pour "Ressources Additionnelles Attendues" et
// "Dépenses en Attente" dans la Demande de Fonds.
export default function BlocAttente({ num, titre, couleur, type, rows, isCaissiere, rubriquesListe, devise, mois, annee, onAdd, onDelete }) {
  const [rubrique, setRubrique] = useState('');
  const [intitule, setIntitule] = useState('');
  const [montant, setMontant] = useState('');

  const total = (rows || []).reduce((s, r) => s + (parseFloat(r.montant) || 0), 0);

  const onRubriqueChange = (code) => {
    setRubrique(code);
    const r = rubriquesListe.find((x) => x.code === code);
    setIntitule(r?.intitule || '');
  };

  const onAjouter = async () => {
    await onAdd(type, rubrique, intitule, montant);
    setRubrique('');
    setIntitule('');
    setMontant('');
  };

  return (
    <div style={{ marginBottom: 22 }}>
      <b style={{ color: couleur, display: 'block', marginBottom: 8, fontSize: 13 }}>{num}. {titre}</b>

      {isCaissiere && (rubriquesListe.length > 0 ? (
        <div className="bloc-form" style={{ display: 'grid', gridTemplateColumns: '220px 1fr 150px auto', gap: 10, alignItems: 'flex-end', marginBottom: 14, background: '#f8fafc', padding: '14px 16px', borderRadius: 10, border: '1px solid var(--border)' }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Rubrique</label>
            <select value={rubrique} onChange={(e) => onRubriqueChange(e.target.value)}>
              <option value="">— choisir —</option>
              {rubriquesListe.map((r) => <option key={r.code} value={r.code}>[{r.code}] {r.intitule}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Intitulé</label>
            <input type="text" placeholder="Désignation (modifiable)" value={intitule} onChange={(e) => setIntitule(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Montant ({devise || 'FCFA'})</label>
            <input type="number" min="0" step="1000" placeholder="0" value={montant} onChange={(e) => setMontant(e.target.value)} style={{ textAlign: 'right' }} />
          </div>
          <button className="btn-add" style={{ padding: '10px 18px', whiteSpace: 'nowrap', alignSelf: 'flex-end' }} onClick={onAjouter}>＋ Ajouter</button>
        </div>
      ) : (
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 10 }}>
          Aucune rubrique configurée — ajoutez-en dans <b>Configuration</b>.
        </div>
      ))}

      {rows && rows.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Rubrique</th><th>Intitulé</th><th style={{ textAlign: 'right' }}>Montant</th>{isCaissiere && <th style={{ textAlign: 'center', width: 48 }} />}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><span className="badge-rubrique">{r.rubrique_code}</span></td>
                  <td>{r.intitule}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, color: couleur }}>{fmt(r.montant, devise)}</td>
                  {isCaissiere && (
                    <td style={{ textAlign: 'center' }}>
                      <button className="btn-icon danger" title="Supprimer" onClick={() => onDelete(type, r.id)}>🗑</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
                <td colSpan={2}>TOTAL</td>
                <td style={{ textAlign: 'right', color: couleur }}>{fmt(total, devise)}</td>
                {isCaissiere && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '10px 0', textAlign: 'center' }}>
          Aucune ligne ajoutée pour {mois} {annee}.
        </div>
      )}
    </div>
  );
}
