// NJ COMPTABILITÉ — États comptables : Balance et Grand livre (075, 076).
// Écritures VALIDÉES par défaut ; le brouillard peut être inclus pour une lecture provisoire.
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/context/AppContext';
import { exporterExcel } from '@/lib/export';
import { Erreur, SansExercice, fmtCompta, fmtDate, useExercices } from './commun';

const CLASSES = [
  ['', 'Toutes les classes'], ['1', '1 — Capitaux'], ['2', '2 — Immobilisations'], ['3', '3 — Stocks'], ['4', '4 — Tiers'],
  ['5', '5 — Trésorerie'], ['6', '6 — Charges'], ['7', '7 — Produits'], ['8', '8 — Autres charges et produits'],
];

function useEtat(url, exercices, courant) {
  const [exerciceId, setExerciceId] = useState('');
  const [f, setF] = useState({ date_du: '', date_au: '', classe: '', compte_du: '', compte_au: '', brouillard: false });
  const [donnees, setDonnees] = useState(null);
  const [erreur, setErreur] = useState('');
  const [chargement, setChargement] = useState(false);
  useEffect(() => { if (!exerciceId && courant) setExerciceId(String(courant.id)); }, [courant, exerciceId]);
  const charger = useCallback(async () => {
    if (!exerciceId) return;
    const q = new URLSearchParams({ exercice_id: exerciceId });
    for (const [k, v] of Object.entries(f)) if (v) q.set(k, String(v));
    setChargement(true);
    const r = await api.get(`${url}?${q}`);
    setChargement(false);
    if (r?.error) { setErreur(r.error); setDonnees(null); return; }
    setErreur(''); setDonnees(r);
  }, [url, exerciceId, f]);
  useEffect(() => { charger(); }, [charger]);
  return { exerciceId, setExerciceId, f, setF, donnees, erreur, chargement };
}

