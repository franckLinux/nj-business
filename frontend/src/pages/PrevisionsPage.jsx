import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { MOIS, fmt } from '@/lib/format';
import { usePeriodeBudget, SelecteurSemaine, semaineParDefaut } from '@/lib/budgetPeriode';

// Reprend loadPrevisions()/savePrevisions() de legacy/js/app.js (l. 2886-3068).
//
// Écart volontaire : le legacy définit un `MOIS_LISTE` local avec accents
// ('Février','Août','Décembre', l. 2875-2876) DIFFÉRENT du `MOIS` global sans
// accents utilisé partout ailleurs (journal, budget, dashboard…). Comme cette
// page envoie `mois`/`mois_applic` tel quel au backend, une prévision saisie
// pour l'un de ces 3 mois serait stockée sous une graphie que le reste de
// l'app ne recherche jamais (`WHERE mois=$2` est une comparaison stricte) —
// silencieusement invisible partout ailleurs. Bug repéré en portant cette
// page ; on utilise ici le même `MOIS` que le reste de l'app plutôt que de
// reproduire l'incohérence.
const moisSuivant = (mois, annee) => {
  const idx = MOIS.indexOf(mois);
  if (idx === -1) return { mois, annee };
  return idx === 11 ? { mois: MOIS[0], annee: annee + 1 } : { mois: MOIS[idx + 1], annee };
};

