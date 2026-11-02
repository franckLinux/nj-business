// NJ COMMERCIAL — saisie d'une demande d'achat (nouvelle, brouillon ou à corriger).
// Le stock du magasin s'affiche en direct sur chaque ligne ; il n'est jamais inventé.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { Section, Champ } from '@/components/commercial/ui';
import { EncartStock, PRIORITES } from '@/components/commercial/achats';

const evaluer = (s, qte) => {
  if (!s) return null;
  if (!s.suivi) return { suivi: false };
  const q = Number(String(qte).replace(',', '.')) || 0;
  return { suivi: true, disponible: s.quantite, couvert: s.quantite >= q && q > 0, a_approvisionner: Math.max(0, Math.round((q - s.quantite) * 1000) / 1000) };
};

export default function DemandeFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [refs, setRefs] = useState(null);
  const [f, setF] = useState(null);
  const [lignes, setLignes] = useState([]);
  const [stocks, setStocks] = useState({});   // `${article}-${magasin}` → stock du magasin
  const [details, setDetails] = useState({}); // article → { fournisseurs proposés }
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [numero, setNumero] = useState('');

  useEffect(() => {
    (async () => {
      const [ar, ma, fo] = await Promise.all([
        api.get('/commercial/articles?actifs=1'), api.get('/commercial/magasins?actifs=1&perimetre=1'), api.get('/commercial/tiers?type=fournisseur&actifs=1'),
      ]);
      const r = { articles: ar?.error ? [] : ar, magasins: ma?.error ? [] : ma, fournisseurs: fo?.error ? [] : fo };
      setRefs(r);
      if (id) {
        const d = await api.get(`/commercial/demandes/${id}`);
        if (d?.error) { setErreur(d.error); return; }
        if (!d.droits.modifier) { navigate(`/commercial/demandes/${id}`, { replace: true }); return; }
        setNumero(d.numero);
        setF({ magasin_id: String(d.magasin_id), service: d.service, priorite: d.priorite, motif: d.motif,
          fournisseur_propose_id: d.fournisseur_propose_id ? String(d.fournisseur_propose_id) : '', commentaire: d.commentaire, justification_stock: d.justification_stock });
        setLignes(d.lignes.map((l) => ({ article_id: l.article_id, quantite: String(l.quantite).replace('.', ','), fournisseur_id: l.fournisseur_id ? String(l.fournisseur_id) : '', commentaire: l.commentaire })));
      } else {
        setF({ magasin_id: r.magasins.length === 1 ? String(r.magasins[0].id) : '', service: '', priorite: 'normale', motif: '', fournisseur_propose_id: '', commentaire: '', justification_stock: '' });
      }
    })();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stock et fournisseurs proposés de chaque article (relus si le magasin change).
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
          const prop = [...r.fournisseurs_directs, ...r.fournisseurs_famille].filter((x, i, t) => t.findIndex((y) => y.id === x.id) === i);
          setDetails((d) => ({ ...d, [l.article_id]: { proposes: prop, unite: r.unite, prix: r.prix_achat_indicatif } }));
        });
      }
    });
  }, [lignes, f?.magasin_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setLigne = (i, k, v) => setLignes((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const ajouter = (e) => {
    const aid = Number(e.target.value);
    e.target.value = '';
    if (!aid) return;
    if (lignes.some((l) => l.article_id === aid)) { toast('Cet article est déjà dans la demande : modifiez sa quantité.', 'error'); return; }
    setLignes((ls) => [...ls, { article_id: aid, quantite: '1', fournisseur_id: '', commentaire: '' }]);
  };

  const articles = refs?.articles || [];
  const article = (aid) => articles.find((a) => a.id === aid);
  const couverts = useMemo(() => lignes.filter((l) => evaluer(stocks[`${l.article_id}-${f?.magasin_id}`], l.quantite)?.couvert)
    .map((l) => article(l.article_id)?.designation), [lignes, stocks, f?.magasin_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const estimation = lignes.reduce((s, l) => {
    const p = details[l.article_id]?.prix ?? article(l.article_id)?.prix_achat_indicatif;
    const q = Number(String(l.quantite).replace(',', '.')) || 0;
    return p === null || p === undefined ? s : s + p * q;
  }, 0);

  const corps = () => ({ ...f, fournisseur_propose_id: f.fournisseur_propose_id || null,
    lignes: lignes.map((l) => ({ article_id: l.article_id, quantite: l.quantite, fournisseur_id: l.fournisseur_id || null, commentaire: l.commentaire })) });
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
          <Champ label="Fournisseur proposé" id="df" aide="Facultatif : sinon, les fournisseurs habituels de chaque article sont proposés.">
            <select id="df" value={f.fournisseur_propose_id} onChange={set('fournisseur_propose_id')}>
              <option value="">— Aucun en particulier —</option>
              {refs.fournisseurs.map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}
            </select>
          </Champ>
          <Champ label="Motif de la demande" requis id="dmo" pleine>
            <textarea id="dmo" value={f.motif} onChange={set('motif')} maxLength={2000} placeholder="Pourquoi cet achat est-il nécessaire ?" />
          </Champ>
        </div>
      </Section>
      <Section titre={`Articles demandés (${lignes.length})`}>
        {!f.magasin_id && <div className="cm-note">Choisissez d'abord le magasin : le stock affiché est celui de ce magasin.</div>}
        {lignes.length > 0 && (
          <table className="cm-lignes">
            <thead><tr><th>Article</th><th style={{ textAlign: 'right' }}>Quantité</th><th>Stock du magasin</th><th>Fournisseur</th><th aria-label="Retirer" /></tr></thead>
            <tbody>
              {lignes.map((l, i) => {
                const a = article(l.article_id);
                const det = details[l.article_id] || {};
                const proposes = det.proposes || [];
                const autres = refs.fournisseurs.filter((x) => !proposes.some((p) => p.id === x.id));
                return (
                  <tr key={l.article_id}>
                    <td className="cm-l-article"><strong>{a?.designation || `Article ${l.article_id}`}</strong><span className="cm-sous">{a?.reference}{a?.prix_achat_indicatif ? ` · ${Number(a.prix_achat_indicatif).toLocaleString('fr-FR')} FCFA / ${a.unite}` : ' · sans prix indicatif'}</span></td>
                    <td style={{ textAlign: 'right' }}>
                      <input className="cm-qte-input" inputMode="decimal" value={l.quantite} onChange={(e) => setLigne(i, 'quantite', e.target.value)} aria-label={`Quantité de ${a?.designation}`} />
                      <span className="cm-sous">{a?.unite}</span>
                    </td>
                    <td className="cm-l-stock">{f.magasin_id ? <EncartStock stock={evaluer(stocks[`${l.article_id}-${f.magasin_id}`], l.quantite)} unite={a?.unite} /> : '—'}</td>
                    <td className="cm-l-fournisseur">
                      <select value={l.fournisseur_id} onChange={(e) => setLigne(i, 'fournisseur_id', e.target.value)} aria-label={`Fournisseur pour ${a?.designation}`}>
                        <option value="">{proposes.length ? 'Laisser choisir les achats' : '— Aucun fournisseur associé —'}</option>
                        {proposes.length > 0 && <optgroup label="Fournisseurs habituels">{proposes.map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}</optgroup>}
                        {autres.length > 0 && <optgroup label="Autres fournisseurs actifs">{autres.map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}</optgroup>}
                      </select>
                    </td>
                    <td><button type="button" className="cm-x" onClick={() => setLignes((ls) => ls.filter((_, j) => j !== i))} aria-label={`Retirer ${a?.designation}`}>✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="cm-ajout">
          <select onChange={ajouter} defaultValue="" aria-label="Ajouter un article">
            <option value="">+ Ajouter un article…</option>
            {disponibles.map((a) => <option key={a.id} value={a.id}>{a.reference} — {a.designation} ({a.famille_nom})</option>)}
          </select>
        </div>
        {lignes.length > 0 && (
          <p className="cm-aide" style={{ marginTop: 10 }}>
            Montant estimé : <strong>{estimation.toLocaleString('fr-FR')} FCFA</strong> (prix indicatifs ; recalculé par le serveur à la soumission).
          </p>
        )}
      </Section>
      {couverts.length > 0 && (
        <Section titre="Stock suffisant">
          <div className="cm-note" style={{ background: '#fffbeb', color: '#92400e' }}>
            Le stock du magasin couvre déjà le besoin pour : <strong>{couverts.join(', ')}</strong>. Justifiez le réapprovisionnement (réserve, consommation prévue…).
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
