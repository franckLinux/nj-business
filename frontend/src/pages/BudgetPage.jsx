import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { fmt } from '@/lib/format';
import MouvementAttenteCard from '@/components/MouvementAttenteCard';
import BudgetLineModal from '@/components/BudgetLineModal';
import RubriqueDetailModal from '@/components/RubriqueDetailModal';

// Reprend loadBudget() de legacy/js/app.js (l. 2342-2504) : dotations par
// rubrique vs réalisé, validation mensuelle (directeur), détail par rubrique,
// section contextuelle des dépenses en attente (RG-03/04/06).
//
// Non porté : la section "Dépassements de budget" (refreshDepassementsBudget,
// l. 1941-2071, table demandes_depassement). Elle repose sur un flux
// (`saveMouvement` → `res.require_validation` → `openModalDemandeDepassement`)
// que le backend actuel n'émet plus jamais (createMouvement/updateMouvement ne
// renvoient que `en_attente`/`refus_modification`, confirmé par lecture du
// contrôleur) : POST /budget-caisse/demande n'est plus appelable depuis
// l'interface, donc cette section serait en permanence vide. Code mort côté
// backend inclus (routes/controller demandes_depassement encore présents,
// jamais atteints) — à signaler séparément, pas à reproduire ici.
const STATUT_LABEL = { valide: 'valide', rejete: 'rejete', en_attente: 'en attente' };
const STATUT_CLASS = { valide: 'statut-valide', rejete: 'statut-rejete', en_attente: 'statut-attente' };

