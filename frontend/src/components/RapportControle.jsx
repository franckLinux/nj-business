import { useMemo, useState } from 'react';
import { fmt } from '@/lib/format';
import { STATUTS } from '@/components/LigneControle';

// Rapport de contrôle (migrations 042-044) — seul point d'accès au contrôle.
// Synthèse (chiffres clés, répartition par statut, anomalies, journaux) puis
// détail des opérations, filtrable sur place. Un clic sur une opération ouvre
// sa fiche de contrôle. Même contenu que le PDF.
const ORDRE = ['controle', 'anomalie', 'en_cours', 'a_controler'];
const dateFr = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const pct = (n, t) => (t ? Math.round((n / t) * 100) : 0);
const montantDe = (l) => l.debit || l.credit;

const Kpi = ({ titre, valeur, sous, couleur, barre }) => (
  <div className="rpc-kpi" style={{ borderTopColor: couleur }}>
    <div className="rpc-kpi-t">{titre}</div>
    <div className="rpc-kpi-v" style={{ color: couleur }}>{valeur}</div>
    {barre !== undefined && <div className="rpc-jauge"><span style={{ width: `${barre}%`, background: couleur }} /></div>}
    {sous && <div className="rpc-kpi-s">{sous}</div>}
  </div>
);

export default function RapportControle({ data, devise, libFiltres, onExcel, onImprimer, peutExporter, entite, selId, onOuvrir }) {
  const { lignes, resume: r } = data;
  const [vue, setVue] = useState('toutes');
  const [anomalie, setAnomalie] = useState('');

  const stats = useMemo(() => {
    const parStatut = Object.fromEntries(ORDRE.map((k) => [k, { n: 0, m: 0 }]));
    const parJournal = new Map();
    let total = 0; let enJeu = 0;
    for (const l of lignes) {
      const m = montantDe(l);
      total += m;
      parStatut[l.statut].n += 1; parStatut[l.statut].m += m;
      if (l.anomalies.length) enJeu += m;
      const j = parJournal.get(l.journal_code) || { code: l.journal_code || '—', nom: l.journal_nom, n: 0, m: 0, faits: 0, anom: 0 };
      j.n += 1; j.m += m;
      if (l.statut === 'controle' || l.statut === 'anomalie') j.faits += 1;
      if (l.anomalies.length) j.anom += 1;
      parJournal.set(l.journal_code, j);
    }
    return { parStatut, parJournal: [...parJournal.values()].sort((a, b) => b.m - a.m), total, enJeu };
  }, [lignes]);

  const anomalies = Object.entries(r.par_anomalie).sort((a, b) => b[1] - a[1]);
  const maxAnom = anomalies.length ? anomalies[0][1] : 1;
  const faits = r.par_statut.controle + r.par_statut.anomalie;

  const VUES = {
    toutes: { lib: 'Toutes', f: () => true },
    anomalies: { lib: 'Avec anomalies', f: (l) => l.anomalies.length > 0 },
    a_traiter: { lib: 'À traiter', f: (l) => l.statut === 'a_controler' || l.statut === 'en_cours' },
    traitees: { lib: 'Décidées', f: (l) => l.statut === 'controle' || l.statut === 'anomalie' },
  };
  const detail = lignes.filter((l) => VUES[vue].f(l) && (!anomalie || l.anomalies.includes(anomalie)));
  const totDetail = detail.reduce((t, l) => t + (l.debit ? -l.debit : l.credit), 0);

  return (
    <div className="rpc">
      {/* En-tête du rapport */}
      <div className="rpc-tete">
        <div style={{ minWidth: 0 }}>
          <div className="rpc-sur">{entite?.nom || ''}</div>
          <h2 className="rpc-titre">Rapport de contrôle comptable</h2>
          <div className="rpc-crit">{libFiltres}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {peutExporter && <button type="button" className="ctl-btn" onClick={onExcel} disabled={!lignes.length}>📊 Excel</button>}
          <button type="button" className="ctl-btn" onClick={onImprimer} disabled={!lignes.length}>🖨 Imprimer / PDF</button>
        </div>
      </div>

      {/* Chiffres clés */}
      <div className="rpc-kpis">
        <Kpi titre="Opérations" valeur={r.total} sous={`${fmt(stats.total, devise)} de mouvements`} couleur="#1e293b" />
        <Kpi titre="Avancement du contrôle" valeur={`${pct(faits, r.total)} %`} barre={pct(faits, r.total)}
          sous={`${faits} opération(s) validée(s) ou en anomalie sur ${r.total}`} couleur="#2563eb" />
        <Kpi titre="Anomalies constatées" valeur={r.par_statut.anomalie} sous={`${fmt(stats.parStatut.anomalie.m, devise)} concernés`} couleur="#dc2626" />
        <Kpi titre="Montant à risque" valeur={fmt(stats.enJeu, devise)}
          sous={`${r.avec_anomalies} opération(s) avec au moins un point à vérifier`} couleur="#b45309" />
      </div>

      <div className="rpc-grille">
        {/* Répartition par statut */}
        <section className="rpc-carte">
          <h3 className="rpc-h3">Répartition par statut</h3>
          <div className="rpc-pile" role="img" aria-label="Répartition des pièces par statut">
            {ORDRE.map((k) => stats.parStatut[k].n > 0 && (
              <span key={k} style={{ width: `${pct(stats.parStatut[k].n, r.total)}%`, background: STATUTS[k].dot }} title={`${STATUTS[k].lib} : ${stats.parStatut[k].n}`} />
            ))}
          </div>
          <table className="rpc-mini">
            <tbody>
              {ORDRE.map((k) => (
                <tr key={k}>
                  <td><span className="ctl-dot" style={{ background: STATUTS[k].dot }} />{STATUTS[k].lib}</td>
                  <td className="n">{stats.parStatut[k].n}</td>
                  <td className="n muted">{pct(stats.parStatut[k].n, r.total)} %</td>
                  <td className="n">{fmt(stats.parStatut[k].m, devise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Anomalies relevées */}
        <section className="rpc-carte">
          <h3 className="rpc-h3">Points à vérifier relevés {anomalie && <button type="button" className="rpc-lien" onClick={() => setAnomalie('')}>tout afficher</button>}</h3>
          {anomalies.length === 0 ? (
            <div className="ctl-alerte verte">✓ Aucune anomalie sur les opérations de la période.</div>
          ) : anomalies.map(([k, n]) => (
            <button key={k} type="button" className={`rpc-barre${anomalie === k ? ' on' : ''}`} onClick={() => setAnomalie(anomalie === k ? '' : k)}
              title="Afficher ces opérations dans le détail">
              <span className="rpc-barre-lib">{data.anomalies[k] || k}</span>
              <span className="rpc-barre-fond"><span style={{ width: `${Math.max(6, (n / maxAnom) * 100)}%` }} /></span>
              <span className="rpc-barre-n">{n}</span>
            </button>
          ))}
        </section>

        {/* Par journal */}
        <section className="rpc-carte">
          <h3 className="rpc-h3">Par journal</h3>
          <table className="rpc-mini">
            <thead><tr><th>Journal</th><th className="n" title="Nombre d'opérations">Nb</th><th className="n masque-mobile">Montant</th><th className="n" title="Part des opérations décidées">Fait</th><th className="n" title="Opérations avec anomalies">⚠</th></tr></thead>
            <tbody>
              {stats.parJournal.map((j) => (
                <tr key={j.code}>
                  <td title={j.nom}><b>{j.code}</b><div className="muted">{j.nom}</div></td>
                  <td className="n">{j.n}</td>
                  <td className="n masque-mobile">{fmt(j.m, devise)}</td>
                  <td className="n">{pct(j.faits, j.n)} %</td>
                  <td className="n" style={{ color: j.anom ? '#b91c1c' : undefined }}>{j.anom}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      {/* Détail */}
      <section className="rpc-carte" style={{ padding: 0 }}>
        <div className="rpc-detail-tete">
          <h3 className="rpc-h3" style={{ margin: 0 }}>Détail des opérations
            <span className="muted" style={{ fontWeight: 500, marginLeft: 6 }}>{detail.length} opération(s){anomalie ? ` · ${data.anomalies[anomalie]}` : ''}</span>
            {onOuvrir && <span className="rpc-astuce">Cliquez sur une opération pour la contrôler</span>}
          </h3>
          <div className="rpc-onglets" role="tablist">
            {Object.entries(VUES).map(([k, v]) => (
              <button key={k} type="button" role="tab" aria-selected={vue === k} className={vue === k ? 'on' : ''} onClick={() => setVue(k)}>{v.lib}</button>
            ))}
          </div>
        </div>
        <div className="table-wrap" style={{ border: 0, borderRadius: 0, margin: 0 }}>
          <table className="rpc-table">
            <thead>
              <tr><th>Pièce</th><th>Fournisseur / client</th><th>Compte tiers</th><th>Libellé · code comptable</th><th className="n">Montant</th><th>Contrôle</th></tr>
            </thead>
            <tbody>
              {detail.length === 0 && <tr><td colSpan={6} className="ctl-vide">Aucune opération dans cette vue.</td></tr>}
              {detail.map((l) => {
                const st = STATUTS[l.statut];
                const ouvrir = onOuvrir ? () => onOuvrir(l.id, detail.map((x) => x.id)) : undefined;
                const cls = `${l.observation ? 'avec-obs' : ''}${onOuvrir ? ' cliquable' : ''}${selId === l.id ? ' sel' : ''}`;
                return [
                  <tr key={l.id} className={cls} onClick={ouvrir} tabIndex={onOuvrir ? 0 : undefined}
                    onKeyDown={ouvrir ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ouvrir(); } } : undefined}
                    aria-label={onOuvrir ? `Contrôler l'opération ${l.reference}` : undefined}>
                    <td><b>{l.reference}</b><div className="muted">{dateFr(l.date)} · {l.journal_code}</div></td>
                    <td>{l.virement ? <span className="muted">Virement interne</span> : (
                      <>{l.tiers_nom || <span className="rouge">non renseigné</span>}
                        {l.registre?.verifie && <span className="vert" title="Au registre, identité vérifiée"> ✓</span>}
                        <div className="muted mono">{l.tiers_nui || '—'}</div></>
                    )}</td>
                    <td className="mono">{l.virement ? <span className="muted">—</span> : l.compte_tiers ? (
                      <>{l.compte_tiers}{l.compte_tiers_source === 'collectif' && <div className="muted" style={{ fontFamily: 'inherit' }}>collectif</div>}</>
                    ) : <span className="muted" style={{ fontFamily: 'inherit' }}>non identifié</span>}</td>
                    <td>{l.libelle}<div className="muted">
                      {l.compte ? <>cpte <b className="mono">{l.compte}</b></> : <span className="rouge">compte manquant</span>}
                      {l.compte_etat === 'non_valide' && <span style={{ color: '#b45309' }}> (non validé)</span>}
                      {l.compte_etat === 'corrige' && <span style={{ color: '#7c3aed' }} title={`Compte de la rubrique : ${l.compte_rubrique || '—'}`}> ✎ corrigé</span>}
                      {' '}↔ {l.compte_tresorerie || '?'}
                    </div></td>
                    <td className="n" style={{ color: l.debit ? '#b91c1c' : '#15803d', fontWeight: 700 }}>{l.debit ? `− ${fmt(l.debit, devise)}` : `+ ${fmt(l.credit, devise)}`}</td>
                    <td>
                      <span className="rpc-statut" style={{ background: st.bg, color: st.fg }}>{st.lib}</span>
                      {l.controle_par && (l.statut === 'controle' || l.statut === 'anomalie') && <div className="muted">{l.controle_par}, {dateFr(l.controle_le)}</div>}
                      {l.anomalies.length > 0 && (
                        <div className="rpc-anoms">{l.anomalies_libelles.map((a) => <span key={a}>⚠ {a}</span>)}</div>
                      )}
                    </td>
                  </tr>,
                  l.observation && (
                    <tr key={`${l.id}-o`} className={`rpc-obs${onOuvrir ? ' cliquable' : ''}${selId === l.id ? ' sel' : ''}`} onClick={ouvrir}><td colSpan={6}><span>Observation :</span> {l.observation}</td></tr>
                  ),
                ];
              })}
            </tbody>
            {detail.length > 0 && (
              <tfoot><tr><td colSpan={4}>Solde des opérations affichées</td>
                <td className="n" style={{ color: totDetail < 0 ? '#b91c1c' : '#15803d' }}>{totDetail < 0 ? `− ${fmt(-totDetail, devise)}` : `+ ${fmt(totDetail, devise)}`}</td><td /></tr></tfoot>
            )}
          </table>
        </div>
      </section>
      <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
        Montants : sorties en négatif, entrées en positif. Code comptable : compte de la rubrique validé dans la passerelle, ou compte corrigé par le comptable (✎) ;
        contrepartie = compte de trésorerie du journal. Compte tiers : celui du registre des bénéficiaires payés / encaissés (collectif 401 / 411 à défaut).
        Les écritures annulées et leurs contre-passations ne sont pas présentées. Le contrôle n'a modifié aucune écriture de caisse.
      </div>
    </div>
  );
}