export default function PrevisionsPage() {
  const { mois, annee, rubriques, devise, can, activeTenantId, user } = useApp();
  // C1 : saisie ouverte à qui prépare les prévisions (previsions.edit) ou gère le budget.
  const peutSaisir = can('previsions.edit') || can('budget.edit');
  const toast = useToast();
  const depenses = rubriques.depenses || [];

  const def = useMemo(() => moisSuivant(mois, annee), [mois, annee]);
  const [moisCible, setMoisCible] = useState(def.mois);
  const [anneeCible, setAnneeCible] = useState(def.annee);
  const [existing, setExisting] = useState(null); // { code: { id, montant } } | null pendant chargement
  const [montants, setMontants] = useState({}); // code -> valeur saisie (string)
  const [erreur, setErreur] = useState('');
  const [saving, setSaving] = useState(false);
  // Budget hebdomadaire (040) : la saisie se fait semaine par semaine.
  const periode = usePeriodeBudget(moisCible, anneeCible, activeTenantId || user?.tenantId || '');
  const hebdo = periode.periodicite === 'hebdomadaire';
  const [semaine, setSemaine] = useState(null);
  const [statuts, setStatuts] = useState({});      // num → statut de validation
  const [validation, setValidation] = useState(null);
  useEffect(() => {
    if (!hebdo) { setSemaine(null); return; }
    // Par défaut : la semaine qui suit celle d'aujourd'hui (on prévoit à l'avance).
    const dans7 = new Date(Date.now() + 7 * 864e5);
    const iso = `${dans7.getFullYear()}-${String(dans7.getMonth() + 1).padStart(2, '0')}-${String(dans7.getDate()).padStart(2, '0')}`;
    setSemaine(semaineParDefaut(periode.semaines, iso));
  }, [hebdo, periode.semaines]);
  const semaineInfo = hebdo ? periode.semaines.find((x) => x.num === semaine) : null;
  const libellePeriode = semaineInfo ? `${semaineInfo.libelle} — ${moisCible} ${anneeCible}` : `${moisCible} ${anneeCible}`;

  const charger = useCallback(async () => {
    setErreur('');
    setExisting(null);
    if (periode.chargement || (hebdo && !semaine)) return;
    const [data, vue] = await Promise.all([
      api.get(`/budget?mois=${moisCible}&annee=${anneeCible}${hebdo ? `&semaine=${semaine}` : ''}`),
      hebdo ? api.get(`/budget?mois=${moisCible}&annee=${anneeCible}`) : Promise.resolve(null),
    ]);
    if (!data || data.error) { setErreur((data && data.error) || 'Erreur de chargement.'); return; }
    const ex = {};
    (data.dotations || []).forEach((d) => { ex[d.rubrique_code] = d; });
    setExisting(ex);
    setValidation(data.validation || null);
    setStatuts(vue && !vue.error ? Object.fromEntries((vue.semaines || []).map((x) => [x.num, x.statut])) : {});
    const init = {};
    Object.entries(ex).forEach(([code, d]) => { init[code] = String(parseFloat(d.montant) || ''); });
    setMontants(init);
  }, [moisCible, anneeCible, hebdo, semaine, periode.chargement]);

  useEffect(() => { charger(); }, [charger]);

  // « Reprendre la semaine précédente » : pré-remplit (sans enregistrer).
  const reprendrePrecedente = async () => {
    let m = moisCible; let a = anneeCible; let k = semaine - 1;
    if (k < 1) {
      const idx = MOIS.indexOf(moisCible);
      m = idx === 0 ? MOIS[11] : MOIS[idx - 1];
      a = idx === 0 ? anneeCible - 1 : anneeCible;
      const p = await api.get(`/budget/periode?mois=${m}&annee=${a}`);
      if (!p || p.error || p.periodicite !== 'hebdomadaire') { toast('La semaine précédente n\'est pas une semaine hebdomadaire budgétée.', 'error'); return; }
      k = p.semaines.length;
    }
    const prev = await api.get(`/budget?mois=${m}&annee=${a}&semaine=${k}`);
    if (!prev || prev.error) { toast(prev?.error || 'Chargement impossible.', 'error'); return; }
    if (!(prev.dotations || []).length) { toast('Aucune prévision la semaine précédente.', 'error'); return; }
    const init = {};
    prev.dotations.forEach((d) => { init[d.rubrique_code] = String(parseFloat(d.montant) || ''); });
    setMontants(init);
    toast(`Montants repris de la semaine ${k} (${m}) : vérifiez puis enregistrez.`, 'success', 5000);
  };

  const onSave = async () => {
    if (!existing) return;
    setSaving(true);
    const upserts = [];
    const deletes = [];
    depenses.forEach((r) => {
      const montant = parseFloat(montants[r.code]) || 0;
      const ex = existing[r.code];
      if (montant > 0) {
        upserts.push(api.put('/budget', {
          mois: moisCible, annee: anneeCible, rubrique_code: r.code, intitule: r.intitule, montant,
          mois_applic: moisCible, annee_applic: anneeCible, ...(hebdo ? { semaine } : {}),
        }));
      } else if (ex) {
        deletes.push(api.delete(`/budget/${ex.id}`));
      }
    });
    const results = await Promise.all([...upserts, ...deletes]);
    setSaving(false);
    const echec = results.find((r) => r && r.error);
    if (echec) {
      // Ex. demande de fonds déjà validée pour ce mois : le message du serveur l'explique.
      toast(`Certaines lignes n'ont pas pu être sauvegardées : ${echec.error}`, 'error', 7000);
    } else {
      toast(`Budget de ${libellePeriode} enregistré — ${upserts.length} rubrique${upserts.length > 1 ? 's' : ''} ✓`, 'success');
    }
    charger();
  };

  if (erreur) return <div className="alert-err">{erreur}</div>;
  if (!existing) return <div className="loading-msg">Chargement…</div>;
  const figee = validation?.statut === 'valide';

  const anneeMin = (annee || new Date().getFullYear()) - 1;
  const anneesOptions = Array.from({ length: 6 }, (_, i) => anneeMin + i);
  const nbSaisis = Object.keys(existing).length;
  const total = depenses.reduce((s, r) => s + (parseFloat(montants[r.code]) || 0), 0);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>Prévisions de Fonds</h2>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{depenses.length} rubrique(s) de dépenses</span>
      </div>

      <div className="prev-period-bar">
        <svg style={{ width: 18, height: 18, stroke: 'var(--accent)', fill: 'none', strokeWidth: 2, strokeLinecap: 'round', flexShrink: 0 }} viewBox="0 0 24 24">
          <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        <label>Budget du mois de</label>
        <select value={moisCible} onChange={(e) => setMoisCible(e.target.value)}>
          {MOIS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={anneeCible} onChange={(e) => setAnneeCible(parseInt(e.target.value, 10))}>
          {anneesOptions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <div style={{ height: 24, width: 1, background: 'var(--border)', margin: '0 4px' }} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {nbSaisis > 0
            ? <><span style={{ color: 'var(--accent-green)', fontWeight: 700 }}>{nbSaisis}</span> rubrique(s) budgétées</>
            : 'Aucune saisie pour ce mois'}
        </span>
      </div>

      {hebdo && (
        <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px', marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: 'var(--text-muted)' }}>
              Budget hebdomadaire — semaine
            </span>
            {peutSaisir && !figee && (
              <button type="button" className="btn-ghost" style={{ fontSize: 12 }} onClick={reprendrePrecedente}>↺ Reprendre la semaine précédente</button>
            )}
          </div>
          <SelecteurSemaine semaines={periode.semaines} valeur={semaine} onChange={setSemaine} statuts={statuts} />
          {figee && (
            <div style={{ marginTop: 10, fontSize: 12, color: '#166534', fontWeight: 600 }}>
              ✓ Semaine validée par le directeur : prévisions figées (le directeur peut la remettre en attente).
            </div>
          )}
        </div>
      )}

      <div className="prev-info-banner">
        <svg style={{ width: 18, height: 18, stroke: '#3b82f6', fill: 'none', strokeWidth: 2, strokeLinecap: 'round', flexShrink: 0, marginTop: 1 }} viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span>
          Saisissez les montants prévisionnels pour <b>{libellePeriode}</b>.
          Laissez <b>0</b> pour les rubriques non budgétées. Ces données alimenteront automatiquement
          la section <b>Prévision des dépenses</b> dans la Demande de Fonds.
        </span>
      </div>

      <div className="prev-card">
        <div className="prev-card-head">
          <span className="prev-card-title">Saisie budgétaire — {libellePeriode}</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Cliquez sur un montant pour le modifier</span>
        </div>
        <div className="prev-col-head">
          <span>Code</span><span>Rubrique</span><span style={{ textAlign: 'right', paddingRight: 4 }}>Montant prévisionnel</span>
        </div>
        <div>
          {depenses.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: 13 }}>
              Aucune rubrique de dépenses configurée.<br /><small>Ajoutez des rubriques dans <b>Configuration</b>.</small>
            </div>
          ) : depenses.map((r) => {
            const val = montants[r.code] || '';
            return (
              <div key={r.code} className="prev-row">
                <span className="badge-rubrique">{r.code}</span>
                <span className="prev-row-name" title={r.intitule}>{r.intitule}</span>
                <div className="prev-amount-wrap">
                  <input
                    type="number" min="0" step="1000" placeholder="0"
                    value={val}
                    className={'prev-amount-input' + (parseFloat(val) > 0 ? ' has-value' : '')}
                    onChange={(e) => setMontants((m) => ({ ...m, [r.code]: e.target.value }))}
                    readOnly={!peutSaisir || figee}
                    onFocus={(e) => e.target.select()}
                  />
                  <span className="suffix">{devise}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="prev-total-row">
          <span />
          <span style={{ fontWeight: 700, color: 'var(--text)' }}>TOTAL PRÉVISIONNEL</span>
          <span>{fmt(total, devise)}</span>
        </div>
      </div>

      {peutSaisir && !figee && <div className="prev-save-bar">
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Prêt à enregistrer le budget prévisionnel</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Les rubriques à 0 seront retirées du budget de <b>{libellePeriode}</b>
          </div>
        </div>
        <button className="btn-save-prev" onClick={onSave} disabled={saving}>
          <svg style={{ width: 16, height: 16, stroke: 'white', fill: 'none', strokeWidth: 2.5, strokeLinecap: 'round' }} viewBox="0 0 24 24">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
          </svg>
          Enregistrer le budget — {semaineInfo ? `S${semaine} ${moisCible}` : `${moisCible} ${anneeCible}`}
        </button>
      </div>}
    </>
  );
}