export default function BudgetPage() {
  const { mois, annee, devise, user, can } = useApp();
  const toast = useToast();
  const [budgetData, setBudgetData] = useState(null);
  const [cumuls, setCumuls] = useState([]);
  const [erreur, setErreur] = useState('');
  const [modalLigne, setModalLigne] = useState(false);
  const [detailRubrique, setDetailRubrique] = useState(null);
  const [attente, setAttente] = useState(null);

  const canValidate = can('budget.validate');

  const charger = useCallback(async () => {
    setErreur('');
    const [bd, cm] = await Promise.all([
      api.get(`/budget?mois=${mois}&annee=${annee}`),
      api.get(`/journal/cumuls?mois=${mois}&annee=${annee}`),
    ]);
    if (bd.error) { setErreur(bd.error); return; }
    setBudgetData(bd);
    setCumuls(cm || []);
  }, [mois, annee]);

  const chargerAttente = useCallback(async () => {
    if (!canValidate) return;
    const res = await api.get(`/mouvements-attente?mois=${encodeURIComponent(mois)}&annee=${annee}&statut=en_attente`);
    setAttente((res && res.mouvements) || []);
  }, [canValidate, mois, annee]);

  useEffect(() => { setBudgetData(null); charger(); }, [charger]);
  useEffect(() => { setAttente(null); chargerAttente(); }, [chargerAttente]);

  const onApprouver = async (id) => {
    if (!window.confirm('Approuver cette dépense ? Elle sera écrite dans le journal de caisse.')) return;
    const res = await api.patch(`/mouvements-attente/${id}/approuver`, {});
    if (res.error) { toast(res.error, 'error'); return; }
    toast('Dépense approuvée et enregistrée ✓', 'success');
    chargerAttente();
    charger();
  };

  const onRejeter = async (id) => {
    const commentaire = window.prompt('Motif du rejet (optionnel) :') || '';
    const res = await api.patch(`/mouvements-attente/${id}/rejeter`, { commentaire });
    if (res.error) { toast(res.error, 'error'); return; }
    toast('Dépense rejetée.', 'warning');
    chargerAttente();
  };

  const onValider = async (statut) => {
    const commentaire = window.prompt(`Commentaire (optionnel) pour : ${statut}`) || '';
    // Clé = mois de SAISIE du budget applicable affiché (et non le mois consulté).
    const res = await api.post('/budget/validation', { mois: budgetData?.mois_saisie || mois, annee: budgetData?.annee_saisie || annee, statut, commentaire });
    if (res.error) { toast(res.error, 'error'); return; }
    toast(res.message || `Budget ${statut} ✓`, 'success');
    charger();
  };

  if (erreur) return <div className="alert-err">{erreur}</div>;
  if (!budgetData) return <div className="loading-msg">Chargement…</div>;

  const realisations = {};
  cumuls.forEach((r) => {
    realisations[r.rubrique_code] = (realisations[r.rubrique_code] || 0) + (parseFloat(r.total_sorties) || 0);
  });

  const v = budgetData.validation || { statut: 'en_attente' };
  let totalDot = 0;
  let totalReal = 0;
  const lignes = (budgetData.dotations || []).map((d) => {
    const montant = parseFloat(d.montant) || 0;
    const real = realisations[d.rubrique_code] || 0;
    const ecart = montant - real;
    const pct = montant > 0 ? Math.round((real / montant) * 100) : 0;
    totalDot += montant;
    totalReal += real;
    return { ...d, montant, real, ecart, pct };
  });
  const totalEcart = totalDot - totalReal;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>Suivi Budgétaire — {mois} {annee}</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className={`statut-badge ${STATUT_CLASS[v.statut] || ''}`}>{(STATUT_LABEL[v.statut] || v.statut).replace('_', ' ')}</span>
          {canValidate && (
            <>
              <button className="btn-add" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => setModalLigne(true)}>+ Dotation</button>
              <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => onValider('valide')}>✅ Valider</button>
              <button className="btn-ghost" style={{ fontSize: 12, color: 'var(--accent-red)' }} onClick={() => onValider('rejete')}>✕ Rejeter</button>
            </>
          )}
        </div>
      </div>

      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <div className="kpi-card">
          <div className="kpi-icon kpi-blue"><svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg></div>
          <div className="kpi-body"><p className="kpi-label">Budget Total</p><p className="kpi-value" style={{ fontSize: 16 }}>{fmt(totalDot, devise)}</p></div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon kpi-red"><svg viewBox="0 0 24 24"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6" /><polyline points="17 18 23 18 23 12" /></svg></div>
          <div className="kpi-body"><p className="kpi-label">Réalisé</p><p className="kpi-value" style={{ fontSize: 16 }}>{fmt(totalReal, devise)}</p></div>
        </div>
        <div className="kpi-card">
          <div className={`kpi-icon ${totalEcart >= 0 ? 'kpi-green' : 'kpi-red'}`}><svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg></div>
          <div className="kpi-body">
            <p className="kpi-label">{totalEcart >= 0 ? 'Économies' : 'Dépassement'}</p>
            <p className="kpi-value" style={{ fontSize: 16, color: totalEcart >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>{fmt(Math.abs(totalEcart), devise)}</p>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon kpi-purple"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg></div>
          <div className="kpi-body"><p className="kpi-label">Taux exécution</p><p className="kpi-value" style={{ fontSize: 16 }}>{totalDot > 0 ? Math.round((totalReal / totalDot) * 100) : 0}%</p></div>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Code</th><th>Intitulé</th><th style={{ textAlign: 'right' }}>Dotation</th><th style={{ textAlign: 'right' }}>Réalisé</th><th>Progression</th><th style={{ textAlign: 'right' }}>Écart</th></tr>
          </thead>
          <tbody>
            {lignes.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Aucune dotation ce mois.</td></tr>
            ) : lignes.map((d) => (
              <tr
                key={d.rubrique_code}
                style={{ cursor: 'pointer' }}
                title={`Voir les mouvements de ${d.rubrique_code}`}
                onClick={() => setDetailRubrique({ code: d.rubrique_code, intitule: d.intitule, dotation: d.montant, realise: d.real })}
              >
                <td><span className="badge-rubrique">{d.rubrique_code}</span></td>
                <td>{d.intitule} <span style={{ fontSize: 11, color: 'var(--text-light)', marginLeft: 6 }}>▶ détail</span></td>
                <td style={{ textAlign: 'right' }}>{fmt(d.montant, devise)}</td>
                <td style={{ textAlign: 'right', fontWeight: 600, color: d.real > 0 ? 'var(--accent-red)' : 'var(--text-light)' }}>{fmt(d.real, devise)}</td>
                <td style={{ textAlign: 'right' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                    <div style={{ width: 60, height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(d.pct, 100)}%`, height: '100%', background: d.pct > 90 ? 'var(--accent-red)' : d.pct > 70 ? '#f59e0b' : 'var(--accent-green)' }} />
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{d.pct}%</span>
                  </div>
                </td>
                <td style={{ textAlign: 'right', fontWeight: 600, color: d.ecart >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                  {fmt(Math.abs(d.ecart), devise)} {d.ecart < 0 ? '⚠️' : ''}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
              <td colSpan={2}>TOTAL</td>
              <td style={{ textAlign: 'right' }}>{fmt(totalDot, devise)}</td>
              <td style={{ textAlign: 'right' }}>{fmt(totalReal, devise)}</td>
              <td />
              <td style={{ textAlign: 'right', color: totalEcart >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>{fmt(Math.abs(totalEcart), devise)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {canValidate && (
        <div style={{ marginTop: 28 }}>
          <div style={{ background: 'linear-gradient(135deg,#744210,#5c340d)', borderRadius: 16, padding: '22px 26px', marginBottom: 16, boxShadow: '0 4px 24px rgba(116,66,16,.22)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'white' }}>⏳ Dépenses en attente d'autorisation</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,.6)', marginTop: 3 }}>
                  Sorties bloquées (mois non validé ou montant prévu dépassé) — {mois} {annee}
                </div>
              </div>
              <button
                onClick={chargerAttente}
                style={{ padding: '7px 14px', borderRadius: 9, fontSize: 12, cursor: 'pointer', border: '1px solid rgba(255,255,255,.2)', background: 'transparent', color: 'rgba(255,255,255,.7)' }}
              >
                ↺ Actualiser
              </button>
            </div>
          </div>
          {attente === null ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}><div style={{ fontSize: 24, marginBottom: 8 }}>⏳</div>Chargement…</div>
          ) : attente.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 32, color: '#94a3b8' }}>✅ Aucune dépense en attente pour {mois} {annee}.</div>
          ) : (
            attente.map((m) => <MouvementAttenteCard key={m.id} m={m} devise={devise} onApprouver={onApprouver} onRejeter={onRejeter} />)
          )}
        </div>
      )}

      {modalLigne && (
        <BudgetLineModal
          onClose={() => setModalLigne(false)}
          onSaved={() => { setModalLigne(false); toast('Dotation enregistrée ✓', 'success'); charger(); }}
        />
      )}
      {detailRubrique && <RubriqueDetailModal {...detailRubrique} onClose={() => setDetailRubrique(null)} />}
    </>
  );
}