function Filtres({ exercices, exerciceId, setExerciceId, f, setF, avecComptes }) {
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  return (
    <div className="fin-filtres">
      <select aria-label="Exercice" value={exerciceId} onChange={(e) => setExerciceId(e.target.value)}>
        {exercices.map((x) => <option key={x.id} value={x.id}>Exercice {x.code}</option>)}
      </select>
      <input type="date" aria-label="Du" value={f.date_du} onChange={set('date_du')} />
      <input type="date" aria-label="Au" value={f.date_au} onChange={set('date_au')} />
      <select aria-label="Classe" value={f.classe} onChange={set('classe')}>{CLASSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      {avecComptes && <>
        <input aria-label="Du compte" placeholder="Du compte" value={f.compte_du} onChange={set('compte_du')} className="fin-court" />
        <input aria-label="Au compte" placeholder="Au compte" value={f.compte_au} onChange={set('compte_au')} className="fin-court" />
      </>}
      <label className="fin-case"><input type="checkbox" checked={f.brouillard} onChange={set('brouillard')} /> Inclure le brouillard</label>
    </div>
  );
}

function BandeauPeriode({ d }) {
  return (
    <div className={'fin-bandeau' + (d.inclut_brouillard ? '' : ' fin-bandeau-gris')}>
      Du <b>{fmtDate(d.date_du)}</b> au <b>{fmtDate(d.date_au)}</b> ·{' '}
      {d.inclut_brouillard ? <b>Lecture provisoire : brouillard inclus.</b> : 'Écritures validées uniquement.'}
      {!d.inclut_brouillard && d.nb_brouillard_exercice > 0 && <> {d.nb_brouillard_exercice} écriture(s) au brouillard non prises en compte.</>}
    </div>
  );
}

export function BalancePage() {
  const { can } = useApp();
  const { exercices, courant, erreur: errEx } = useExercices();
  const e = useEtat('/comptabilite/balance', exercices, courant);
  if (errEx) return <div className="cm-page"><Erreur message={errEx} /></div>;
  if (!exercices) return <div className="loading-msg">Chargement…</div>;
  if (!exercices.length) return <div className="cm-page"><SansExercice peutParametrer={can('compta.parametrage')} /></div>;
  const d = e.donnees;
  const exporter = () => exporterExcel(`Balance_${d.exercice.code}`,
    ['Compte', 'Intitulé', 'Report débit', 'Report crédit', 'Débit', 'Crédit', 'Solde débiteur', 'Solde créditeur'],
    d.comptes.map((c) => [c.compte, c.intitule, +c.report_debit, +c.report_credit, +c.debit, +c.credit, +c.solde_debiteur, +c.solde_crediteur]),
    [`Balance générale — exercice ${d.exercice.code}`, `Du ${fmtDate(d.date_du)} au ${fmtDate(d.date_au)}${d.inclut_brouillard ? ' (brouillard inclus)' : ''}`]);
  return (
    <div className="cm-page fin-page">
      <div className="cm-entete">
        <div>
          <h2>Balance générale</h2>
          <p>Totaux et soldes de chaque compte mouvementé. La balance n'est pas le bilan : elle en est la source, une fois l'exercice complet et validé.</p>
        </div>
        <div className="cm-actions"><button type="button" className="cm-btn cm-secondaire" disabled={!d?.comptes?.length} onClick={exporter}>Exporter</button></div>
      </div>
      <Filtres exercices={exercices} {...e} avecComptes />
      <Erreur message={e.erreur} />
      {d && <>
        <BandeauPeriode d={d} />
        {d.comptes.length === 0 ? (
          <div className="fin-vide"><div className="fin-vide-icone" aria-hidden="true">⚖️</div><h3>Aucun mouvement</h3><p>Aucune écriture validée sur cette période.</p></div>
        ) : (
          <div className="cm-table-wrap">
            <table className="cm-table fin-table fin-etat">
              <thead>
                <tr><th rowSpan={2}>Compte</th><th rowSpan={2}>Intitulé</th><th colSpan={2} className="fin-groupe">Report</th><th colSpan={2} className="fin-groupe">Mouvements</th><th colSpan={2} className="fin-groupe">Soldes</th></tr>
                <tr><th className="fin-num">Débit</th><th className="fin-num">Crédit</th><th className="fin-num">Débit</th><th className="fin-num">Crédit</th><th className="fin-num">Débiteur</th><th className="fin-num">Créditeur</th></tr>
              </thead>
              <tbody>
                {d.comptes.map((c) => (
                  <tr key={c.compte}>
                    <td className="fin-mono"><b>{c.compte}</b></td><td>{c.intitule}</td>
                    <td className="fin-num">{fmtCompta(c.report_debit)}</td><td className="fin-num">{fmtCompta(c.report_credit)}</td>
                    <td className="fin-num">{fmtCompta(c.debit)}</td><td className="fin-num">{fmtCompta(c.credit)}</td>
                    <td className="fin-num fin-fort">{fmtCompta(c.solde_debiteur)}</td><td className="fin-num fin-fort">{fmtCompta(c.solde_crediteur)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>Totaux {d.equilibree ? <span className="fin-badge fin-badge-validee">Équilibrée</span> : <span className="fin-badge fin-badge-extournee">Déséquilibrée</span>}</td>
                  <td className="fin-num">{fmtCompta(d.totaux.report_debit, { zero: '0' })}</td><td className="fin-num">{fmtCompta(d.totaux.report_credit, { zero: '0' })}</td>
                  <td className="fin-num">{fmtCompta(d.totaux.debit, { zero: '0' })}</td><td className="fin-num">{fmtCompta(d.totaux.credit, { zero: '0' })}</td>
                  <td className="fin-num">{fmtCompta(d.totaux.solde_debiteur, { zero: '0' })}</td><td className="fin-num">{fmtCompta(d.totaux.solde_crediteur, { zero: '0' })}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </>}
    </div>
  );
}

export function GrandLivrePage() {
  const { can } = useApp();
  const { exercices, courant, erreur: errEx } = useExercices();
  const e = useEtat('/comptabilite/grand-livre', exercices, courant);
  if (errEx) return <div className="cm-page"><Erreur message={errEx} /></div>;
  if (!exercices) return <div className="loading-msg">Chargement…</div>;
  if (!exercices.length) return <div className="cm-page"><SansExercice peutParametrer={can('compta.parametrage')} /></div>;
  const d = e.donnees;
  const solde = (v) => { const n = Number(v); return n === 0 ? '0' : `${fmtCompta(Math.abs(n))} ${n > 0 ? 'D' : 'C'}`; };
  const exporter = () => exporterExcel(`Grand_livre_${d.exercice.code}`,
    ['Compte', 'Date', 'Journal', 'N°', 'Pièce', 'Libellé', 'Tiers', 'Débit', 'Crédit', 'Solde'],
    d.comptes.flatMap((c) => [
      [c.compte, '', '', '', '', `Report — ${c.intitule}`, '', +c.report_debit, +c.report_credit, ''],
      ...c.lignes.map((l) => [c.compte, String(l.date_ecriture).slice(0, 10), l.journal_code, l.numero_affiche || 'brouillard', l.reference_piece, l.libelle, l.tiers_nom || '', +l.debit, +l.credit, +l.solde]),
    ]),
    [`Grand livre — exercice ${d.exercice.code}`, `Du ${fmtDate(d.date_du)} au ${fmtDate(d.date_au)}`]);
  return (
    <div className="cm-page fin-page">
      <div className="cm-entete">
        <div>
          <h2>Grand livre</h2>
          <p>Détail des mouvements de chaque compte, avec le report en début de période et le solde progressif (D = débiteur, C = créditeur).</p>
        </div>
        <div className="cm-actions"><button type="button" className="cm-btn cm-secondaire" disabled={!d?.comptes?.length} onClick={exporter}>Exporter</button></div>
      </div>
      <Filtres exercices={exercices} {...e} avecComptes />
      <Erreur message={e.erreur} />
      {d && <>
        <BandeauPeriode d={{ ...d, nb_brouillard_exercice: 0, inclut_brouillard: e.f.brouillard }} />
        {d.tronque && <div className="fin-bandeau">Affichage limité à {d.limite.toLocaleString('fr-FR')} lignes : restreignez les comptes ou la période.</div>}
        {d.comptes.length === 0 ? (
          <div className="fin-vide"><div className="fin-vide-icone" aria-hidden="true">📒</div><h3>Aucun mouvement</h3><p>Aucune écriture sur ces comptes et cette période.</p></div>
        ) : d.comptes.map((c) => (
          <section key={c.compte} className="fin-gl-compte">
            <div className="fin-gl-tete">
              <span className="fin-mono"><b>{c.compte}</b></span><span>{c.intitule}</span>
              <span className="fin-gl-solde">Solde {solde(c.solde)}</span>
            </div>
            <div className="cm-table-wrap">
              <table className="cm-table fin-table">
                <thead><tr><th>Date</th><th>Journal</th><th>N°</th><th>Pièce</th><th>Libellé</th><th>Tiers / activité</th><th className="fin-num">Débit</th><th className="fin-num">Crédit</th><th className="fin-num">Solde</th></tr></thead>
                <tbody>
                  {(Number(c.report_debit) || Number(c.report_credit)) ? (
                    <tr className="fin-report"><td colSpan={6}>Report au {fmtDate(d.date_du)}</td><td className="fin-num">{fmtCompta(c.report_debit)}</td><td className="fin-num">{fmtCompta(c.report_credit)}</td><td className="fin-num">{solde(Number(c.report_debit) - Number(c.report_credit))}</td></tr>
                  ) : null}
                  {c.lignes.map((l, i) => (
                    <tr key={i} className={l.statut === 'brouillard' ? 'fin-ligne-brouillard' : ''}>
                      <td>{fmtDate(l.date_ecriture)}</td><td><span className="cm-code">{l.journal_code}</span></td>
                      <td className="fin-mono">{l.numero_affiche || 'brouillard'}</td><td>{l.reference_piece || '—'}</td>
                      <td className="fin-libelle">{l.libelle}</td><td>{[l.tiers_nom, l.activite_nom].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="fin-num">{fmtCompta(l.debit)}</td><td className="fin-num">{fmtCompta(l.credit)}</td><td className="fin-num fin-fort">{solde(l.solde)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={6}>Total du compte</td><td className="fin-num">{fmtCompta(c.debit, { zero: '0' })}</td><td className="fin-num">{fmtCompta(c.credit, { zero: '0' })}</td><td className="fin-num">{solde(c.solde)}</td></tr></tfoot>
              </table>
            </div>
          </section>
        ))}
      </>}
    </div>
  );
}
