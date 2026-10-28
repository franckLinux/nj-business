import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import { api } from '@/lib/api';
import { fmt } from '@/lib/format';
import { exporterExcel, num, STYLE_BOUTON_EXPORT } from '@/lib/export';

// Suivi des opérations par activité / projet (migration 034).
// Annulations, contre-passations et virements internes sont exclus.
const TYPES = { activite: { label: 'Activité', ico: '🏷️', couleur: '#0369a1', fond: '#e0f2fe' }, projet: { label: 'Projet', ico: '🎯', couleur: '#7c3aed', fond: '#ede9fe' } };

function Barre({ pct, couleur }) {
  return (
    <div style={{ height: 6, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden', minWidth: 80 }}>
      <div style={{ width: `${Math.min(100, Math.max(0, pct))}%`, height: '100%', background: couleur, borderRadius: 4 }} />
    </div>
  );
}

export default function SuiviActivitesPage() {
  const { mois, annee, devise, can, entite } = useApp();
  const [periode, setPeriode] = useState('mois');
  const [data, setData] = useState(null);
  const [erreur, setErreur] = useState('');
  const [ouvert, setOuvert] = useState({});

  const charger = useCallback(async () => {
    setData(null); setErreur('');
    const r = await api.get(`/activites/suivi?mois=${encodeURIComponent(mois)}&annee=${annee}&periode=${periode}`);
    if (r.error) { setErreur(r.error); return; }
    setData(r);
  }, [mois, annee, periode]);
  useEffect(() => { charger(); }, [charger]);

  const libellePeriode = periode === 'mois' ? `${mois} ${annee}` : `Année ${annee}`;

  const onExporter = () => {
    const lignes = [];
    for (const a of data.activites) {
      lignes.push([a.code || '', a.nom, TYPES[a.type]?.label || a.type, num(a.entrees), num(a.sorties), a.part, a.nb,
        a.budget !== null ? num(a.budget) : '', a.budget !== null ? num(a.cumul_sorties) : '', a.taux_budget ?? '']);
      for (const r of a.rubriques) lignes.push(['', `   ${r.code} — ${r.libelle}`, '', num(r.entrees), num(r.sorties), '', r.nb, '', '', '']);
    }
    const nc = data.non_classe;
    lignes.push(['', 'Non classé', '', num(nc.entrees), num(nc.sorties), nc.part, nc.nb, '', '', '']);
    lignes.push(['', 'TOTAL', '', num(data.total.entrees), num(data.total.sorties), 100, '', '', '', '']);
    exporterExcel(`Suivi_activites_${periode === 'mois' ? `${mois}_` : ''}${annee}`,
      ['Code', 'Activité / projet', 'Type', `Recettes (${devise})`, `Dépenses (${devise})`, 'Part des dépenses (%)', 'Opérations',
        `Enveloppe (${devise})`, `Dépensé depuis le début (${devise})`, 'Enveloppe consommée (%)'],
      lignes, [`Suivi par activité / projet — ${libellePeriode}`, entite?.nom || '']);
  };

  if (erreur) return <div className="alert-err">{erreur}</div>;

  const vide = data && data.activites.length === 0;
  const nc = data?.non_classe;
  const classe = data ? data.total.sorties - nc.sorties : 0;
  const tauxClasse = data && data.total.sorties > 0 ? Math.round((classe / data.total.sorties) * 100) : 0;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>Suivi par activité / projet — {libellePeriode}</h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Toutes caisses confondues. Annulations et virements internes exclus.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 9, overflow: 'hidden', background: '#fff' }}>
            {[['mois', 'Mois'], ['annee', 'Année entière']].map(([k, l]) => (
              <button key={k} type="button" onClick={() => setPeriode(k)}
                style={{ padding: '7px 14px', border: 0, cursor: 'pointer', fontSize: 12.5, fontWeight: 700,
                  background: periode === k ? 'var(--accent)' : 'transparent', color: periode === k ? '#fff' : 'var(--text-muted)' }}>{l}</button>
            ))}
          </div>
          {can('rapport.export') && data && <button style={STYLE_BOUTON_EXPORT} onClick={onExporter}>📊 Excel</button>}
        </div>
      </div>

      {!data ? <div className="loading-msg">Chargement…</div> : vide ? (
        <div style={{ textAlign: 'center', padding: 40, background: 'white', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🎯</div>
          <p>Aucune activité ni aucun projet défini.</p>
          <p style={{ fontSize: 12, marginTop: 4 }}>
            {can('activites.edit')
              ? <>Créez-les dans <Link to="/config">Configuration → Activités / projets</Link>, puis choisissez-les à la saisie des opérations.</>
              : 'Demandez à votre directeur de les créer dans la Configuration.'}
          </p>
        </div>
      ) : (
        <>
          <div className="kpi-grid">
            <div className="kpi-card"><div className="kpi-icon kpi-red"><svg viewBox="0 0 24 24"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6" /></svg></div>
              <div className="kpi-body"><p className="kpi-label">Dépenses de la période</p><p className="kpi-value" style={{ fontSize: 17 }}>{fmt(data.total.sorties, devise)}</p></div></div>
            <div className="kpi-card"><div className="kpi-icon kpi-blue"><svg viewBox="0 0 24 24"><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg></div>
              <div className="kpi-body"><p className="kpi-label">Dépenses classées</p><p className="kpi-value" style={{ fontSize: 17 }}>{tauxClasse} %</p></div></div>
            <div className="kpi-card"><div className="kpi-icon kpi-purple"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg></div>
              <div className="kpi-body"><p className="kpi-label">Non classé</p><p className="kpi-value" style={{ fontSize: 17 }}>{fmt(nc.sorties, devise)}</p></div></div>
            <div className="kpi-card"><div className="kpi-icon kpi-green"><svg viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /></svg></div>
              <div className="kpi-body"><p className="kpi-label">Recettes de la période</p><p className="kpi-value" style={{ fontSize: 17 }}>{fmt(data.total.entrees, devise)}</p></div></div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Activité / projet</th>
                  <th style={{ textAlign: 'right' }}>Recettes</th>
                  <th style={{ textAlign: 'right' }}>Dépenses</th>
                  <th style={{ minWidth: 140 }}>Part des dépenses</th>
                  <th style={{ minWidth: 170 }}>Enveloppe (depuis le début)</th>
                  <th style={{ textAlign: 'center' }}>Opér.</th>
                </tr>
              </thead>
              <tbody>
                {[...data.activites, { id: 'nc', nom: 'Non classé', type: null, ...nc, budget: null }].map((a) => {
                  const t = a.type ? TYPES[a.type] : null;
                  const detail = ouvert[a.id];
                  const depasse = a.taux_budget !== null && a.taux_budget > 100;
                  return (
                    <Fragment key={a.id}>
                      <tr style={{ cursor: a.rubriques.length ? 'pointer' : 'default', background: a.id === 'nc' ? '#f8fafc' : undefined }}
                        onClick={() => a.rubriques.length && setOuvert((o) => ({ ...o, [a.id]: !o[a.id] }))}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ color: 'var(--text-light)', fontSize: 10, width: 10 }}>{a.rubriques.length ? (detail ? '▼' : '▶') : ''}</span>
                            {t ? <span title={t.label} style={{ fontSize: 11, padding: '2px 7px', borderRadius: 20, background: t.fond, color: t.couleur, fontWeight: 700, whiteSpace: 'nowrap' }}>{t.ico} {t.label}</span>
                              : <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 20, background: '#f1f5f9', color: '#64748b', fontWeight: 700 }}>—</span>}
                            <span style={{ fontWeight: 600, color: a.id === 'nc' ? 'var(--text-muted)' : 'var(--text)', fontStyle: a.id === 'nc' ? 'italic' : 'normal' }}>
                              {a.nom}{a.code ? <small style={{ color: 'var(--text-muted)', marginLeft: 6 }}>{a.code}</small> : null}
                              {a.actif === false && <small style={{ color: 'var(--text-muted)', marginLeft: 6 }}>(désactivée)</small>}
                            </span>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', color: '#15803d', fontWeight: 600 }}>{a.entrees ? fmt(a.entrees, devise) : '—'}</td>
                        <td style={{ textAlign: 'right', color: '#b91c1c', fontWeight: 700 }}>{a.sorties ? fmt(a.sorties, devise) : '—'}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Barre pct={a.part} couleur={a.id === 'nc' ? '#94a3b8' : (t?.couleur || '#3b82f6')} />
                            <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 42 }}>{a.part} %</span>
                          </div>
                        </td>
                        <td>
                          {a.budget ? (
                            <div title={`${fmt(a.cumul_sorties, devise)} dépensés sur ${fmt(a.budget, devise)}`}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 3 }}>
                                <span style={{ color: depasse ? '#b91c1c' : 'var(--text-muted)', fontWeight: depasse ? 700 : 400 }}>{fmt(a.cumul_sorties, devise)} / {fmt(a.budget, devise)}</span>
                                <b style={{ color: depasse ? '#b91c1c' : a.taux_budget > 80 ? '#b45309' : '#15803d' }}>{a.taux_budget} %</b>
                              </div>
                              <Barre pct={a.taux_budget} couleur={depasse ? '#dc2626' : a.taux_budget > 80 ? '#f59e0b' : '#16a34a'} />
                            </div>
                          ) : <span style={{ fontSize: 12, color: 'var(--text-light)' }}>—</span>}
                        </td>
                        <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{a.nb}</td>
                      </tr>
                      {detail && a.rubriques.map((r) => (
                        <tr key={`${a.id}-${r.code}`} style={{ background: '#fbfcfe' }}>
                          <td style={{ paddingLeft: 46, fontSize: 12 }}><span className="badge-rubrique" style={{ marginRight: 6 }}>{r.code}</span>{r.libelle}</td>
                          <td style={{ textAlign: 'right', fontSize: 12, color: '#15803d' }}>{r.entrees ? fmt(r.entrees, devise) : ''}</td>
                          <td style={{ textAlign: 'right', fontSize: 12, color: '#b91c1c' }}>{r.sorties ? fmt(r.sorties, devise) : ''}</td>
                          <td /><td />
                          <td style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>{r.nb}</td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: '#1e293b', color: '#fff', fontWeight: 800 }}>
                  <td style={{ color: 'rgba(255,255,255,.8)' }}>TOTAL</td>
                  <td style={{ textAlign: 'right', color: '#86efac' }}>{fmt(data.total.entrees, devise)}</td>
                  <td style={{ textAlign: 'right', color: '#fca5a5' }}>{fmt(data.total.sorties, devise)}</td>
                  <td /><td /><td />
                </tr>
              </tfoot>
            </table>
          </div>
          {nc.sorties > 0 && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
              💡 {fmt(nc.sorties, devise)} de dépenses ne sont rattachées à aucune activité. Une opération déjà saisie peut être classée après coup avec ✏️ dans le journal.
            </p>
          )}
        </>
      )}
    </>
  );
}
