// NJ COMMERCIAL — Articles : catalogue, suivi comptable, fournisseurs, magasins et stock d'ouverture.
// Le stock affiché vient uniquement des mouvements enregistrés ; sans mouvement : « non suivi ».
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { Entete, Statut, Tiroir, Section, Champ, Bascule, Cases, useListe, useDiffere, enregistrer, fmtMontant, fmtQte } from '@/components/commercial/ui';

const aujourdhui = () => new Date().toISOString().slice(0, 10);

function StockInitial({ article, magasins, onEnregistre }) {
  const [f, setF] = useState({ magasin_id: '', quantite: '', date_mouvement: aujourdhui(), piece: '' });
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  const actifs = magasins.filter((m) => m.actif);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const choisir = (e) => {
    const m = article.stock.find((s) => String(s.magasin_id) === e.target.value);
    setF((x) => ({ ...x, magasin_id: e.target.value, quantite: m?.suivi ? String(m.quantite).replace('.', ',') : '' }));
  };
  const valider = async () => {
    setEnCours(true);
    const r = await api.put('/commercial/stock/initial', { article_id: article.id, ...f });
    setEnCours(false);
    if (r?.error) { setErreur(r.error); return; }
    setErreur(''); setF((x) => ({ ...x, magasin_id: '', quantite: '', piece: '' }));
    onEnregistre();
  };
  return (
    <div style={{ marginTop: 12, borderTop: '1px dashed var(--border)', paddingTop: 12 }}>
      <span className="cm-etiquette" style={{ fontSize: 12.5, fontWeight: 700 }}>Saisir ou corriger le stock d'ouverture</span>
      {erreur && <div className="cm-erreur" role="alert" style={{ marginTop: 8 }}>{erreur}</div>}
      <div className="cm-grille" style={{ marginTop: 8 }}>
        <Champ label="Magasin" id="si-m">
          <select id="si-m" value={f.magasin_id} onChange={choisir}>
            <option value="">— Choisir —</option>
            {actifs.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.nom}</option>)}
          </select>
        </Champ>
        <Champ label={`Quantité (${article.unite})`} id="si-q"><input id="si-q" inputMode="decimal" value={f.quantite} onChange={set('quantite')} /></Champ>
        <Champ label="Date de l'inventaire" id="si-d"><input id="si-d" type="date" max={aujourdhui()} value={f.date_mouvement} onChange={set('date_mouvement')} /></Champ>
        <Champ label="Pièce (PV, référence)" id="si-p"><input id="si-p" value={f.piece} onChange={set('piece')} maxLength={60} /></Champ>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
        <button type="button" className="cm-btn cm-secondaire" onClick={valider} disabled={enCours || !f.magasin_id || f.quantite === ''}>
          {enCours ? 'Enregistrement…' : 'Enregistrer le stock d\'ouverture'}
        </button>
      </div>
    </div>
  );
}

