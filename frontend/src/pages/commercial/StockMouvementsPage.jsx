// NJ COMMERCIAL — Contrôles : journal des mouvements de stock et valorisation par magasin.
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Entete, useListe, useDiffere, fmtMontant, fmtQte } from '@/components/commercial/ui';
import { dateFr } from '@/components/commercial/achats';
import { MOUVEMENTS } from '@/components/commercial/stock';

export function StockMouvementsPage() {
  const [params] = useSearchParams();
  const [q, setQ] = useState('');
  const [magasin, setMagasin] = useState(params.get('magasin_id') || '');
  const [type, setType] = useState('');
  const [du, setDu] = useState('');
  const [au, setAu] = useState('');
  const article = params.get('article_id') || '';
  const qd = useDiffere(q);
  const { donnees: magasins } = useListe('/commercial/magasins?perimetre=1');
  const { donnees, erreur } = useListe(`/commercial/stock/mouvements?article_id=${article}&magasin_id=${magasin}&type=${type}&du=${du}&au=${au}&q=${encodeURIComponent(qd)}`);
  const liste = donnees || [];
  return (
    <div className="cm-page">
      <Entete titre="Mouvements de stock"
        description="Journal de chaque entrée et sortie, avec son coût. Rien ne s'y efface : un document annulé laisse ses mouvements, marqués « annulés »." />
      {article && liste[0] && (
        <div className="cm-note">Article : <strong>{liste[0].reference} — {liste[0].designation}</strong> · <Link to="/commercial/stock/mouvements">voir tous les articles</Link></div>
      )}
      <div className="cm-outils">
        <input className="cm-recherche" type="search" placeholder="Article ou numéro de document…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher" />
        <select className="cm-select" value={magasin} onChange={(e) => setMagasin(e.target.value)} aria-label="Magasin">
          <option value="">Tous les magasins</option>
          {(magasins || []).map((m) => <option key={m.id} value={m.id}>{m.code} — {m.nom}</option>)}
        </select>
        <select className="cm-select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type de mouvement">
          <option value="">Tous les mouvements</option>
          {Object.entries(MOUVEMENTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input className="cm-select" type="date" value={du} onChange={(e) => setDu(e.target.value)} aria-label="Du" title="Du" />
        <input className="cm-select" type="date" value={au} onChange={(e) => setAu(e.target.value)} aria-label="Au" title="Au" />
        <span className="cm-compteur">{donnees ? `${liste.length} mouvement${liste.length > 1 ? 's' : ''}` : ''}</span>
      </div>
      {erreur && <div className="cm-erreur">{erreur}</div>}
      <div className="cm-table-wrap">
        <table className="cm-table" style={{ minWidth: 900 }}>
          <thead><tr><th>Date</th><th>Mouvement</th><th>Article</th><th>Magasin</th><th className="cm-num">Quantité</th><th className="cm-num">Coût unitaire</th><th className="cm-num">Valeur</th><th>Document</th></tr></thead>
          <tbody>
            {!donnees ? <tr><td colSpan={8} className="cm-vide">Chargement…</td></tr>
              : liste.length === 0 ? <tr><td colSpan={8} className="cm-vide"><strong>Aucun mouvement</strong>Aucun mouvement pour ces critères.</td></tr>
                : liste.map((m) => (
                  <tr key={m.id} className={m.annule ? 'cm-retiree' : ''}>
                    <td>{dateFr(m.date_mouvement)}</td>
                    <td>{m.libelle}{m.annule && <span className="cm-pastille cm-rouge" style={{ marginLeft: 6 }}>Annulé</span>}</td>
                    <td><strong>{m.designation}</strong><span className="cm-sous">{m.reference}</span></td>
                    <td>{m.magasin_code}</td>
                    <td className="cm-num" style={{ color: m.sens > 0 ? '#047857' : '#b91c1c' }}>{m.sens > 0 ? '+' : '−'}{fmtQte(m.quantite)} {m.unite}</td>
                    <td className="cm-num">{m.cout_unitaire === null ? <span className="cm-pastille cm-info">à valoriser</span> : fmtMontant(Math.round(m.cout_unitaire * 100) / 100, '')}</td>
                    <td className="cm-num">{fmtMontant(m.valeur, '')}</td>
                    <td>
                      {m.document_numero ? <Link to={`/commercial/stock/documents/${m.document_id}`} onClick={(e) => e.stopPropagation()}>{m.document_numero}</Link> : (m.piece || '—')}
                      {m.par_nom && <span className="cm-sous">{m.par_nom}</span>}
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function StockValorisationPage() {
  const navigate = useNavigate();
  const { donnees, erreur } = useListe('/commercial/stock/valorisation');
  const v = donnees && !Array.isArray(donnees) ? donnees : null;
  return (
    <div className="cm-page">
      <Entete titre="Valorisation du stock"
        description="Valeur du stock par magasin, au coût moyen pondéré ou au FIFO selon les articles. Ces montants ne génèrent aucune écriture comptable." />
      {erreur && <div className="cm-erreur">{erreur}</div>}
      {v && (
        <div className="cm-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
          <div className="cm-section" style={{ margin: 0 }}><span className="cm-sous" style={{ marginTop: 0 }}>Valeur totale du stock</span><strong style={{ fontSize: 22 }}>{fmtMontant(v.total)}</strong></div>
          <div className="cm-section" style={{ margin: 0 }}><span className="cm-sous" style={{ marginTop: 0 }}>Magasins</span><strong style={{ fontSize: 22 }}>{v.magasins.length}</strong></div>
          <div className="cm-section" style={{ margin: 0 }}><span className="cm-sous" style={{ marginTop: 0 }}>Lignes sans coût</span><strong style={{ fontSize: 22, color: v.a_valoriser ? '#b45309' : undefined }}>{v.a_valoriser}</strong></div>
        </div>
      )}
      <div className="cm-table-wrap">
        <table className="cm-table">
          <thead><tr><th>Magasin</th><th>Agence</th><th className="cm-num">Articles en stock</th><th className="cm-num">Valeur</th><th className="cm-num">Part</th><th>À valoriser</th></tr></thead>
          <tbody>
            {!donnees ? <tr><td colSpan={6} className="cm-vide">Chargement…</td></tr>
              : !v?.magasins.length ? <tr><td colSpan={6} className="cm-vide"><strong>Aucun stock</strong>Aucun stock enregistré pour l'instant.</td></tr>
                : v.magasins.map((m) => (
                  <tr key={m.magasin_id} className="cm-cliquable" tabIndex={0} onClick={() => navigate(`/commercial/stock?magasin_id=${m.magasin_id}`)}>
                    <td><strong>{m.magasin_code}</strong><span className="cm-sous">{m.magasin_nom}</span></td>
                    <td>{m.agence_code}</td>
                    <td className="cm-num">{m.articles}</td>
                    <td className="cm-num"><strong>{fmtMontant(m.valeur, '')}</strong></td>
                    <td className="cm-num">{v.total ? `${Math.round((m.valeur / v.total) * 1000) / 10} %` : '—'}</td>
                    <td>{m.a_valoriser ? <span className="cm-pastille cm-info">{m.a_valoriser} ligne{m.a_valoriser > 1 ? 's' : ''}</span> : '—'}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      <p className="cm-aide" style={{ marginTop: 10 }}>« À valoriser » : stock d'ouverture saisi sans coût. Complétez son coût depuis la fiche article ; la valorisation est alors recalculée.</p>
    </div>
  );
}
