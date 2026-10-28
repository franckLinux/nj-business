import { useEffect, useMemo } from 'react';
import { fmt } from '@/lib/format';
import { STATUTS } from '@/components/LigneControle';

// Sous-onglet « Contrôle de régularité formelle » (migration 045).
// Les pièces sont présentées JOURNAL PAR JOURNAL (jamais mélangées : caisse,
// banque, mobile money…), d'après la configuration des journaux. Colonne
// « Contrôle » : anomalies constatées (saisies à la main) et points relevés ;
// bouton « Confirmer la validation » par pièce.
const dateFr = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const dateCourte = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '');
const TYPES = { caisse: 'Caisses', banque: 'Banques', om: 'Orange Money', momo: 'Mobile Money', carte: 'Cartes', autre: 'Autres' };

export default function RegulariteFormelle({
  lignes, journaux, jSel, setJSel, devise, peutSaisir, peutRouvrir,
  onAnomalies, onValider, onRouvrir, onOuvrir, selId,
}) {
  // Pièces de la période, séparées par journal.
  const parJournal = useMemo(() => {
    const m = new Map();
    for (const l of lignes) {
      const k = String(l.journal_id ?? '');
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(l);
    }
    return m;
  }, [lignes]);

  // Journaux de la configuration (+ ceux qui ne figureraient plus dans la liste active).
  const liste = useMemo(() => {
    const vus = new Set(journaux.map((j) => String(j.id)));
    const extra = [...parJournal.keys()].filter((k) => k && !vus.has(k))
      .map((k) => { const l = parJournal.get(k)[0]; return { id: Number(k), code: l.journal_code, nom: l.journal_nom, type: 'autre' }; });
    return [...journaux, ...extra];
  }, [journaux, parJournal]);
  const groupes = useMemo(() => {
    const g = new Map();
    for (const j of liste) {
      const t = TYPES[j.type] ? j.type : 'autre';
      if (!g.has(t)) g.set(t, []);
      g.get(t).push(j);
    }
    const ordre = Object.keys(TYPES);
    return [...g.entries()].sort((a, b) => ordre.indexOf(a[0]) - ordre.indexOf(b[0]));
  }, [liste]);

  // Par défaut : le premier journal qui a des pièces sur la période.
  useEffect(() => {
    if (jSel && liste.some((j) => String(j.id) === String(jSel))) return;
    const avec = liste.find((j) => parJournal.get(String(j.id))?.length);
    if (avec || liste[0]) setJSel(String((avec || liste[0]).id));
  }, [liste, parJournal]);   // eslint-disable-line react-hooks/exhaustive-deps

  const journal = liste.find((j) => String(j.id) === String(jSel));
  const pieces = parJournal.get(String(jSel)) || [];
  const nb = (id, f = () => true) => (parJournal.get(String(id)) || []).filter(f).length;
  const valides = pieces.filter((l) => l.statut === 'controle').length;
  const total = pieces.reduce((t, l) => t + (l.debit ? -l.debit : l.credit), 0);

  return (
    <div className="rf">
      {/* Choix du journal : un journal à la fois */}
      <div className="rf-journaux" role="tablist" aria-label="Journaux">
        {groupes.map(([t, js]) => (
          <div key={t} className="rf-groupe">
            <span className="rf-groupe-lib">{TYPES[t]}</span>
            {js.map((j) => {
              const n = nb(j.id); const v = nb(j.id, (l) => l.statut === 'controle');
              return (
                <button key={j.id} type="button" role="tab" aria-selected={String(j.id) === String(jSel)}
                  className={`rf-journal${String(j.id) === String(jSel) ? ' on' : ''}${n ? '' : ' vide'}`} onClick={() => setJSel(String(j.id))}
                  title={`${j.code} – ${j.nom}`}>
                  <b>{j.code}</b> <span>{j.nom}</span>
                  <i>{n ? `${v}/${n}` : '0'}</i>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <section className="rpc-carte" style={{ padding: 0 }}>
        <div className="rpc-detail-tete">
          <h3 className="rpc-h3" style={{ margin: 0 }}>
            {journal ? <>Journal {journal.code} – {journal.nom}</> : 'Aucun journal'}
            <span className="muted" style={{ fontWeight: 500, marginLeft: 6, textTransform: 'none', letterSpacing: 0 }}>
              {pieces.length} pièce(s) · {valides} validée(s){journal?.compte_tresorerie ? ` · trésorerie ${journal.compte_tresorerie}` : ''}
            </span>
          </h3>
          {pieces.length > 0 && (
            <span className="rf-avance" title="Pièces validées">
              <span><span style={{ width: `${Math.round((valides / pieces.length) * 100)}%` }} /></span>
              {Math.round((valides / pieces.length) * 100)} %
            </span>
          )}
        </div>
        <div className="table-wrap" style={{ border: 0, borderRadius: 0, margin: 0 }}>
          <table className="rpc-table rf-table">
            <thead>
              <tr><th>Date · pièce</th><th>Libellé</th><th>Bénéficiaire</th><th className="n">Montant</th><th>Code comptable</th>
                <th style={{ minWidth: 220 }}>Contrôle</th><th>Statut</th><th style={{ minWidth: 150 }}>Validation</th></tr>
            </thead>
            <tbody>
              {pieces.length === 0 && <tr><td colSpan={8} className="ctl-vide">Aucune pièce pour ce journal et ces critères.</td></tr>}
              {pieces.map((l) => {
                const st = STATUTS[l.statut] || STATUTS.a_controler;
                const ouvertes = (l.anomalies_saisies || []).filter((a) => a.statut === 'ouverte');
                const levees = (l.anomalies_saisies || []).filter((a) => a.statut === 'levee');
                return (
                  <tr key={l.id} className={selId === l.id ? 'sel' : ''}>
                    <td><button type="button" className="rf-ref" onClick={() => onOuvrir(l.id, pieces.map((x) => x.id))} title="Ouvrir la fiche de contrôle">{l.reference}</button>
                      <div className="muted">{dateFr(l.date)}</div></td>
                    <td>{l.libelle}</td>
                    <td>{l.virement ? <span className="muted">Virement interne</span> : (l.tiers_nom || <span className="muted">—</span>)}
                      {l.tiers_nui && <div className="muted mono">{l.tiers_nui}</div>}</td>
                    <td className="n" style={{ color: l.debit ? '#b91c1c' : '#15803d', fontWeight: 700 }}>{l.debit ? `− ${fmt(l.debit, devise)}` : `+ ${fmt(l.credit, devise)}`}</td>
                    <td className="mono">{l.compte || <span className="rouge" style={{ fontFamily: 'inherit' }}>manquant</span>}
                      {l.compte_etat === 'corrige' && <div className="muted" style={{ color: '#7c3aed', fontFamily: 'inherit' }}>✎ corrigé</div>}
                      {l.compte_etat === 'non_valide' && <div className="muted" style={{ color: '#b45309', fontFamily: 'inherit' }}>non validé</div>}</td>
                    <td>
                      <div className="rf-ctl">
                        {ouvertes.map((a) => <div key={a.id} className={a.bloquante ? 'bloq' : 'ouv'}>{a.bloquante ? '⛔' : '⚠'} {a.libelle}</div>)}
                        {levees.length > 0 && <div className="lev">✓ {levees.length} anomalie(s) levée(s)</div>}
                        {l.anomalies.length > 0 && <div className="auto" title="Points relevés automatiquement">{l.anomalies_libelles.join(' · ')}</div>}
                        {!ouvertes.length && !levees.length && !l.anomalies.length && <div className="lev">Aucune anomalie</div>}
                        {l.observation && <div className="obs">« {l.observation} »</div>}
                      </div>
                      <button type="button" className="rpc-lien" style={{ margin: '3px 0 0', padding: 0 }} onClick={() => onAnomalies(l.id)}>
                        {peutSaisir && l.statut !== 'controle' ? '+ Anomalie / gérer' : 'Consulter'}
                      </button>
                    </td>
                    <td><span className="rpc-statut" style={{ background: st.bg, color: st.fg }}>{st.lib}</span></td>
                    <td>
                      {l.statut === 'controle' ? (
                        <div className="rf-valide">
                          <b>✓ Validée</b>
                          <div className="muted">{l.controle_par || '?'}, {dateCourte(l.controle_le)}</div>
                          {peutRouvrir && <button type="button" className="rpc-lien" style={{ margin: 0, padding: 0 }} onClick={() => onRouvrir(l.id)}>↺ Rouvrir</button>}
                        </div>
                      ) : peutSaisir ? (
                        <>
                          <button type="button" className={`ctl-btn mini ${l.validable ? 'vert' : ''}`} onClick={() => onValider(l.id)}
                            title={l.validable ? 'Confirmer la validation de la pièce' : `Validation bloquée : ${l.bloquants.join(' ; ')}`}>
                            {l.validable ? '✅' : '⛔'} Confirmer la validation
                          </button>
                          {l.reouverture && <div className="muted" title={l.reouverture.motif}>rouverte le {dateCourte(l.reouverture.le)}</div>}
                        </>
                      ) : <span className="muted">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {pieces.length > 0 && (
              <tfoot><tr><td colSpan={3}>Solde des pièces du journal</td>
                <td className="n" style={{ color: total < 0 ? '#b91c1c' : '#15803d' }}>{total < 0 ? `− ${fmt(-total, devise)}` : `+ ${fmt(total, devise)}`}</td><td colSpan={4} /></tr></tfoot>
            )}
          </table>
        </div>
      </section>
      <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
        Bloquent la validation : une anomalie constatée marquée « bloquante » non levée, un code comptable manquant, un tiers non identifié. Les autres points relevés sont seulement signalés.
        Les autres anomalies n'empêchent pas la validation. La validation ne déclenche ni l'arrêté de caisse, ni l'export, ni la passerelle comptable.
      </div>
    </div>
  );
}