function FicheArticle({ id, references, onFermer, onEnregistre }) {
  const { can } = useApp();
  const modifiable = can('com.articles.modifier');
  const { familles, taxes, magasins, fournisseurs } = references;
  const [article, setArticle] = useState(null);
  const [f, setF] = useState(id ? null : {
    reference: '', designation: '', description: '', famille_id: '', unite: 'unité', prix_achat_indicatif: '', taxe_id: '', taxe_vente_id: '',
    suivi_stock: true, methode_valorisation: 'cmup', seuil_alerte: '', suivi_comptable: null, actif: true, fournisseur_ids: [], magasin_ids: [],
  });
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  const charger = async (aid) => {
    const r = await api.get(`/commercial/articles/${aid}`);
    if (r?.error) { setErreur(r.error); return; }
    setArticle(r);
    setF({
      reference: r.reference, designation: r.designation, description: r.description, famille_id: String(r.famille_id), unite: r.unite,
      prix_achat_indicatif: r.prix_achat_indicatif === null ? '' : String(r.prix_achat_indicatif), taxe_id: r.taxe_id ? String(r.taxe_id) : '',
      taxe_vente_id: r.taxe_vente_id ? String(r.taxe_vente_id) : '', suivi_stock: r.suivi_stock, methode_valorisation: r.methode_valorisation,
      seuil_alerte: r.seuil_alerte === null ? '' : String(r.seuil_alerte), suivi_comptable: r.suivi_comptable, actif: r.actif,
      fournisseur_ids: r.fournisseurs_directs.map((x) => x.id), magasin_ids: r.magasins.map((x) => x.id),
    });
  };
  useEffect(() => { if (id) charger(id); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  // Nouvel article : le choix de la famille reprend ses paramètres (taxes, stock, méthode), modifiables ensuite.
  const choisirFamille = (e) => {
    const v = e.target.value;
    const fam = familles.find((x) => String(x.id) === v);
    setF((x) => (article || !fam ? { ...x, famille_id: v } : {
      ...x, famille_id: v, taxe_id: fam.taxe_achat_id ? String(fam.taxe_achat_id) : '', taxe_vente_id: fam.taxe_vente_id ? String(fam.taxe_vente_id) : '',
      suivi_stock: fam.suivi_stock, methode_valorisation: fam.methode_valorisation,
    }));
  };
  const valider = async () => {
    if (f.suivi_comptable === null) { setErreur('Indiquez si l\'article est suivi en comptabilité (oui / non).'); return; }
    setEnCours(true);
    const r = await enregistrer('/commercial/articles', article?.id, { ...f, taxe_id: f.taxe_id || null, taxe_vente_id: f.taxe_vente_id || null });
    setEnCours(false);
    if (!r.ok) { setErreur(r.error); return; }
    setErreur('');
    if (!article) { onEnregistre('Article créé.', false); charger(r.data.id); return; }
    onEnregistre('Article enregistré.', false); charger(article.id);
  };
  const supprimer = async () => {
    if (!window.confirm(`Supprimer définitivement l'article ${article.reference} ? Il n'a jamais été utilisé.`)) return;
    const r = await api.delete(`/commercial/articles/${article.id}`);
    if (r?.error) { setErreur(r.error); return; }
    onEnregistre('Article supprimé.', true);
  };

  const famille = familles.find((x) => String(x.id) === String(f?.famille_id));
  const viaFamille = famille ? famille.fournisseurs.filter((x) => x.actif) : [];
  return (
    <Tiroir titre={article ? article.designation : 'Nouvel article'} sousTitre={article ? `${article.reference} · ${article.famille_nom}` : 'Catalogue des articles'} onFermer={onFermer}
      pied={<>
        {article && modifiable && !article.utilise && <button type="button" className="cm-btn cm-danger cm-gauche" onClick={supprimer}>Supprimer</button>}
        <button type="button" className="cm-btn cm-secondaire" onClick={onFermer}>Fermer</button>
        {modifiable && f && <button type="button" className="cm-btn cm-primaire" onClick={valider} disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</button>}
      </>}>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      {!f ? <div className="loading-msg">Chargement…</div> : (<>
        <div className={'cm-suivi' + (f.suivi_comptable === null ? ' cm-manquant' : '')} style={{ marginBottom: 12 }}>
          <div>
            <strong>Suivi comptable <span className="cm-req" aria-hidden="true">*</span></strong>
            <span>{f.suivi_comptable === null ? 'À préciser : l\'article sera-t-il suivi en comptabilité ?'
              : f.suivi_comptable ? 'L\'article sera repris dans les futurs traitements comptables et exports.'
                : 'L\'article reste utilisable en gestion commerciale, sans suivi comptable.'}</span>
          </div>
          <Bascule label="Suivi comptable" valeur={f.suivi_comptable} onChange={(v) => modifiable && setF((x) => ({ ...x, suivi_comptable: v }))} />
        </div>
        <Section titre="Identification">
          <div className="cm-grille">
            <Champ label="Référence" requis id="ar" aide="Unique. Ex. RAM-A4">
              <input id="ar" value={f.reference} onChange={set('reference')} maxLength={30} disabled={!modifiable} style={{ textTransform: 'uppercase' }} />
            </Champ>
            <Champ label="Famille" requis id="af">
              <select id="af" value={f.famille_id} onChange={choisirFamille} disabled={!modifiable}>
                <option value="">— Choisir —</option>
                {familles.filter((x) => x.actif || String(x.id) === String(f.famille_id)).map((x) => <option key={x.id} value={x.id}>{x.code} — {x.nom}</option>)}
              </select>
            </Champ>
            <Champ label="Désignation" requis id="ad" pleine><input id="ad" value={f.designation} onChange={set('designation')} maxLength={200} disabled={!modifiable} /></Champ>
            <Champ label="Description" id="ade" pleine><textarea id="ade" value={f.description} onChange={set('description')} maxLength={2000} disabled={!modifiable} /></Champ>
            <Champ label="Unité de mesure" requis id="au" aide="Ex. unité, rame, carton, litre, kg."><input id="au" value={f.unite} onChange={set('unite')} maxLength={20} disabled={!modifiable} /></Champ>
            <div className="cm-champ">
              <span className="cm-etiquette">Statut</span>
              <Bascule label="Statut de l'article" oui="Actif" non="Inactif" valeur={f.actif} onChange={(v) => modifiable && setF((x) => ({ ...x, actif: v }))} />
            </div>
          </div>
        </Section>
        <Section titre="Achat">
          <div className="cm-grille">
            <Champ label="Prix d'achat indicatif" id="ap" aide="Sert à estimer le montant des demandes."><input id="ap" inputMode="decimal" value={f.prix_achat_indicatif} onChange={set('prix_achat_indicatif')} disabled={!modifiable} /></Champ>
            <Champ label="Taxe à l'achat" id="at" aide={!article && famille ? 'Reprise de la famille ; modifiable.' : undefined}>
              <select id="at" value={f.taxe_id} onChange={set('taxe_id')} disabled={!modifiable}>
                <option value="">Aucune taxe</option>
                {taxes.filter((x) => x.usage !== 'vente' && (x.actif || String(x.id) === String(f.taxe_id))).map((x) => <option key={x.id} value={x.id}>{x.code} — {x.intitule} ({x.taux.toLocaleString('fr-FR')} %)</option>)}
              </select>
            </Champ>
            <div className="cm-champ cm-pleine">
              <span className="cm-etiquette">Fournisseurs de la famille</span>
              {viaFamille.length ? <div className="cm-puces">{viaFamille.map((x) => <span key={x.id} className="cm-puce">{x.nom}</span>)}</div>
                : <span className="cm-aide">{famille ? 'Aucun fournisseur rattaché à cette famille.' : 'Choisissez d\'abord une famille.'}</span>}
            </div>
            <div className="cm-champ cm-pleine">
              <span className="cm-etiquette">Autres fournisseurs propres à cet article</span>
              <Cases label="Fournisseurs propres à l'article"
                options={fournisseurs.filter((x) => (x.actif || f.fournisseur_ids.includes(x.id)) && !viaFamille.some((v) => v.id === x.id)).map((x) => ({ id: x.id, libelle: x.nom, detail: x.code }))}
                valeurs={f.fournisseur_ids} onChange={(v) => modifiable && setF((x) => ({ ...x, fournisseur_ids: v }))} vide="Aucun autre fournisseur." />
            </div>
          </div>
        </Section>
        <Section titre="Vente">
          <div className="cm-grille">
            <Champ label="Taxe à la vente" id="atv" aide="Distincte de la taxe d'achat ; jamais copiée d'office.">
              <select id="atv" value={f.taxe_vente_id} onChange={set('taxe_vente_id')} disabled={!modifiable}>
                <option value="">Aucune taxe</option>
                {taxes.filter((x) => x.usage !== 'achat' && (x.actif || String(x.id) === String(f.taxe_vente_id))).map((x) => <option key={x.id} value={x.id}>{x.code} — {x.intitule} ({x.taux.toLocaleString('fr-FR')} %)</option>)}
              </select>
            </Champ>
          </div>
        </Section>
        <Section titre="Stock">
          <div className="cm-grille" style={{ marginBottom: 12 }}>
            <div className="cm-champ">
              <span className="cm-etiquette">Suivi en stock</span>
              <Bascule label="Suivi en stock" valeur={f.suivi_stock} onChange={(v) => modifiable && setF((x) => ({ ...x, suivi_stock: v }))} />
              {!f.suivi_stock && <span className="cm-aide">Aucun mouvement ni contrôle de quantité pour cet article.</span>}
            </div>
            {f.suivi_stock && (
              <Champ label="Méthode de valorisation" requis id="amv" aide="La valorisation des mouvements arrive avec le moteur de stock (lot 4).">
                <select id="amv" value={f.methode_valorisation} onChange={set('methode_valorisation')} disabled={!modifiable}>
                  <option value="cmup">CMUP — coût moyen unitaire pondéré</option>
                  <option value="fifo">FIFO — premier entré, premier sorti</option>
                </select>
              </Champ>
            )}
          </div>
          <div className="cm-grille">
            <Champ label={`Seuil d'alerte${f.unite ? ` (${f.unite})` : ''}`} id="asa"><input id="asa" inputMode="decimal" value={f.seuil_alerte} onChange={set('seuil_alerte')} disabled={!modifiable} /></Champ>
            <div className="cm-champ cm-pleine">
              <span className="cm-etiquette">Magasins où l'article est géré</span>
              <Cases label="Magasins" options={magasins.filter((m) => m.actif || f.magasin_ids.includes(m.id)).map((m) => ({ id: m.id, libelle: `${m.code} — ${m.nom}` }))}
                valeurs={f.magasin_ids} onChange={(v) => modifiable && setF((x) => ({ ...x, magasin_ids: v }))} vide="Aucun magasin : créez-les dans Configuration → Magasins." />
            </div>
          </div>
          {article && (<>
            <span className="cm-etiquette" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, margin: '14px 0 8px' }}>Quantités enregistrées</span>
            {article.stock.length === 0 ? <p className="cm-aide">Aucun magasin actif.</p> : (
              <div className="cm-stock">
                {article.stock.map((s) => {
                  const sousSeuil = s.suivi && article.seuil_alerte !== null && s.quantite <= article.seuil_alerte;
                  return (
                    <div key={s.magasin_id} className={'cm-stock-case' + (s.suivi ? '' : ' cm-non-suivi') + (sousSeuil ? ' cm-sous-seuil' : '')}>
                      <b>{s.code} — {s.nom}</b>
                      <span className="cm-qte">{s.suivi ? `${fmtQte(s.quantite)} ${article.unite}` : 'Stock non suivi'}</span>
                      {s.suivi && <span className="cm-sous">Au {new Date(s.dernier_mouvement).toLocaleDateString('fr-FR')}{sousSeuil ? ' · sous le seuil d\'alerte' : ''}</span>}
                    </div>
                  );
                })}
              </div>
            )}
            <p className="cm-aide" style={{ marginTop: 8 }}>Les réservations ne sont pas encore gérées : elles ne sont pas affichées.</p>
            {can('com.stock.initial') && article.suivi_stock && <StockInitial article={article} magasins={magasins} onEnregistre={() => { onEnregistre('Stock d\'ouverture enregistré.', false); charger(article.id); }} />}
          </>)}
          {!article && <p className="cm-aide" style={{ marginTop: 10 }}>Le stock d'ouverture se saisit une fois l'article créé.</p>}
        </Section>
      </>)}
    </Tiroir>
  );
}

