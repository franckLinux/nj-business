import { useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { fmt } from '@/lib/format';
import { usePeriodeBudget, SelecteurSemaine, semaineParDefaut } from '@/lib/budgetPeriode';

// Reprend #modal-budget-caisse de legacy/js/app.js (openModalBudgetCaisse/
// sauvegarderBudgetCaisse/supprimerBudgetCaisse, l. 1736-1806).
export default function BudgetCaisseModal({ journal, onClose, onSaved }) {
  const { mois, annee, devise, can, activeTenantId, user } = useApp();
  // Budget hebdomadaire (040) : un plafond par semaine (cumulé dans le contrôle).
  const periode = usePeriodeBudget(mois, annee, activeTenantId || user?.tenantId || '');
  const hebdo = periode.periodicite === 'hebdomadaire';
  const [semaine, setSemaine] = useState(null);
  useEffect(() => { setSemaine(hebdo ? semaineParDefaut(periode.semaines) : null); }, [hebdo, periode.semaines]);
  const qs = hebdo && semaine ? `&semaine=${semaine}` : '';
  const libelle = hebdo && semaine ? `${(periode.semaines.find((x) => x.num === semaine) || {}).libelle} — ${mois} ${annee}` : `${mois} ${annee}`;
  // C4 : consultation pour tous, modification réservée à budget.edit.
  const modifiable = can('budget.edit');
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [montant, setMontant] = useState('');
  const [existant, setExistant] = useState(false);
  const [erreur, setErreur] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let annule = false;
    if (periode.chargement || (hebdo && !semaine)) return undefined;
    setLoading(true); setMontant(''); setExistant(false);
    api.get(`/budget-caisse?journal_id=${journal.id}&mois=${mois}&annee=${annee}${qs}`).then((data) => {
      if (annule) return;
      setLoading(false);
      if (data && !data.error) {
        const m = parseFloat(data.montant) || 0;
        if (m > 0) { setMontant(m); setExistant(true); }
      }
    });
    return () => { annule = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periode.chargement, hebdo, semaine]);

  const onSave = async () => {
    const montantNum = parseFloat(montant) || 0;
    setSaving(true);
    const res = await api.put('/budget-caisse', { journal_id: journal.id, mois, annee, montant: montantNum, ...(hebdo ? { semaine } : {}) });
    setSaving(false);
    if (res.error) { setErreur(res.error); return; }
    toast(`Budget ${fmt(montantNum, devise)} enregistré pour ${libelle} ✓`, 'success');
    onSaved();
  };

  const onDelete = async () => {
    if (!window.confirm('Supprimer le budget de ce journal pour ce mois ?')) return;
    setSaving(true);
    await api.delete(`/budget-caisse?journal_id=${journal.id}&mois=${mois}&annee=${annee}${qs}`);
    setSaving(false);
    toast('Budget supprimé.', 'success');
    onSaved();
  };

  return (
    <div className="modal-overlay" style={{ display: 'flex' }}>
      <div className="modal-box" style={{ maxWidth: 420 }}>
        <div className="modal-head">
          <h3>💰 Budget de dépenses</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ background: '#f5f3ff', borderRadius: 10, padding: '12px 16px', marginBottom: 18, fontSize: 13, color: '#5b21b6' }}>
            <strong>{journal.nom}</strong> · {libelle}
          </div>
          {hebdo && (
            <div style={{ marginBottom: 14 }}>
              <SelecteurSemaine semaines={periode.semaines} valeur={semaine} onChange={setSemaine} />
            </div>
          )}
          {loading ? (
            <div className="loading-msg">Chargement…</div>
          ) : (
            <>
              <div className="form-section">
                <label>Montant du budget {hebdo ? 'de la semaine' : 'mensuel'} <span style={{ color: '#94a3b8', fontSize: 11 }}>(optionnel)</span></label>
                <input
                  type="number" min="0" step="1000" placeholder="Ex : 500000"
                  value={montant} onChange={(e) => setMontant(e.target.value)}
                  readOnly={!modifiable} disabled={!modifiable}
                />
                {!modifiable && (
                  <small style={{ color: '#92400e', fontSize: 11, marginTop: 4, display: 'block' }}>
                    Consultation seule : seul le directeur (droit « Modifier le budget ») fixe le plafond.
                  </small>
                )}
                <small style={{ color: '#94a3b8', fontSize: 11, marginTop: 4, display: 'block' }}>
                  Si défini, toute sortie dépassant ce montant nécessitera la validation du directeur.
                </small>
              </div>
              {existant && modifiable && (
                <div style={{ marginTop: 10 }}>
                  <button
                    onClick={onDelete}
                    style={{ background: 'none', border: 'none', color: '#dc2626', fontSize: 12, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                  >
                    Supprimer le budget
                  </button>
                </div>
              )}
            </>
          )}
          {erreur && <div className="alert-err" style={{ marginTop: 8 }}>{erreur}</div>}
        </div>
        <div className="modal-foot" style={{ gap: 10 }}>
          <button className="btn-secondary" onClick={onClose}>{modifiable ? 'Annuler' : 'Fermer'}</button>
          {modifiable && <button
            onClick={onSave} disabled={saving || loading}
            style={{ padding: '10px 22px', background: 'linear-gradient(135deg,#7c3aed,#5b21b6)', color: 'white', border: 'none', borderRadius: 9, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}
          >
            💾 Enregistrer
          </button>}
        </div>
      </div>
    </div>
  );
}
