import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { api } from '@/lib/api';
import { MOIS, fmt } from '@/lib/format';
import { exporterExcel, STYLE_BOUTON_EXPORT } from '@/lib/export';

// Simulation d'export — « balance de contrôle » (passerelle comptable).
// Génère à blanc les écritures d'un mois et prouve que le paramétrage est
// juste : comptes partout, équilibre, virements soldés, trésorerie = caisses.
// Rien n'est exporté ni modifié.
const NIVEAU = {
  ok: { ico: '✓', bg: '#f0fdf4', fg: '#166534', bd: '#bbf7d0' },
  avertissement: { ico: '⚠', bg: '#fffbeb', fg: '#92400e', bd: '#fde68a' },
  bloquant: { ico: '✕', bg: '#fef2f2', fg: '#991b1b', bd: '#fecaca' },
};
const VERDICT = {
  ok: 'Paramétrage vérifié : les écritures du mois sont justes et prêtes à être exportées.',
  avertissement: 'Écritures justes, avec des points d\'attention avant l\'export.',
  bloquant: 'Le paramétrage ne permet pas encore d\'exporter ce mois : corrigez les points en rouge.',
};
const th = { textAlign: 'left', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .4, color: 'var(--text-muted)', padding: '6px 8px', borderBottom: '1px solid var(--border)', background: '#f8fafc' };
const td = { padding: '6px 8px', borderBottom: '1px solid #f1f5f9', fontSize: 12.5 };
const n = { textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };

