// NJ COMMERCIAL — État du stock : quantité, coût moyen et valeur par article et par magasin.
// Tout vient des mouvements validés ; rien n'est saisi ici.
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import StockDocFormPage from '@/pages/commercial/StockDocFormPage';
import { Entete, useListe, useDiffere, fmtMontant, fmtQte } from '@/components/commercial/ui';
import { TYPES_STOCK, SAISIE_STOCK } from '@/components/commercial/stock';

export default function StockEtatPage() {
  const { can } = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // Saisie ouverte sur place (?saisie=entree…) : le bouton Retour du navigateur ramène à l'état.
  const saisie = TYPES_STOCK[params.get('saisie')] && can(SAISIE_STOCK[params.get('saisie')]) ? params.get('saisie') : '';
  const ouvrir = (k) => setParams((p) => { const n = new URLSearchParams(p); if (k) n.set('saisie', k); else n.delete('saisie'); return n; });
  const [q, setQ] = useState('');
  const [magasin, setMagasin] = useState(params.get('magasin_id') || '');
  const [famille, setFamille] = useState('');
  const [filtre, setFiltre] = useState('');
  const qd = useDiffere(q);
  const { donnees: magasins } = useListe('/commercial/magasins?perimetre=1');
  const { donnees: familles } = useListe('/commercial/familles');
  const { donnees, erreur, recharger } = useListe(`/commercial/stock/etat?q=${encodeURIComponent(qd)}&magasin_id=${magasin}&famille_id=${famille}`
    + `${filtre === 'alertes' ? '&alertes=1' : ''}${filtre === 'a_valoriser' ? '&a_valoriser=1' : ''}`);
  const liste = (donnees || []).filter((l) => filtre || l.quantite !== 0 || l.a_valoriser);
  const valeurs = can('com.stock.valorisation');
  const total = liste.reduce((t, l) => t + (l.valeur || 0), 0);
  return (
    <div className="cm-page">
      <Entete titre="État du stock"
        description="Quantités et valeurs calculées à partir des seuls mouvements validés, au coût moyen (CMUP) ou premier entré, premier sorti (FIFO) selon l'article.">
        {Object.entries(TYPES_STOCK).filter(([k]) => can(SAISIE_STOCK[k])).map(([k, t], i) => (
          <button key={k} type="button" className={'cm-btn ' + ((saisie ? saisie === k : i === 0) ? 'cm-primaire' : 'cm-secondaire')}
            aria-pressed={saisie === k}
            onClick={() => { if (saisie && saisie !== k && !window.confirm('Abandonner la saisie en cours ?')) return; ouvrir(k); }}>{t.libelle}</button>
        ))}
      </Entete>
      {saisie ? (
        <StockDocFormPage key={saisie} integre typeInitial={saisie} onFermer={() => ouvrir('')}
          onFini={() => { ouvrir(''); recharger(); }} />
      ) : (<>
      <div className="cm-outils">
        <input className="cm-recherche" type="search" placeholder="Référence ou désignation…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher un article" />
        <select className="cm-select" value={magasin} onChange={(e) => setMagasin(e.target.value)} aria-label="Magasin">
          <option value="">Tous les magasins</option>
          {(magasins || []).map((m) => <option key={m.id} value={m.id}>{m.code} — {m.nom}</option>)}
        </select>
        <select className="cm-select" value={famille} onChange={(e) => setFamille(e.target.value)} aria-label="Famille">
          <option value="">Toutes les familles</option>
          {(familles || []).map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
        </select>
        <select className="cm-select" value={filtre} onChange={(e) => setFiltre(e.target.value)} aria-label="Filtre">
          <option value="">Articles en stock</option>
          <option value="alertes">Sous le seuil d'alerte</option>
          <option value="a_valoriser">Sans coût (à valoriser)</option>
        </select>
        <span className="cm-compteur">{donnees ? `${liste.length} ligne${liste.length > 1 ? 's' : ''}${valeurs ? ` · ${fmtMontant(Math.round(total))}` : ''}` : ''}</span>
      </div>
      {erreur && <div className="cm-erreur">{erreur}</div>}
      <div className="cm-table-wrap">
        <table className="cm-table" style={{ minWidth: 820 }}>
          <thead><tr><th>Article</th><th>Magasin</th><th className="cm-num">Quantité</th>{valeurs && <><th className="cm-num">Coût unitaire</th><th className="cm-num">Valeur</th></>}<th>Méthode</th><th>État</th></tr></thead>
          <tbody>
            {!donnees ? <tr><td colSpan={7} className="cm-vide">Chargement…</td></tr>
              : liste.length === 0 ? <tr><td colSpan={7} className="cm-vide"><strong>Aucun stock</strong>Le stock naît du stock d'ouverture (fiche article) puis des documents de stock validés.</td></tr>
                : liste.map((l) => (
                  <tr key={`${l.article_id}-${l.magasin_id}`} className={can('com.stock.journal') ? 'cm-cliquable' : ''} tabIndex={0}
                    onClick={() => can('com.stock.journal') && navigate(`/commercial/stock/mouvements?article_id=${l.article_id}&magasin_id=${l.magasin_id}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && can('com.stock.journal')) navigate(`/commercial/stock/mouvements?article_id=${l.article_id}&magasin_id=${l.magasin_id}`); }}>
                    <td><strong>{l.designation}</strong><span className="cm-sous">{l.reference} · {l.famille_nom}</span></td>
                    <td>{l.magasin_code}<span className="cm-sous">{l.agence_code}</span></td>
                    <td className="cm-num"><strong>{fmtQte(l.quantite)}</strong> {l.unite}</td>
                    {valeurs && <td className="cm-num">{l.a_valoriser ? '—' : fmtMontant(l.cmup === null ? null : Math.round(l.cmup * 100) / 100, '')}</td>}
                    {valeurs && <td className="cm-num">{fmtMontant(l.valeur, '')}</td>}
                    <td>{l.methode_valorisation === 'fifo' ? 'FIFO' : 'CMUP'}</td>
                    <td>
                      {l.quantite < 0 && <span className="cm-pastille cm-rouge">Négatif</span>}
                      {l.sous_seuil && l.quantite >= 0 && <span className="cm-pastille cm-alerte" title={`Seuil : ${fmtQte(l.seuil_alerte)} ${l.unite}`}>Sous le seuil</span>}
                      {l.a_valoriser && <span className="cm-pastille cm-info" title="Une partie du stock n'a pas de coût : complétez le coût du stock d'ouverture">À valoriser</span>}
                      {!l.sous_seuil && !l.a_valoriser && l.quantite >= 0 && <span className="cm-sous" style={{ marginTop: 0 }}>Normal</span>}
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      <p className="cm-aide" style={{ marginTop: 10 }}>Cliquez sur une ligne pour voir ses mouvements. « À valoriser » : stock d'ouverture saisi sans coût, compté pour 0 dans la valeur.</p>
      </>)}
    </div>
  );
}
