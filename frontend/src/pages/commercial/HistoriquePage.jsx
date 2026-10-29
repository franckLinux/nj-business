// NJ COMMERCIAL — journal des achats : décisions du circuit et opérations tracées
// (demandes et bons). Lecture seule : rien ici ne se modifie ni ne s'efface.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Entete, useListe, useDiffere } from '@/components/commercial/ui';
import { dateFr } from '@/components/commercial/achats';

const debutAnnee = () => `${new Date().getFullYear()}-01-01`;
const classe = (h) => (h.genre === 'decision'
  ? ({ approuvee: 'cm-ok', rejetee: 'cm-rouge', annulee: 'cm-rouge', renvoyee: 'cm-info' }[h.action] || 'cm-off')
  : ({ COM_BC_EMISSION: 'cm-ok', COM_BC_ANNULATION: 'cm-rouge', COM_BC_REVALIDATION: 'cm-alerte' }[h.action] || 'cm-off'));

export default function HistoriquePage() {
  const [du, setDu] = useState(debutAnnee());
  const [au, setAu] = useState('');
  const [q, setQ] = useState('');
  const qd = useDiffere(q);
  const { donnees, erreur } = useListe(`/commercial/historique?du=${du}&au=${au}&q=${encodeURIComponent(qd)}`);
  const liste = donnees || [];
  return (
    <div className="cm-page">
      <Entete titre="Historique des achats" description="Qui a fait quoi, et quand : soumissions, autorisations, rejets, préparation, émission et annulation des bons, pièces jointes. Les 500 événements les plus récents de la période." />
      <div className="cm-outils">
        <input className="cm-recherche" type="search" placeholder="Numéro, utilisateur, motif…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher" />
        <input className="cm-select" type="date" value={du} onChange={(e) => setDu(e.target.value)} aria-label="Du" title="Du" />
        <input className="cm-select" type="date" value={au} onChange={(e) => setAu(e.target.value)} aria-label="Au" title="Au" />
        <span className="cm-compteur">{donnees ? `${liste.length} événement${liste.length > 1 ? 's' : ''}` : ''}</span>
      </div>
      {erreur && <div className="cm-erreur">{erreur}</div>}
      <div className="cm-table-wrap">
        <table className="cm-table" style={{ minWidth: 780 }}>
          <thead><tr><th>Date</th><th>Événement</th><th>Document</th><th>Par</th><th>Détail</th></tr></thead>
          <tbody>
            {!donnees ? <tr><td colSpan={5} className="cm-vide">Chargement…</td></tr>
              : liste.length === 0 ? <tr><td colSpan={5} className="cm-vide"><strong>Aucun événement</strong>Rien n'a été enregistré sur cette période.</td></tr>
                : liste.map((h, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: 'nowrap' }}>{dateFr(h.le, true)}</td>
                    <td><span className={`cm-pastille ${classe(h)}`}>{h.libelle}</span></td>
                    <td>{h.objet_id && h.objet ? (
                      <Link to={h.objet_type === 'demande' ? `/commercial/demandes/${h.objet_id}` : `/commercial/bons/${h.objet_id}`}>
                        {h.objet.startsWith('BROUILLON') ? 'Bon (brouillon)' : h.objet}
                      </Link>
                    ) : <span className="cm-sous">supprimé</span>}</td>
                    <td>{h.par_nom || 'système'}</td>
                    <td style={{ maxWidth: 320 }}><span style={{ wordBreak: 'break-word' }}>{h.detail && !h.detail.startsWith('BROUILLON') ? h.detail : ''}</span></td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
