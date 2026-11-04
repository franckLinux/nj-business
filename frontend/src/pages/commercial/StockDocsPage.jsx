// NJ COMMERCIAL — liste des documents de stock d'un type (entrées, sorties, transferts,
// inventaires) ou, en mode « validation », de tous les documents qui attendent un valideur.
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import { Entete, useListe, useDiffere } from '@/components/commercial/ui';
import { dateFr } from '@/components/commercial/achats';
import { TYPES_STOCK, TYPE_PAR_ROUTE, STATUTS_STOCK, StatutStock, SAISIE_STOCK } from '@/components/commercial/stock';
import StockDocFormPage from '@/pages/commercial/StockDocFormPage';

export default function StockDocsPage({ validation = false }) {
  const { route } = useParams();
  const type = validation ? '' : TYPE_PAR_ROUTE[route] || 'entree';
  const { can, user } = useApp();
  const navigate = useNavigate();
  const [statut, setStatut] = useState(validation ? 'a_valider' : '');
  const [q, setQ] = useState('');
  const [du, setDu] = useState('');
  const [au, setAu] = useState('');
  const qd = useDiffere(q);
  // Saisie ouverte sur place (?saisie=1) : Fermer, la soumission ou le bouton Retour ramènent à la liste.
  const [params, setParams] = useSearchParams();
  const saisie = !validation && params.get('saisie') === '1' && can(SAISIE_STOCK[type]);
  const ouvrir = (oui) => setParams((p) => { const n = new URLSearchParams(p); if (oui) n.set('saisie', '1'); else n.delete('saisie'); return n; });
  const { donnees, erreur, recharger } = useListe(`/commercial/stock/documents?type=${type}&statut=${statut}&q=${encodeURIComponent(qd)}&du=${du}&au=${au}`);
  const liste = donnees || [];
  const t = TYPES_STOCK[type];
  return (
    <div className="cm-page">
      <Entete titre={validation ? 'Validation des stocks' : t.pluriel}
        description={validation
          ? 'Documents soumis qui attendent une validation. Le stock ne bouge qu\'à la validation, et jamais par la personne qui a saisi le document.'
          : t.aide}>
        {!validation && !saisie && can(SAISIE_STOCK[type]) && (
          <button type="button" className="cm-btn cm-primaire" onClick={() => ouvrir(true)}>+ {t.libelle}</button>
        )}
      </Entete>
      {saisie ? (
        <StockDocFormPage key={type} integre typeInitial={type} retour={t.pluriel} onFermer={() => ouvrir(false)}
          onFini={() => { ouvrir(false); recharger(); }} />
      ) : (<>
      <div className="cm-outils">
        <input className="cm-recherche" type="search" placeholder="Numéro, motif, article…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher un document" />
        <select className="cm-select" value={statut} onChange={(e) => setStatut(e.target.value)} aria-label="Statut">
          <option value="">Tous les statuts</option>
          {Object.entries(STATUTS_STOCK).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input className="cm-select" type="date" value={du} onChange={(e) => setDu(e.target.value)} aria-label="Du" title="Du" />
        <input className="cm-select" type="date" value={au} onChange={(e) => setAu(e.target.value)} aria-label="Au" title="Au" />
        <span className="cm-compteur">{donnees ? `${liste.length} document${liste.length > 1 ? 's' : ''}` : ''}</span>
      </div>
      {erreur && <div className="cm-erreur">{erreur}</div>}
      <div className="cm-table-wrap">
        <table className="cm-table" style={{ minWidth: 760 }}>
          <thead><tr><th>Document</th><th>Date</th><th>Magasin</th><th>Motif</th><th>Saisi par</th><th>Statut</th></tr></thead>
          <tbody>
            {!donnees ? <tr><td colSpan={6} className="cm-vide">Chargement…</td></tr>
              : liste.length === 0 ? <tr><td colSpan={6} className="cm-vide"><strong>Aucun document</strong>{validation ? 'Rien n\'attend de validation.' : 'Aucun document de ce type pour ces critères.'}</td></tr>
                : liste.map((d) => (
                  <tr key={d.id} className="cm-cliquable" tabIndex={0} onClick={() => navigate(`/commercial/stock/documents/${d.id}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/commercial/stock/documents/${d.id}`); }}>
                    <td><span className="cm-code">{d.numero}</span><span className="cm-sous">{validation ? `${d.type_libelle} · ` : ''}{d.nb_lignes} article{d.nb_lignes > 1 ? 's' : ''}</span></td>
                    <td>{dateFr(d.date_document)}</td>
                    <td>{d.magasin_code}{d.magasin_dest_code && <span className="cm-sous">→ {d.magasin_dest_code}</span>}</td>
                    <td>{d.motif || '—'}</td>
                    <td>{d.cree_par_nom}{validation && d.cree_par_nom === user?.username && <span className="cm-sous">vous : un autre valide</span>}</td>
                    <td><StatutStock statut={d.statut} /></td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      </>)}
    </div>
  );
}