export default function ArticlesPage() {
  const { can } = useApp();
  const toast = useToast();
  const modifiable = can('com.articles.modifier');
  const [q, setQ] = useState('');
  const [famille, setFamille] = useState('');
  const [fournisseur, setFournisseur] = useState('');
  const [statut, setStatut] = useState('actifs');
  const [suivi, setSuivi] = useState('');
  const qd = useDiffere(q);
  const { donnees, erreur, recharger } = useListe(`/commercial/articles?q=${encodeURIComponent(qd)}&famille_id=${famille}&fournisseur_id=${fournisseur}&actifs=${statut === 'actifs' ? '1' : ''}&suivi=${suivi}`);
  const [refs, setRefs] = useState(null);
  const [fiche, setFiche] = useState(null);

  useEffect(() => {
    Promise.all([
      api.get('/commercial/familles'), api.get('/commercial/taxes'), api.get('/commercial/magasins'),
      api.get('/commercial/tiers?type=fournisseur'),
    ]).then(([fa, ta, ma, fo]) => setRefs({
      familles: fa?.error ? [] : fa, taxes: ta?.error ? [] : ta, magasins: ma?.error ? [] : ma, fournisseurs: fo?.error ? [] : fo,
    }));
  }, []);

  const liste = (donnees || []).filter((a) => statut !== 'inactifs' || !a.actif);
  return (
    <div className="cm-page">
      <Entete titre="Articles" description="Le catalogue des articles achetés. Chaque fiche précise si l'article est suivi en comptabilité.">
        {modifiable && <button type="button" className="cm-btn cm-primaire" onClick={() => setFiche('nouveau')} disabled={!refs}>+ Nouvel article</button>}
      </Entete>
      <div className="cm-outils">
        <input className="cm-recherche" type="search" placeholder="Rechercher une référence, une désignation, une famille…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher un article" />
        <select className="cm-select" value={famille} onChange={(e) => setFamille(e.target.value)} aria-label="Famille">
          <option value="">Toutes les familles</option>
          {(refs?.familles || []).map((x) => <option key={x.id} value={x.id}>{x.code} — {x.nom}</option>)}
        </select>
        <select className="cm-select" value={fournisseur} onChange={(e) => setFournisseur(e.target.value)} aria-label="Fournisseur">
          <option value="">Tous les fournisseurs</option>
          {(refs?.fournisseurs || []).map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}
        </select>
        <select className="cm-select" value={suivi} onChange={(e) => setSuivi(e.target.value)} aria-label="Suivi comptable">
          <option value="">Suivi comptable : tous</option><option value="1">Suivis en comptabilité</option><option value="0">Non suivis</option>
        </select>
        <select className="cm-select" value={statut} onChange={(e) => setStatut(e.target.value)} aria-label="Statut">
          <option value="actifs">Actifs</option><option value="">Tous</option><option value="inactifs">Inactifs</option>
        </select>
        <span className="cm-compteur">{donnees ? `${liste.length} article${liste.length > 1 ? 's' : ''}` : ''}</span>
      </div>
      {erreur && <div className="cm-erreur">{erreur}</div>}
      <div className="cm-table-wrap">
        <table className="cm-table">
          <thead><tr><th>Référence</th><th>Désignation</th><th>Famille</th><th>Unité</th><th className="cm-num">Prix indicatif</th><th>Taxes achat · vente</th><th>Comptabilité</th><th>Statut</th></tr></thead>
          <tbody>
            {!donnees ? <tr><td colSpan={8} className="cm-vide">Chargement…</td></tr>
              : liste.length === 0 ? <tr><td colSpan={8} className="cm-vide"><strong>Aucun article</strong>{modifiable ? 'Créez d\'abord les familles, puis les articles.' : ''}</td></tr>
                : liste.map((a) => (
                  <tr key={a.id} className={'cm-cliquable' + (a.actif ? '' : ' cm-inactif')} onClick={() => refs && setFiche(a.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' && refs) setFiche(a.id); }}>
                    <td><span className="cm-code">{a.reference}</span></td>
                    <td><strong>{a.designation}</strong>{(a.fournisseurs_famille.length + a.fournisseurs_directs.length) > 0 && <span className="cm-sous">{[...a.fournisseurs_directs, ...a.fournisseurs_famille].map((x) => x.nom).filter((v, i, t) => t.indexOf(v) === i).slice(0, 3).join(', ')}</span>}</td>
                    <td>{a.famille_nom}</td>
                    <td>{a.unite}</td>
                    <td className="cm-num">{fmtMontant(a.prix_achat_indicatif)}</td>
                    <td>{a.taxe_code || '—'} · {a.taxe_vente_code || '—'}{!a.suivi_stock && <span className="cm-sous">non suivi en stock</span>}</td>
                    <td>{a.suivi_comptable ? <span className="cm-pastille cm-violet">Suivi</span> : <span className="cm-pastille cm-off">Non suivi</span>}</td>
                    <td><Statut actif={a.actif} /></td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      {fiche && refs && <FicheArticle id={fiche === 'nouveau' ? null : fiche} references={refs} onFermer={() => setFiche(null)}
        onEnregistre={(msg, fermer) => { toast(msg, 'success'); recharger(); if (fermer) setFiche(null); }} />}
    </div>
  );
}
