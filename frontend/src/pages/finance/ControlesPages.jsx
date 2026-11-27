// NJ FINANCE — Tableau des contrôles et règlements reçus (27/11/2026).
//   • Tableau des contrôles : tout ce qui attend une décision ou un contrôle, par
//     rubrique, avec la personne qui décide et le lien vers l'écran concerné.
//   • Règlements reçus : encaissements des factures clients et règlements hors
//     caisse validés, sur une période, par mode, avec export.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { Erreur, fmtCompta, fmtDate } from '@/pages/comptabilite/commun';
import { exporterExcel } from '@/lib/export';

const m = (v) => fmtCompta(v, { zero: '0' });

export function TableauControlesPage() {
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState('');
  const charger = () => { setD(null); api.get('/finance/controles/tableau').then((r) => (r?.error ? setErreur(r.error) : setD(r))); };
  useEffect(() => { charger(); }, []);
  const groupes = useMemo(() => {
    const g = new Map();
    for (const l of d?.lignes || []) { if (!g.has(l.groupe)) g.set(l.groupe, []); g.get(l.groupe).push(l); }
    return [...g.entries()];
  }, [d]);
  return (
    <div className="cm-page fin-page">
      <div className="cm-entete">
        <div>
          <h2>Tableau des contrôles</h2>
          <p>Tout ce qui attend une validation ou un contrôle et qui relève de vos droits. Cliquez sur une ligne pour ouvrir l'écran où l'on décide.</p>
        </div>
        <button type="button" className="cm-btn cm-secondaire" onClick={charger}>↻ Actualiser</button>
      </div>
      <Erreur message={erreur} />
      {!d && !erreur && <div className="loading-msg">Chargement…</div>}
      {d && (d.lignes.length === 0 ? (
        <div className="fin-vide"><div className="fin-vide-icone" aria-hidden="true">✅</div><h3>Rien n'attend</h3>
          <p>Aucune validation ni aucun contrôle en attente dans votre périmètre.</p></div>
      ) : groupes.map(([groupe, lignes]) => (
        <section key={groupe} className="fin-ctrl-groupe">
          <h3>{groupe}</h3>
          <div className="fin-ctrl-liste">
            {lignes.map((l) => (
              <Link key={l.cle} to={l.lien} className="fin-ctrl-tuile">
                <span className="fin-ctrl-nombre">{l.nombre}</span>
                <span className="fin-ctrl-texte"><b>{l.libelle}</b>
                  {l.montant !== null && <span>{m(l.montant)} FCFA</span>}
                  <span>Décide : {l.decide}</span></span>
              </Link>
            ))}
          </div>
        </section>
      )))}
      {d && <p className="cm-sous">Calculé le {new Date(d.calcule_le).toLocaleString('fr-FR')}.</p>}
    </div>
  );
}

export function ReglementsRecusPage() {
  const an = new Date().getFullYear();
  const [f, setF] = useState({ du: `${an}-01-01`, au: new Date().toISOString().slice(0, 10), tiers_id: '' });
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState('');
  useEffect(() => {
    setErreur('');
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api.get(`/finance/ventes/reglements-recus?${q}`).then((r) => (r?.error ? setErreur(r.error) : setD(r)));
  }, [f]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const exporter = () => exporterExcel(`reglements-recus-${f.du}-${f.au}`,
    ['Date', 'Client', 'Facture', 'Mode', 'Pièce', 'Référence', 'Montant'],
    d.lignes.map((l) => [l.date, l.client, l.facture, l.mode_libelle, l.piece, l.reference, l.montant]),
    [`Règlements reçus du ${f.du} au ${f.au}`, `Total : ${d.total}`]);
  return (
    <div className="cm-page fin-page">
      <div className="cm-entete">
        <div>
          <h2>Règlements reçus</h2>
          <p>Encaissements des factures clients par la caisse ou la banque, et règlements hors caisse validés par le directeur.</p>
        </div>
        {d?.lignes.length > 0 && <button type="button" className="cm-btn cm-secondaire" onClick={exporter}>⬇ Excel</button>}
      </div>
      <div className="fin-filtres">
        <label>Du <input type="date" value={f.du} onChange={set('du')} /></label>
        <label>au <input type="date" value={f.au} onChange={set('au')} /></label>
        <select value={f.tiers_id} onChange={set('tiers_id')} aria-label="Client">
          <option value="">Tous les clients</option>
          {(d?.clients || []).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
        </select>
      </div>
      <Erreur message={erreur} />
      {!d && !erreur && <div className="loading-msg">Chargement…</div>}
      {d && (<>
        <div className="fin-totaux-cartes">
          <div className="fin-carte fin-chiffre"><span className="cm-sous">Total reçu</span><b>{m(d.total)}</b><span className="cm-sous">{d.lignes.length} règlement{d.lignes.length > 1 ? 's' : ''}</span></div>
          {Object.entries(d.par_mode).map(([mode, v]) => (
            <div key={mode} className="fin-carte fin-chiffre"><span className="cm-sous">{mode}</span><b>{m(v)}</b></div>))}
        </div>
        {d.lignes.length === 0 ? (
          <div className="fin-vide"><div className="fin-vide-icone" aria-hidden="true">💳</div><h3>Aucun règlement sur la période</h3></div>
        ) : (
          <div className="cm-table-wrap">
            <table className="cm-table fin-table">
              <thead><tr><th>Date</th><th>Client</th><th>Facture</th><th>Mode</th><th>Pièce / référence</th><th className="fin-num">Montant</th></tr></thead>
              <tbody>{d.lignes.map((l, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <tr key={i}><td>{fmtDate(l.date)}</td><td>{l.client}</td>
                  <td className="fin-mono"><Link to={`/finance/ventes/${l.facture_id}`}>{l.facture}</Link></td>
                  <td>{l.mode_libelle}</td><td>{l.piece}{l.reference && <div className="cm-sous">{l.reference}</div>}</td>
                  <td className="fin-num">{m(l.montant)}</td></tr>))}</tbody>
              <tfoot><tr><td colSpan={5}><b>Total</b></td><td className="fin-num"><b>{m(d.total)}</b></td></tr></tfoot>
            </table>
          </div>
        )}
      </>)}
    </div>
  );
}
