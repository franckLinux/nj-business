// NJ COMMERCIAL — saisie d'une demande d'achat (expression de besoin : nouvelle, brouillon ou à corriger).
// Le stock du magasin s'affiche en direct sur chaque ligne ; il n'est jamais inventé.
// 063 : aucun fournisseur n'est proposé au demandeur (le choix se fait à la validation).
// Quantité à commander = max(0, demandée + stock de sécurité − stock disponible) ; le stock
// de sécurité est le seuil d'alerte de l'article. La quantité soumise la reprend, modifiable.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { Section, Champ } from '@/components/commercial/ui';
import { PRIORITES } from '@/components/commercial/achats';

const num = (v) => Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')) || 0;
const r3 = (n) => Math.round(n * 1000) / 1000;
const plafond = (n, dec) => Math.ceil(n * 10 ** dec - 1e-6) / 10 ** dec;
const fq = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 3 }));
const virgule = (n) => String(n).replace('.', ',');

export default function DemandeFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [refs, setRefs] = useState(null);
  const [f, setF] = useState(null);
  const [lignes, setLignes] = useState([]);
  const [stocks, setStocks] = useState({});   // `${article}-${magasin}` → stock du magasin
  const [details, setDetails] = useState({}); // article → { unité, prix indicatif }
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [numero, setNumero] = useState('');

  useEffect(() => {
    (async () => {
      const [ar, ma, un] = await Promise.all([
        api.get('/commercial/articles?actifs=1'), api.get('/commercial/magasins?actifs=1&perimetre=1'), api.get('/commercial/unites'),
      ]);
      const r = { articles: ar?.error ? [] : ar, magasins: ma?.error ? [] : ma, unites: un?.error ? [] : un };
      setRefs(r);
      if (id) {
        const d = await api.get(`/commercial/demandes/${id}`);
        if (d?.error) { setErreur(d.error); return; }
        if (!d.droits.modifier) { navigate(`/commercial/demandes/${id}`, { replace: true }); return; }
        setNumero(d.numero);
        setF({ magasin_id: String(d.magasin_id), service: d.service, priorite: d.priorite, motif: d.motif, commentaire: d.commentaire, justification_stock: d.justification_stock });
        setLignes(d.lignes.map((l) => ({ article_id: l.article_id, besoin: virgule(l.quantite_besoin), quantite: virgule(l.quantite_demandee),
          manuel: true, unite_id: l.unite_id ? String(l.unite_id) : '', commentaire: l.commentaire })));
      } else {
        setF({ magasin_id: r.magasins.length === 1 ? String(r.magasins[0].id) : '', service: '', priorite: 'normale', motif: '', commentaire: '', justification_stock: '' });
      }
    })();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stock de chaque article dans le magasin choisi (relu si le magasin change).
  useEffect(() => {
    if (!f?.magasin_id) return;
    lignes.forEach((l) => {
      const cle = `${l.article_id}-${f.magasin_id}`;
      if (stocks[cle] === undefined) {
        setStocks((s) => ({ ...s, [cle]: null }));
        api.get(`/commercial/stock?article_id=${l.article_id}&magasin_id=${f.magasin_id}`).then((r) => {
          setStocks((s) => ({ ...s, [cle]: r?.error ? { suivi: false } : (r.magasins[0] || { suivi: false }) }));
        });
      }
      if (!details[l.article_id]) {
        setDetails((d) => ({ ...d, [l.article_id]: { chargement: true } }));
        api.get(`/commercial/articles/${l.article_id}`).then((r) => {
          if (r?.error) return;
          setDetails((d) => ({ ...d, [l.article_id]: { unite: r.unite, prix: r.prix_achat_indicatif } }));
        });
      }
    });
  }, [lignes, f?.magasin_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setLigne = (i, k, v) => setLignes((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v, ...(k === 'quantite' ? { manuel: true } : {}) } : l)));
  const ajouter = (e) => {
    const aid = Number(e.target.value);
    e.target.value = '';
    if (!aid) return;
    if (lignes.some((l) => l.article_id === aid)) { toast('Cet article est déjà dans la demande : modifiez sa quantité.', 'error'); return; }
    const a = (refs?.articles || []).find((x) => x.id === aid);
    setLignes((ls) => [...ls, { article_id: aid, besoin: '1', quantite: '', manuel: false, unite_id: a ? String(a.unite_achat_id) : '', commentaire: '' }]);
  };

  const articles = refs?.articles || [];
  const article = (aid) => articles.find((a) => a.id === aid);
  // Unité de la ligne (055) : coefficient vers l'unité de stock, quantité convertie pour l'encart stock.
  const uniteLigne = (l) => {
    const a = article(l.article_id);
    return a?.unites?.find((u) => String(u.id) === String(l.unite_id || a.unite_achat_id)) || { code: a?.unite, coefficient: 1 };
  };
  const decimalesLigne = (l) => {
    const u = (refs?.unites || []).find((x) => String(x.id) === String(l.unite_id || article(l.article_id)?.unite_achat_id));
    return u ? u.decimales : 3;
  };
  // Chiffres d'une ligne, dans l'unité de la ligne : stock, sécurité, quantité à commander.
  const calcul = (l) => {
    const a = article(l.article_id);
    const k = uniteLigne(l).coefficient || 1;
    const s = f?.magasin_id ? stocks[`${l.article_id}-${f.magasin_id}`] : null;
    const besoin = num(l.besoin);
    if (a && !a.suivi_stock) return { suivi_article: false, disponible: null, securite: null, theorique: besoin, charge: true };
    const securite = a?.seuil_alerte === null || a?.seuil_alerte === undefined ? 0 : r3(Number(a.seuil_alerte) / k);
    const disponible = s && s.suivi ? r3(s.quantite / k) : null;
    const theorique = Math.max(0, plafond(besoin + securite - (disponible ?? 0), 3));
    return { suivi_article: true, suivi: Boolean(s?.suivi), disponible, securite, theorique, charge: s !== null && s !== undefined };
  };
  // Quantité soumise : reprend la quantité à commander (arrondie à l'unité) tant qu'on ne l'a pas changée.
  const soumise = (l) => {
    if (l.manuel) return l.quantite;
    const c = calcul(l);
    const t = plafond(c.theorique, decimalesLigne(l));
    return virgule(t > 0 ? t : num(l.besoin));
  };
  // Stock suffisant : la demande est servie ET le stock reste au niveau de sécurité (rien à commander).
  const couverts = lignes.filter((l) => { const c = calcul(l); return c.suivi_article && c.suivi && num(l.besoin) > 0 && c.theorique === 0; })
    .map((l) => article(l.article_id)?.designation);
  // Prix indicatif : saisi par unité d'achat, ramené à l'unité de la ligne.
  const prixLigne = (l) => {
    const a = article(l.article_id);
    const p = details[l.article_id]?.prix ?? a?.prix_achat_indicatif;
    if (p === null || p === undefined) return null;
    return (p / (a?.coef_achat || 1)) * uniteLigne(l).coefficient;
  };
  const estimation = lignes.reduce((s, l) => {
    const p = prixLigne(l);
    const q = num(soumise(l));
    return p === null ? s : s + p * q;
  }, 0);

  const corps = () => ({ ...f,
    lignes: lignes.map((l) => ({ article_id: l.article_id, quantite_besoin: l.besoin, quantite: soumise(l), unite_id: l.unite_id || null, commentaire: l.commentaire })) });
  const enregistrer = async (aussiSoumettre) => {
    setEnCours(true); setErreur('');
    const r = id ? await api.put(`/commercial/demandes/${id}`, corps()) : await api.post('/commercial/demandes', corps());
    if (r?.error) { setEnCours(false); setErreur(r.error); return; }
    if (aussiSoumettre) {
      const s = await api.post(`/commercial/demandes/${r.id}/soumission`, { justification_stock: f.justification_stock });
      setEnCours(false);
      if (s?.error) { setErreur(s.error); if (!id) navigate(`/commercial/demandes/${r.id}/modifier`, { replace: true }); return; }
      toast(`Demande ${s.numero} soumise : les responsables des achats sont prévenus.`, 'success');
    } else {
      setEnCours(false);
      toast(`Brouillon ${r.numero} enregistré.`, 'success');
    }
    navigate(`/commercial/demandes/${r.id}`);
  };

  if (!refs || !f) return <div className="cm-page">{erreur ? <div className="cm-erreur">{erreur}</div> : <div className="loading-msg">Chargement…</div>}</div>;
  const disponibles = articles.filter((a) => !lignes.some((l) => l.article_id === a.id));
  return (
    <div className="cm-page">
      <Link to={id ? `/commercial/demandes/${id}` : '/commercial/demandes'} className="cm-retour">‹ {id ? `Demande ${numero}` : 'Demandes d\'achat'}</Link>
      <div className="cm-fiche-tete">
        <h2>{id ? `Modifier la demande ${numero}` : 'Nouvelle demande d\'achat'}</h2>
        <div className="cm-actions">
          <button type="button" className="cm-btn cm-secondaire" onClick={() => enregistrer(false)} disabled={enCours}>Enregistrer le brouillon</button>
          <button type="button" className="cm-btn cm-primaire" onClick={() => enregistrer(true)} disabled={enCours || !lignes.length}>{enCours ? 'Envoi…' : 'Soumettre pour autorisation'}</button>
        </div>
      </div>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      <Section titre="Besoin">
        <div className="cm-grille">
          <Champ label="Magasin concerné" requis id="dm">
            <select id="dm" value={f.magasin_id} onChange={set('magasin_id')}>
              <option value="">— Choisir —</option>
              {refs.magasins.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.nom}</option>)}
            </select>
          </Champ>
          <Champ label="Service demandeur" id="ds"><input id="ds" value={f.service} onChange={set('service')} maxLength={120} placeholder="Ex. Comptabilité" /></Champ>
          <Champ label="Priorité" id="dp">
            <select id="dp" value={f.priorite} onChange={set('priorite')}>{Object.entries(PRIORITES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </Champ>
          <Champ label="Motif de la demande" requis id="dmo" pleine>
            <textarea id="dmo" value={f.motif} onChange={set('motif')} maxLength={2000} placeholder="Pourquoi cet achat est-il nécessaire ?" />
          </Champ>
        </div>
      </Section>
      <Section titre={`Articles demandés (${lignes.length})`}>
        {!f.magasin_id && <div className="cm-note">Choisissez d'abord le magasin : le stock affiché est celui de ce magasin.</div>}
        {lignes.length > 0 && (
          <div className="cm-table-defile">
          <table className="cm-lignes cm-besoin">
            <thead><tr>
              <th>Article</th><th style={{ textAlign: 'right' }}>Quantité en stock</th><th style={{ textAlign: 'right' }}>Stock de sécurité</th>
              <th style={{ textAlign: 'right' }}>Quantité demandée</th><th style={{ textAlign: 'right' }}>Stock à commander</th>
              <th style={{ textAlign: 'right' }}>Quantité à la soumission</th><th aria-label="Retirer" />
            </tr></thead>
            <tbody>
              {lignes.map((l, i) => {
                const a = article(l.article_id);
                const u = uniteLigne(l);
                const c = calcul(l);
                const q = soumise(l);
                return (
                  <tr key={l.article_id}>
                    <td className="cm-l-article"><strong>{a?.designation || `Article ${l.article_id}`}</strong>
                      <span className="cm-sous">{a?.reference}{prixLigne(l) !== null ? ` · ${Math.round(prixLigne(l)).toLocaleString('fr-FR')} FCFA / ${u.code}` : ' · sans prix indicatif'}</span>
                      {a?.unites?.length > 1 ? (
                        <select className="cm-unite-ligne" value={l.unite_id || String(a.unite_achat_id)} onChange={(e) => setLigne(i, 'unite_id', e.target.value)} aria-label={`Unité pour ${a?.designation}`}>
                          {a.unites.map((x) => <option key={x.id} value={x.id}>Compté en {x.code}</option>)}
                        </select>
                      ) : null}
                    </td>
                    <td className="cm-num"><span className="cm-l-lib">En stock</span>
                      {!f.magasin_id ? '—' : !c.suivi_article ? <span className="cm-sous" style={{ marginTop: 0 }}>Non stocké</span>
                        : !c.charge ? '…' : c.suivi ? <>{fq(c.disponible)} <span className="cm-sous" style={{ display: 'inline' }}>{u.code}</span></>
                          : <span className="cm-sous" style={{ marginTop: 0 }} title="Aucun stock enregistré pour ce magasin">Non suivi</span>}
                    </td>
                    <td className="cm-num"><span className="cm-l-lib">Sécurité</span>{c.suivi_article ? fq(c.securite) : '—'}</td>
                    <td style={{ textAlign: 'right' }}><span className="cm-l-lib">Demandée</span>
                      <input className="cm-qte-input" inputMode="decimal" value={l.besoin} onChange={(e) => setLigne(i, 'besoin', e.target.value)} aria-label={`Quantité demandée de ${a?.designation}`} />
                      <span className="cm-sous" style={{ textAlign: 'right' }}>{u.code}</span>
                    </td>
                    <td className="cm-num"><span className="cm-l-lib">À commander</span><strong className={c.theorique > 0 ? 'cm-a-commander' : ''}>{fq(c.theorique)}</strong></td>
                    <td style={{ textAlign: 'right' }}><span className="cm-l-lib">À la soumission</span>
                      <input className="cm-qte-input" inputMode="decimal" value={q} onChange={(e) => setLigne(i, 'quantite', e.target.value)} aria-label={`Quantité soumise de ${a?.designation}`} />
                      {l.manuel && <button type="button" className="cm-lien" style={{ fontSize: 11.5, display: 'block', marginLeft: 'auto' }} onClick={() => setLignes((ls) => ls.map((x, j) => (j === i ? { ...x, manuel: false } : x)))}>Reprendre le calcul</button>}
                      {u.coefficient !== 1 && <span className="cm-conv">= {fq(r3(num(q) * u.coefficient))} {a?.unite}</span>}
                    </td>
                    <td><button type="button" className="cm-x" onClick={() => setLignes((ls) => ls.filter((_, j) => j !== i))} aria-label={`Retirer ${a?.designation}`}>✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
        <div className="cm-ajout">
          <select onChange={ajouter} defaultValue="" aria-label="Ajouter un article">
            <option value="">+ Ajouter un article…</option>
            {disponibles.map((a) => <option key={a.id} value={a.id}>{a.reference} — {a.designation} ({a.famille_nom})</option>)}
          </select>
        </div>
        {lignes.length > 0 && (
          <p className="cm-aide" style={{ marginTop: 10 }}>
            Stock à commander = quantité demandée + stock de sécurité − quantité en stock (jamais négatif) ; le stock de sécurité est le seuil d'alerte de l'article.
            La quantité à la soumission reprend ce calcul et reste modifiable. Le fournisseur sera choisi par le responsable des achats.<br />
            Montant estimé : <strong>{estimation.toLocaleString('fr-FR')} FCFA</strong> (prix indicatifs ; recalculé par le serveur à la soumission).
          </p>
        )}
      </Section>
      {couverts.length > 0 && (
        <Section titre="Stock suffisant">
          <div className="cm-note" style={{ background: '#fffbeb', color: '#92400e' }}>
            Le stock du magasin couvre déjà le besoin, stock de sécurité compris, pour : <strong>{couverts.join(', ')}</strong>. Justifiez le réapprovisionnement (réserve, consommation prévue…).
          </div>
          <Champ label="Justification" id="dj">
            <textarea id="dj" value={f.justification_stock} onChange={set('justification_stock')} maxLength={1000} />
          </Champ>
        </Section>
      )}
      <Section titre="Commentaires">
        <Champ id="dc"><textarea id="dc" value={f.commentaire} onChange={set('commentaire')} maxLength={2000} placeholder="Informations utiles aux achats (délai souhaité, spécifications…)" /></Champ>
        <p className="cm-aide" style={{ marginTop: 8 }}>Les pièces justificatives (devis, fiche technique) se joignent depuis la fiche de la demande, une fois enregistrée.</p>
      </Section>
    </div>
  );
}
