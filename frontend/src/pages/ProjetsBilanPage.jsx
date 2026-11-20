import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import { api } from '@/lib/api';
import { exporterExcel } from '@/lib/export';
import { printBilanProjets } from '@/lib/print';
import ProjetsNav from '@/components/projets/ProjetsNav';
import { dateFr, fcfa, pct } from './ProjetsPage';

// Bilan des activités de projet (070) : activités validées / activités en
// attente de justification. Chiffres relus dans le journal et les
// justificatifs validés ; le périmètre est celui de l'utilisateur.
export default function ProjetsBilanPage() {
  const { devise, entite, tenantLabel } = useApp();
  const [bilan, setBilan] = useState(null);
  const [erreur, setErreur] = useState('');
  const [projet, setProjet] = useState('');
  useEffect(() => {
    api.get('/projets/bilan').then((r) => { if (r.error) setErreur(r.error); else setBilan(r); });
  }, []);

  const projets = useMemo(() => {
    const m = new Map();
    [...(bilan?.validees || []), ...(bilan?.en_attente || [])].forEach((l) => m.set(l.projet_id, l.projet_nom));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [bilan]);
  const filtrer = (l) => !projet || String(l.projet_id) === String(projet);
  const vue = useMemo(() => {
    if (!bilan) return null;
    const validees = bilan.validees.filter(filtrer);
    const enAttente = bilan.en_attente.filter(filtrer);
    const toutes = [...validees, ...enAttente];
    const s = (k) => toutes.reduce((t, l) => t + l[k], 0);
    return {
      validees, en_attente: enAttente,
      totaux: { alloue: s('alloue'), justifie: s('justifie'), rembourse: s('rembourse'), en_attente: s('en_attente'), a_controler: s('a_controler') },
    };
  }, [bilan, projet]);   // eslint-disable-line react-hooks/exhaustive-deps
  const nomProjet = projets.find(([id]) => String(id) === String(projet))?.[1];

  const exporter = () => {
    const lignes = [
      ...vue.en_attente.map((l) => ['En attente de justification', l.projet_nom, l.activite_nom, l.responsable_nom || '', l.alloue, l.justifie, l.rembourse, l.en_attente, l.a_controler, l.jours ?? '', l.derniere_remise ? dateFr(l.derniere_remise) : '']),
      ...vue.validees.map((l) => ['Validée', l.projet_nom, l.activite_nom, l.responsable_nom || '', l.alloue, l.justifie, l.rembourse, 0, l.a_controler, '', l.derniere_remise ? dateFr(l.derniere_remise) : '']),
    ];
    exporterExcel(`Bilan_activites_${nomProjet || 'tous_projets'}`,
      ['Statut', 'Projet', 'Activité', 'Responsable', 'Remis', 'Justifié', 'Remboursé', 'En attente', 'À contrôler', 'Jours depuis la dernière remise', 'Dernière remise'],
      lignes, [`Bilan des activités — ${nomProjet || 'tous les projets'}`, `Au ${new Date().toLocaleDateString('fr-FR')} (${devise})`]);
  };

  const Bloc = ({ titre, liste, attente, couleur, vide }) => (
    <div className="pj-carte">
      <div className="pj-carte-t" style={{ borderTop: `3px solid ${couleur}` }}>
        {titre} <span className="pj-pastille" style={{ background: couleur }}>{liste.length}</span>
        <small>{fcfa(liste.reduce((s, l) => s + (attente ? l.en_attente : l.alloue), 0))} {devise} {attente ? 'à justifier' : 'remis et justifiés'}</small>
      </div>
      {liste.length === 0 ? <div className="pj-vide-mini">{vide}</div> : (
        <div className="table-wrap">
          <table className="pj-table">
            <thead>
              <tr>
                <th>Activité</th><th>Responsable</th><th className="n">Remis</th><th className="n">Justifié</th>
                {attente ? <><th className="n">En attente</th><th>Avancement</th><th className="n">Depuis</th></> : <th className="n">Remboursé</th>}
              </tr>
            </thead>
            <tbody>
              {liste.map((l) => {
                const taux = pct(l.justifie + l.rembourse, l.alloue);
                return (
                  <tr key={l.globale ? `g${l.projet_id}` : l.activite_id}>
                    <td>
                      <Link to={l.globale ? `/projets/${l.projet_id}` : `/projets/${l.projet_id}?onglet=justificatifs&activite=${l.activite_id}`} className="pj-lien-l">
                        <strong>{l.globale ? '◆ ' : ''}{l.activite_nom}</strong>
                      </Link>
                      <div className="pj-muted pj-petit">{l.projet_nom}{l.sur_global ? ' · dépenses sur la remise globale' : ''}</div>
                    </td>
                    <td>{l.responsable_nom || <span className="pj-muted">à désigner</span>}</td>
                    <td className="n">{fcfa(l.alloue)}</td>
                    <td className="n" style={{ color: 'var(--projet-justifie)' }}>{fcfa(l.justifie)}</td>
                    {attente ? (
                      <>
                        <td className="n"><b style={{ color: 'var(--projet-attente)' }}>{fcfa(l.en_attente)}</b>
                          {l.a_controler > 0 && <div className="pj-muted pj-petit">dont {fcfa(l.a_controler)} déposés à contrôler</div>}</td>
                        <td style={{ minWidth: 120 }}><div className="pj-jauge"><span style={{ width: `${taux}%`, background: 'var(--projet-justifie)' }} /></div><div className="pj-muted pj-petit">{taux} % justifié</div></td>
                        <td className={`n ${l.jours > 30 ? 'pj-baisse' : 'pj-muted'}`}>{l.jours ?? '—'} j</td>
                      </>
                    ) : <td className="n">{fcfa(l.rembourse)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div className="page-content pj-page">
      <div className="pj-tete">
        <div>
          <h2>Bilan des activités</h2>
          <p>Une activité est <b>validée</b> quand tout l'argent remis à son responsable est justifié par des pièces validées ou remboursé. Les autres restent <b>en attente de justification</b>.</p>
        </div>
        {vue && (
          <div className="pj-tete-actions">
            <select className="pj-select" value={projet} onChange={(e) => setProjet(e.target.value)} aria-label="Projet">
              <option value="">Tous les projets</option>
              {projets.map(([id, nom]) => <option key={id} value={id}>{nom}</option>)}
            </select>
            <button type="button" className="btn-ghost" onClick={exporter}>⬇ Excel</button>
            <button type="button" className="btn-ghost" onClick={() => printBilanProjets({ bilan: vue, projetNom: nomProjet, entite, tenantNom: tenantLabel, devise })}>🖨 PDF</button>
          </div>
        )}
      </div>
      <ProjetsNav />
      {erreur ? <div className="alert-err">{erreur}</div> : !vue ? <div className="loading-msg">Chargement du bilan…</div> : (
        <>
          <div className="pj-kpis pj-kpis-4">
            {[
              ['Remis aux responsables', vue.totaux.alloue, 'var(--projet-alloue)', `${vue.validees.length + vue.en_attente.length} activité(s) financée(s)`],
              ['Justifié', vue.totaux.justifie, 'var(--projet-justifie)', `${pct(vue.totaux.justifie, vue.totaux.alloue)} % du remis`],
              ['Remboursé', vue.totaux.rembourse, '#64748b', 'reliquats rendus au journal'],
              ['En attente de justification', vue.totaux.en_attente, 'var(--projet-attente)', `${fcfa(vue.totaux.a_controler)} déposés, à contrôler`],
            ].map(([t, v, c, s]) => (
              <div key={t} className="pj-kpi" style={{ borderTopColor: c }}>
                <div className="pj-kpi-t">{t}</div>
                <div className="pj-kpi-v" style={{ color: c }}>{fcfa(v)} <small>{devise}</small></div>
                <div className="pj-kpi-s">{s}</div>
              </div>
            ))}
          </div>
          <div className="pj-bilan">
            <Bloc titre="En attente de justification" liste={vue.en_attente} attente couleur="var(--projet-attente)" vide="✓ Aucune activité en attente de justification." />
            <Bloc titre="Activités validées" liste={vue.validees} couleur="var(--projet-recu)" vide="Aucune activité entièrement justifiée pour l'instant." />
          </div>
        </>
      )}
    </div>
  );
}
