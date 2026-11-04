// NJ COMMERCIAL — saisie d'un document de stock (entrée, sortie, transfert, inventaire).
// Enregistrer ne touche pas au stock : seule la validation, par une personne autorisée, le fait bouger.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { Section, Champ, fmtQte, fmtMontant } from '@/components/commercial/ui';
import { TYPES_STOCK, lireNombre } from '@/components/commercial/stock';

const aujourdhui = () => new Date().toISOString().slice(0, 10);
const virgule = (n) => (n === null || n === undefined ? '' : String(n).replace('.', ','));

// `integre` : saisie ouverte directement dans la liste de son type (sans changer de page) ;
// `onFermer` revient à la liste, `onFini(document)` après enregistrement ou soumission.
export default function StockDocFormPage({ integre = false, typeInitial, retour, onFermer, onFini }) {
  const { id: idRoute } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [id, setId] = useState(integre ? undefined : idRoute);
  const demande = typeInitial || params.get('type');
  const [type, setType] = useState(TYPES_STOCK[demande] ? demande : 'entree');
  const [refs, setRefs] = useState(null);
  const [f, setF] = useState(null);
  const [lignes, setLignes] = useState([]);
  const [stock, setStock] = useState({});      // article → quantité dans le magasin de départ
  const [numero, setNumero] = useState('');
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    (async () => {
      const [ar, ma] = await Promise.all([api.get('/commercial/articles?actifs=1'), api.get('/commercial/magasins?actifs=1&perimetre=1')]);
      const r = { articles: ar?.error ? [] : ar.filter((a) => a.suivi_stock !== false), magasins: ma?.error ? [] : ma };
      setRefs(r);
      if (id) {
        const d = await api.get(`/commercial/stock/documents/${id}`);
        if (d?.error) { setErreur(d.error); return; }
        if (!d.droits.modifier) { navigate(`/commercial/stock/documents/${id}`, { replace: true }); return; }
        setType(d.type); setNumero(d.numero);
        setF({ magasin_id: String(d.magasin_id), magasin_dest_id: d.magasin_dest_id ? String(d.magasin_dest_id) : '', date_document: String(d.date_document).slice(0, 10),
          motif: d.motif, observations: d.observations });
        setLignes(d.lignes.map((l) => ({ article_id: l.article_id, unite_id: l.unite_id ? String(l.unite_id) : '', quantite: virgule(l.quantite),
          cout_unitaire: virgule(l.cout_unitaire), quantite_comptee: virgule(l.quantite_comptee), observation: l.observation || '',
          designation: l.designation, reference: l.reference, unite: l.unite_stock, theorique: l.stock_actuel })));
      } else {
        setF({ magasin_id: r.magasins.length === 1 ? String(r.magasins[0].id) : '', magasin_dest_id: '', date_document: aujourdhui(), motif: '', observations: '' });
      }
    })();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stock du magasin de départ : affiché à titre indicatif, recontrôlé par le serveur à la validation.
  useEffect(() => {
    if (!f?.magasin_id || type === 'entree') { setStock({}); return; }
    api.get(`/commercial/stock/etat?magasin_id=${f.magasin_id}`).then((r) => {
      if (!r?.error) setStock(Object.fromEntries(r.map((l) => [l.article_id, l.quantite])));
    });
  }, [f?.magasin_id, type]);

  const t = TYPES_STOCK[type];
  const articles = refs?.articles || [];
  const article = (aid) => articles.find((a) => a.id === aid);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setLigne = (i, k, v) => setLignes((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const uniteLigne = (l) => {
    const a = article(l.article_id);
    return a?.unites?.find((u) => String(u.id) === String(l.unite_id || a.unite_stock_id)) || { code: a?.unite || l.unite, coefficient: 1 };
  };
  const qteStock = (l) => Math.round((lireNombre(l.quantite) || 0) * uniteLigne(l).coefficient * 1000) / 1000;

  const ajouter = (e) => {
    const aid = Number(e.target.value);
    e.target.value = '';
    if (!aid) return;
    if (lignes.some((l) => l.article_id === aid)) { toast('Cet article est déjà sur le document.', 'error'); return; }
    const a = article(aid);
    // Entrée : unité et prix d'achat proposés ; ailleurs : unité de stock.
    const uid = type === 'entree' ? a.unite_achat_id : a.unite_stock_id;
    setLignes((ls) => [...ls, { article_id: aid, unite_id: String(uid), quantite: type === 'inventaire' ? '' : '1',
      cout_unitaire: type === 'entree' ? virgule(a.prix_achat_indicatif) : '', quantite_comptee: '', observation: '',
      designation: a.designation, reference: a.reference, unite: a.unite }]);
  };
  const chargerInventaire = async () => {
    if (!f.magasin_id) return;
    const r = await api.get(`/commercial/stock/inventaire/articles?magasin_id=${f.magasin_id}`);
    if (r?.error) { toast(r.error, 'error'); return; }
    const deja = new Set(lignes.map((l) => l.article_id));
    const nouveaux = r.filter((a) => !deja.has(a.id)).map((a) => ({ article_id: a.id, unite_id: '', quantite: '', cout_unitaire: '', quantite_comptee: '',
      observation: '', designation: a.designation, reference: a.reference, unite: a.unite, theorique: a.theorique }));
    setLignes((ls) => [...ls, ...nouveaux]);
    toast(`${nouveaux.length} article${nouveaux.length > 1 ? 's' : ''} à compter.`, 'success');
  };

  const corps = () => ({ type, ...f, magasin_dest_id: type === 'transfert' ? f.magasin_dest_id : null,
    lignes: lignes.map((l) => ({ article_id: l.article_id, unite_id: l.unite_id || null, quantite: l.quantite, cout_unitaire: l.cout_unitaire,
      quantite_comptee: l.quantite_comptee, observation: l.observation })) });
  const enregistrer = async (soumettre) => {
    setEnCours(true); setErreur('');
    const r = id ? await api.put(`/commercial/stock/documents/${id}`, corps()) : await api.post('/commercial/stock/documents', corps());
    if (r?.error) { setEnCours(false); setErreur(r.error); return; }
    if (soumettre) {
      const s = await api.post(`/commercial/stock/documents/${r.id}/soumission`, {});
      setEnCours(false);
      if (s?.error) {
        setErreur(s.error);
        if (!id) { if (integre) { setId(r.id); setNumero(r.numero); } else navigate(`/commercial/stock/documents/${r.id}/modifier`, { replace: true }); }
        return;
      }
      toast(`${s.numero} soumis : il attend la validation d'une personne autorisée.`, 'success');
    } else {
      setEnCours(false);
      toast(`Brouillon ${r.numero} enregistré.`, 'success');
    }
    if (integre) { onFini?.(r); return; }
    navigate(`/commercial/stock/documents/${r.id}`);
  };

  if (!refs || !f) return <div className={integre ? '' : 'cm-page'}>{erreur ? <div className="cm-erreur">{erreur}</div> : <div className="loading-msg">Chargement…</div>}</div>;
  const disponibles = articles.filter((a) => !lignes.some((l) => l.article_id === a.id));
  const valeur = type === 'entree' ? lignes.reduce((s, l) => s + (lireNombre(l.quantite) || 0) * (lireNombre(l.cout_unitaire) || 0), 0) : 0;
  return (
    <div className={integre ? 'cm-saisie-integree' : 'cm-page'}>
      {integre
        ? <button type="button" className="cm-retour cm-lien" onClick={onFermer}>‹ {retour || t.pluriel}</button>
        : <Link to={id ? `/commercial/stock/documents/${id}` : `/commercial/stock/${t.route}`} className="cm-retour">‹ {id ? numero : t.pluriel}</Link>}
      <div className="cm-fiche-tete">
        <h2>{id ? `${integre ? 'Brouillon' : 'Modifier'} ${numero}` : `Nouveau : ${t.libelle.toLowerCase()}`}</h2>
        <div className="cm-actions">
          {integre && <button type="button" className="cm-btn cm-secondaire" onClick={onFermer} disabled={enCours}>Fermer</button>}
          <button type="button" className="cm-btn cm-secondaire" onClick={() => enregistrer(false)} disabled={enCours}>Enregistrer le brouillon</button>
          <button type="button" className="cm-btn cm-primaire" onClick={() => enregistrer(true)} disabled={enCours || !lignes.length}>{enCours ? 'Envoi…' : 'Soumettre pour validation'}</button>
        </div>
      </div>
      <div className="cm-note">{t.aide} Le stock ne bouge qu'à la validation.</div>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      <Section titre="Document">
        <div className="cm-grille">
          <Champ label={type === 'transfert' ? 'Magasin de départ' : 'Magasin'} requis id="sm">
            <select id="sm" value={f.magasin_id} onChange={set('magasin_id')}>
              <option value="">— Choisir —</option>
              {refs.magasins.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.nom}</option>)}
            </select>
          </Champ>
          {type === 'transfert' && (
            <Champ label="Magasin de destination" requis id="sd">
              <select id="sd" value={f.magasin_dest_id} onChange={set('magasin_dest_id')}>
                <option value="">— Choisir —</option>
                {refs.magasins.filter((m) => String(m.id) !== f.magasin_id).map((m) => <option key={m.id} value={m.id}>{m.code} — {m.nom}</option>)}
              </select>
            </Champ>
          )}
          <Champ label={type === 'inventaire' ? 'Date du comptage' : 'Date'} requis id="sdt">
            <input id="sdt" type="date" max={aujourdhui()} value={f.date_document} onChange={set('date_document')} />
          </Champ>
          <Champ label="Motif" requis={['entree', 'sortie'].includes(type)} id="smo" pleine
            aide={['entree', 'sortie'].includes(type) ? 'Obligatoire : aucun stock ne bouge sans justification.' : ''}>
            <input id="smo" value={f.motif} onChange={set('motif')} maxLength={500}
              placeholder={type === 'sortie' ? 'Ex. casse constatée, consommation du service…' : type === 'entree' ? 'Ex. don, régularisation…' : ''} />
          </Champ>
          <Champ label="Observations" id="sob" pleine><textarea id="sob" value={f.observations} onChange={set('observations')} maxLength={2000} /></Champ>
        </div>
      </Section>
      <Section titre={`Articles (${lignes.length})`}>
        {!f.magasin_id && <div className="cm-note">Choisissez d'abord le magasin.</div>}
        {lignes.length > 0 && (
          <table className="cm-lignes">
            <thead>
              <tr>
                <th>Article</th>
                {type === 'inventaire' ? <><th style={{ textAlign: 'right' }}>Théorique (actuel)</th><th style={{ textAlign: 'right' }}>Compté</th><th style={{ textAlign: 'right' }}>Écart</th></>
                  : <th style={{ textAlign: 'right' }}>Quantité</th>}
                {type === 'entree' && <th style={{ textAlign: 'right' }}>Coût unitaire</th>}
                {['sortie', 'transfert'].includes(type) && <th style={{ textAlign: 'right' }}>Disponible</th>}
                <th aria-label="Retirer" />
              </tr>
            </thead>
            <tbody>
              {lignes.map((l, i) => {
                const a = article(l.article_id);
                const u = uniteLigne(l);
                const dispo = stock[l.article_id] ?? 0;
                const compte = lireNombre(l.quantite_comptee);
                const theorique = type === 'inventaire' ? (stock[l.article_id] ?? l.theorique ?? 0) : null;
                return (
                  <tr key={l.article_id}>
                    <td className="cm-l-article"><strong>{l.designation}</strong><span className="cm-sous">{l.reference}</span></td>
                    {type === 'inventaire' ? (
                      <>
                        <td className="cm-num"><span className="cm-l-lib">Théorique</span>{fmtQte(theorique)} {l.unite}</td>
                        <td style={{ textAlign: 'right' }}>
                          <input className="cm-qte-input" inputMode="decimal" value={l.quantite_comptee} onChange={(e) => setLigne(i, 'quantite_comptee', e.target.value)} aria-label={`Quantité comptée de ${l.designation}`} />
                          <span className="cm-sous">{l.unite}</span>
                        </td>
                        <td className="cm-num"><span className="cm-l-lib">Écart</span>
                          {compte === null || Number.isNaN(compte) ? '—' : (() => {
                            const e = Math.round((compte - theorique) * 1000) / 1000;
                            return <strong style={{ color: e < 0 ? '#b91c1c' : e > 0 ? '#047857' : undefined }}>{e > 0 ? '+' : ''}{fmtQte(e)}</strong>;
                          })()}
                        </td>
                      </>
                    ) : (
                      <td style={{ textAlign: 'right' }}>
                        <input className="cm-qte-input" inputMode="decimal" value={l.quantite} onChange={(e) => setLigne(i, 'quantite', e.target.value)} aria-label={`Quantité de ${l.designation}`} />
                        {a?.unites?.length > 1 ? (
                          <select className="cm-unite-ligne" value={l.unite_id || String(a.unite_stock_id)} onChange={(e) => setLigne(i, 'unite_id', e.target.value)} aria-label={`Unité pour ${l.designation}`}>
                            {a.unites.map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}
                          </select>
                        ) : <span className="cm-sous">{u.code}</span>}
                        {u.coefficient !== 1 && <span className="cm-conv">= {fmtQte(qteStock(l))} {a?.unite}</span>}
                      </td>
                    )}
                    {type === 'entree' && (
                      <td style={{ textAlign: 'right' }}>
                        <input className="cm-qte-input" style={{ width: 110 }} inputMode="decimal" value={l.cout_unitaire} onChange={(e) => setLigne(i, 'cout_unitaire', e.target.value)} aria-label={`Coût unitaire de ${l.designation}`} />
                        <span className="cm-sous">FCFA / {u.code}</span>
                      </td>
                    )}
                    {['sortie', 'transfert'].includes(type) && (
                      <td className="cm-num"><span className="cm-l-lib">Disponible</span>
                        <span className={'cm-stock-ligne ' + (dispo >= qteStock(l) ? 'cm-vert' : 'cm-orange')}>{fmtQte(dispo)} {a?.unite || l.unite}</span>
                      </td>
                    )}
                    <td><button type="button" className="cm-x" onClick={() => setLignes((ls) => ls.filter((_, j) => j !== i))} aria-label={`Retirer ${l.designation}`}>✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="cm-ajout" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select onChange={ajouter} defaultValue="" aria-label="Ajouter un article" disabled={!f.magasin_id}>
            <option value="">+ Ajouter un article…</option>
            {disponibles.map((a) => <option key={a.id} value={a.id}>{a.reference} — {a.designation}</option>)}
          </select>
          {type === 'inventaire' && <button type="button" className="cm-btn cm-secondaire" onClick={chargerInventaire} disabled={!f.magasin_id}>Charger tous les articles du magasin</button>}
        </div>
        {type === 'entree' && lignes.length > 0 && <p className="cm-aide" style={{ marginTop: 10 }}>Valeur de l'entrée : <strong>{fmtMontant(Math.round(valeur))}</strong></p>}
        {type === 'inventaire' && lignes.length > 0 && <p className="cm-aide" style={{ marginTop: 10 }}>Le stock théorique est relevé de nouveau au moment de la validation : l'écart enregistré sera celui de ce moment-là.</p>}
      </Section>
    </div>
  );
}