export default function SimulationExport({ onDefinirCompte, rubriques }) {
  const { mois: moisApp, annee: anneeApp, devise, entite } = useApp();
  const [mois, setMois] = useState(moisApp);
  const [annee, setAnnee] = useState(anneeApp);
  const [res, setRes] = useState(null);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  const lancer = async () => {
    setEnCours(true); setErreur('');
    const r = await api.get(`/passerelle/simulation?mois=${encodeURIComponent(mois)}&annee=${annee}`);
    setEnCours(false);
    if (r.error) { setErreur(r.error); setRes(null); return; }
    setRes(r);
  };
  const excel = () => exporterExcel(`Balance_controle_${mois}_${annee}`, ['Compte', 'Intitulé', 'Débit', 'Crédit', 'Solde'],
    [...res.balance.map((b) => [b.compte, b.intitule, b.debit, b.credit, b.solde]), ['', 'TOTAL', res.totaux.debit, res.totaux.credit, res.totaux.debit - res.totaux.credit]],
    [entite?.nom || '', `Balance de contrôle (simulation d'export) — ${mois} ${annee}`, `Verdict : ${VERDICT[res.verdict]}`]);
  const an = new Date().getFullYear();
  const v = res ? NIVEAU[res.verdict] : null;

  return (
    <div className="card" style={{ padding: 16, marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>🧪 Balance de contrôle (simulation d'export)</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Génère à blanc les écritures d'un mois pour prouver que le paramétrage est juste. Rien n'est exporté ni modifié.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={mois} onChange={(e) => setMois(e.target.value)} className="ctl-in" style={{ width: 'auto' }}>
            {MOIS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={annee} onChange={(e) => setAnnee(parseInt(e.target.value, 10))} className="ctl-in" style={{ width: 'auto' }}>
            {[an - 2, an - 1, an, an + 1].map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <button type="button" className="ctl-btn vert" onClick={lancer} disabled={enCours}>{enCours ? 'Calcul…' : '▶ Lancer la simulation'}</button>
        </div>
      </div>

      {erreur && <div className="alert-err" style={{ marginTop: 12 }}>{erreur}</div>}

      {res && (
        <div style={{ marginTop: 14 }}>
          <div style={{ background: v.bg, color: v.fg, border: `1px solid ${v.bd}`, borderRadius: 10, padding: '10px 14px', fontWeight: 700, fontSize: 13 }}>
            {v.ico} {VERDICT[res.verdict]}
            <span style={{ fontWeight: 500, marginLeft: 6 }}>({res.totaux.ecritures} écriture(s), {mois} {res.annee})</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 8, marginTop: 10 }}>
            {res.controles.map((c) => {
              const s = NIVEAU[c.niveau];
              return (
                <div key={c.code} style={{ border: `1px solid ${s.bd}`, background: s.bg, borderRadius: 9, padding: '8px 10px' }}>
                  <div style={{ fontWeight: 700, fontSize: 12.5, color: s.fg }}>{s.ico} {c.titre}</div>
                  <div style={{ fontSize: 12, color: '#334155', marginTop: 2 }}>{c.detail}</div>
                </div>
              );
            })}
          </div>

          {res.sans_compte.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: '#991b1b', marginBottom: 6 }}>Écritures sans compte ({res.sans_compte.length})</div>
              <div className="table-wrap"><table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Pièce</th><th style={th}>Libellé</th><th style={th}>Rubrique</th><th style={{ ...th, ...n }}>Montant</th><th style={th}>Manque</th><th style={th} /></tr></thead>
                <tbody>{res.sans_compte.map((x) => {
                  const rub = rubriques.find((r) => r.code === x.rubrique);
                  return (
                    <tr key={x.ref}><td style={td}><b>{x.ref}</b><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{x.date.split('-').reverse().join('/')}</div></td>
                      <td style={td}>{x.libelle}</td><td style={td}>{x.rubrique}</td><td style={{ ...td, ...n }}>{fmt(x.montant, devise)}</td>
                      <td style={{ ...td, color: '#991b1b' }}>{x.manque}</td>
                      <td style={td}>{rub && !rub.est_virement_interne && onDefinirCompte && x.manque.startsWith('compte validé') && (
                        <button type="button" className="ctl-btn mini" onClick={() => onDefinirCompte(rub)}>Définir le compte</button>)}</td></tr>
                  );
                })}</tbody>
              </table></div>
            </div>
          )}

          {res.virements.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: '#991b1b', marginBottom: 6 }}>Virements internes du mois (compte {res.compte_virements} non soldé)</div>
              <div className="table-wrap"><table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Pièce</th><th style={th}>Date</th><th style={th}>Libellé</th><th style={{ ...th, ...n }}>Montant (+ entrée / − sortie)</th></tr></thead>
                <tbody>{res.virements.map((x) => <tr key={x.ref}><td style={td}><b>{x.ref}</b></td><td style={td}>{x.date.split('-').reverse().join('/')}</td><td style={td}>{x.libelle}</td><td style={{ ...td, ...n }}>{fmt(x.montant, devise)}</td></tr>)}</tbody>
              </table></div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12, marginTop: 14 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', marginBottom: 6 }}>Trésorerie : comptes vs caisses</div>
              <div className="table-wrap"><table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Compte</th><th style={th}>Caisses</th><th style={{ ...th, ...n }}>Caisses (E − S)</th><th style={{ ...th, ...n }}>Comptabilité</th><th style={{ ...th, ...n }}>Écart</th></tr></thead>
                <tbody>{res.rapprochement.map((x) => (
                  <tr key={x.compte}><td style={td}><b>{x.compte}</b></td><td style={td}>{x.caisses.join(', ')}</td>
                    <td style={{ ...td, ...n }}>{fmt(x.net_caisses, devise)}</td><td style={{ ...td, ...n }}>{fmt(x.net_comptable, devise)}</td>
                    <td style={{ ...td, ...n, fontWeight: 700, color: x.ecart ? '#b91c1c' : '#15803d' }}>{x.ecart ? fmt(x.ecart, devise) : '✓ 0'}</td></tr>
                ))}</tbody>
              </table></div>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase' }}>Balance des comptes générés</span>
                {res.balance.length > 0 && <button type="button" style={{ ...STYLE_BOUTON_EXPORT, padding: '4px 10px' }} onClick={excel}>📊 Excel</button>}
              </div>
              <div className="table-wrap"><table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Compte</th><th style={th}>Intitulé</th><th style={{ ...th, ...n }}>Débit</th><th style={{ ...th, ...n }}>Crédit</th></tr></thead>
                <tbody>
                  {res.balance.length === 0 && <tr><td colSpan={4} style={{ ...td, textAlign: 'center', color: 'var(--text-muted)' }}>Aucune écriture imputée.</td></tr>}
                  {res.balance.map((b) => (
                    <tr key={b.compte}><td style={td}><b>{b.compte}</b></td><td style={{ ...td, fontSize: 12 }}>{b.intitule}</td>
                      <td style={{ ...td, ...n }}>{b.debit ? fmt(b.debit, devise) : ''}</td><td style={{ ...td, ...n }}>{b.credit ? fmt(b.credit, devise) : ''}</td></tr>
                  ))}
                </tbody>
                {res.balance.length > 0 && (
                  <tfoot><tr style={{ background: '#f8fafc', fontWeight: 800 }}><td style={td} colSpan={2}>Total</td>
                    <td style={{ ...td, ...n }}>{fmt(res.totaux.debit, devise)}</td><td style={{ ...td, ...n }}>{fmt(res.totaux.credit, devise)}</td></tr></tfoot>
                )}
              </table></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
