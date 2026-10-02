import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { api } from '@/lib/api';

// Reprend openModalBudgetLine() / saveBudgetLine() de legacy/js/app.js (l. 2717-2747).
export default function BudgetLineModal({ onClose, onSaved }) {
  const { mois, annee, rubriques } = useApp();
  const depenses = rubriques.depenses || [];
  const [rubrique, setRubrique] = useState(depenses[0]?.code || '');
  const [montant, setMontant] = useState('');
  const [erreur, setErreur] = useState('');
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    const montantNum = parseFloat(montant) || 0;
    if (!rubrique || montantNum <= 0) { setErreur('Données invalides.'); return; }
    const r = depenses.find((x) => x.code === rubrique);
    setSaving(true);
    const res = await api.put('/budget', {
      mois, annee, rubrique_code: rubrique, intitule: r?.intitule || rubrique, montant: montantNum,
    });
    setSaving(false);
    if (res.error) { setErreur(res.error); return; }
    onSaved();
  };

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 440 }}>
        <div className="modal-head">
          <h3>+ Nouvelle dotation</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <label>Rubrique *</label>
          <select value={rubrique} onChange={(e) => setRubrique(e.target.value)}>
            {depenses.map((r) => (
              <option key={r.code} value={r.code}>[{r.code}] {r.intitule}</option>
            ))}
          </select>
          <label>Montant *</label>
          <input type="number" min="0" placeholder="0" value={montant} onChange={(e) => setMontant(e.target.value)} />
          {erreur && <div className="alert-err" style={{ marginTop: 10 }}>{erreur}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn-primary" style={{ width: 'auto', marginTop: 0 }} onClick={onSave} disabled={saving}>💾 Enregistrer</button>
        </div>
      </div>
    </div>
  );
}
