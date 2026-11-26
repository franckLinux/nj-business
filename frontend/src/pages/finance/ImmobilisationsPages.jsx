// NJ FINANCE — lot F10 (migration 084) : tableau des immobilisations.
// Décision de Franck : « juste un tableau d'immobilisation » — registre, plan
// d'amortissement (linéaire, prorata en jours, année de 360 jours) et tableau de
// l'exercice. Le stock reste dans NJ COMMERCIAL ; aucune écriture n'est passée ici.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { Tiroir, Champ } from '@/components/commercial/ui';
import { Erreur, fmtCompta, fmtDate, aujourdhui } from '@/pages/comptabilite/commun';
import { exporterExcel } from '@/lib/export';

const m = (v) => fmtCompta(v, { zero: '0' });
const STATUTS = { en_service: ['En service', 'vert'], cede: ['Cédé', 'gris'], rebut: ['Mis au rebut', 'gris'] };
const Statut = ({ s }) => <span className={`fin-pastille fin-pastille-${STATUTS[s][1]}`}>{STATUTS[s][0]}</span>;

// ── Registre ────────────────────────────────────────────────────────────────
export function ImmobilisationsPage() {
  const { can } = useApp();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const statut = params.get('statut') ?? 'en_service';
  const [d, setD] = useState(null);
  const [ref, setRef] = useState(null);
  const [erreur, setErreur] = useState('');
  const [categorie, setCategorie] = useState(null);       // tiroir catégorie
  const gerer = can('finance.immos.gerer');
  const charger = useCallback(async () => {
    const [l, r] = await Promise.all([api.get(`/finance/immobilisations${statut ? `?statut=${statut}` : ''}`), api.get('/finance/immobilisations/referentiels')]);
    if (l?.error || r?.error) { setErreur(l?.error || r?.error); return; }
    setErreur(''); setD(l); setRef(r);
  }, [statut]);
  useEffect(() => { charger(); }, [charger]);
  const standard = async () => {
    const r = await api.post('/finance/immobilisations/categories');
    if (r?.error) { toast(r.error, 'error'); return; }
    toast(`${r.creees.length} catégorie(s) créée(s).${r.anomalies.length ? ` ${r.anomalies.join(' ')}` : ''}`, r.anomalies.length ? 'warning' : 'success');
    charger();
  };
  if (erreur) return <div className="cm-page fin-page"><Erreur message={erreur} /></div>;
  if (!d) return <div className="loading-msg">Chargement…</div>;
  return (
    <div className="cm-page fin-page">
      <div className="cm-entete">
        <div><h2>Immobilisations</h2>
          <p>Registre des biens durables de l'entité : valeur d'origine, amortissements cumulés et valeur nette comptable à la fin de l'exercice en cours.
            Amortissement linéaire, au prorata des jours (année de 360 jours).</p></div>
        <div className="fin-actions">
          <Link className="cm-btn cm-secondaire" to="/finance/immobilisations/tableau">Tableau de l'exercice</Link>
          {gerer && ref.categories.length > 0 && <Link className="cm-btn cm-primaire" to="/finance/immobilisations/nouvelle">+ Nouvelle immobilisation</Link>}
        </div>
      </div>

      {ref.categories.length === 0 && (
        <div className="fin-vide"><div className="fin-vide-icone" aria-hidden="true">🏢</div><h3>Aucune catégorie d'immobilisation</h3>
          <p>Les catégories portent les comptes (immobilisation, amortissement, dotation) et la durée par défaut.</p>
          {gerer && <button type="button" className="cm-btn cm-primaire" onClick={standard}>Créer les catégories standard</button>}</div>
      )}

      {gerer && ref.factures.length > 0 && (
        <section className="fin-carte fin-lecture">
          <h3 className="fin-titre-section">Factures d'immobilisation à enregistrer ({ref.factures.length})</h3>
          <table className="cm-table fin-table">
            <tbody>{ref.factures.map((f) => (
              <tr key={f.id}><td className="fin-mono">{f.numero}</td><td>{f.fournisseur}<div className="cm-sous">{f.designation}</div></td>
                <td>{fmtDate(f.date_facture)}</td><td className="fin-num">{m(f.total_ht)} HT</td>
                <td className="fin-actions-ligne"><Link className="cm-btn cm-primaire cm-petit" to={`/finance/immobilisations/nouvelle?facture=${f.id}`}>Créer la fiche</Link></td></tr>))}</tbody>
          </table>
        </section>
      )}

      {ref.categories.length > 0 && (<>
        <div className="fin-totaux-cartes">
          {[['Valeur d\'origine', d.totaux.valeur_origine], [`Amortissements au 31/12/${new Date().getFullYear()}`, d.totaux.cumul], [`VNC au 31/12/${new Date().getFullYear()}`, d.totaux.vnc], [`Dotation ${new Date().getFullYear()}`, d.totaux.dotation_annee]]
            .map(([l, v]) => <div key={l} className="fin-carte fin-chiffre"><span className="cm-sous">{l}</span><b>{m(v)}</b></div>)}
        </div>
        <div className="fin-onglets" role="tablist">
          {[['en_service', 'En service'], ['sorties', 'Sorties'], ['', 'Toutes'], ['categories', 'Catégories']].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={statut === k} className={statut === k ? 'actif' : ''} onClick={() => setParams({ statut: k })}>{l}</button>
          ))}
        </div>
        {statut === 'categories' ? (
          <div className="cm-table-wrap">
            <table className="cm-table fin-table">
              <thead><tr><th>Catégorie</th><th>Compte</th><th>Amortissement</th><th>Dotation</th><th className="fin-num">Durée</th><th className="fin-num">Biens</th>{gerer && <th aria-label="Actions" />}</tr></thead>
              <tbody>{ref.categories.map((c) => (
                <tr key={c.id} className={c.actif ? undefined : 'fin-annule'}>
                  <td><b>{c.libelle}</b><div className="cm-sous">{c.code}</div></td><td className="fin-mono">{c.compte_immo}</td>
                  <td className="fin-mono">{c.compte_amort || '—'}</td><td className="fin-mono">{c.compte_dotation || '—'}</td>
                  <td className="fin-num">{c.amortissable ? `${Number(c.duree_defaut)} ans` : 'Non amortissable'}</td><td className="fin-num">{c.nb}</td>
                  {gerer && <td className="fin-actions-ligne"><button type="button" className="cm-btn cm-secondaire cm-petit" onClick={() => setCategorie(c)}>Modifier</button></td>}
                </tr>))}</tbody>
            </table>
            {gerer && <p><button type="button" className="cm-btn cm-secondaire cm-petit" onClick={() => setCategorie({})}>+ Nouvelle catégorie</button>{' '}
              <button type="button" className="cm-btn cm-secondaire cm-petit" onClick={standard}>Compléter avec les catégories standard</button></p>}
          </div>
        ) : d.lignes.length === 0 ? <div className="fin-vide"><h3>Aucune immobilisation</h3><p>Rien dans cette vue.</p></div> : (
          <div className="cm-table-wrap">
            <table className="cm-table fin-table">
              <thead><tr><th>Code</th><th>Désignation</th><th>Catégorie</th><th>Mise en service</th><th className="fin-num">Valeur d'origine</th>
                <th className="fin-num">Durée</th><th className="fin-num">Amort. cumulés</th><th className="fin-num">VNC</th><th>Statut</th></tr></thead>
              <tbody>{d.lignes.map((i) => (
                <tr key={i.id}>
                  <td className="fin-mono"><Link to={`/finance/immobilisations/${i.id}`}>{i.code}</Link></td>
                  <td>{i.designation}{i.localisation && <div className="cm-sous">{i.localisation}</div>}</td>
                  <td>{i.categorie}</td><td>{fmtDate(i.date_mise_service)}</td><td className="fin-num">{m(i.valeur_origine)}</td>
                  <td className="fin-num">{i.amortissable ? `${i.duree_annees} ans` : '—'}</td><td className="fin-num">{m(i.cumul)}</td><td className="fin-num"><b>{m(i.vnc)}</b></td>
                  <td><Statut s={i.statut} />{i.date_sortie && <div className="cm-sous">le {fmtDate(i.date_sortie)}</div>}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </>)}
      {categorie && <CategorieTiroir c={categorie} onFermer={() => setCategorie(null)} onFait={() => { setCategorie(null); charger(); }} />}
    </div>
  );
}

function CategorieTiroir({ c, onFermer, onFait }) {
  const toast = useToast();
  const [v, setV] = useState({ code: c.code || '', libelle: c.libelle || '', compte_immo: c.compte_immo || '', compte_amort: c.compte_amort || '',
    compte_dotation: c.compte_dotation || '', amortissable: c.amortissable !== false, duree_defaut: c.duree_defaut ? String(Number(c.duree_defaut)) : '', actif: c.actif !== false });
  const [erreur, setErreur] = useState('');
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const valider = async () => {
    const r = await api.put(`/finance/immobilisations/categories/${c.id || 'nouvelle'}`, v);
    if (r?.error) { setErreur(r.error); return; }
    toast('Catégorie enregistrée.', 'success'); onFait();
  };
  return (
    <Tiroir titre={c.id ? 'Modifier la catégorie' : 'Nouvelle catégorie'} onFermer={onFermer} pied={<>
      <button type="button" className="cm-btn cm-secondaire" onClick={onFermer}>Annuler</button>
      <button type="button" className="cm-btn cm-primaire" onClick={valider}>Enregistrer</button></>}>
      <Erreur message={erreur} />
      <div className="cm-grille">
        <Champ label="Code" requis id="ic-code"><input id="ic-code" value={v.code} maxLength={20} onChange={set('code')} /></Champ>
        <Champ label="Libellé" requis id="ic-lib"><input id="ic-lib" value={v.libelle} maxLength={120} onChange={set('libelle')} /></Champ>
        <Champ label="Compte d'immobilisation (2…)" requis id="ic-ci"><input id="ic-ci" value={v.compte_immo} onChange={set('compte_immo')} /></Champ>
        <Champ label="Amortissable" id="ic-am"><label className="fin-choix"><input id="ic-am" type="checkbox" checked={v.amortissable} onChange={set('amortissable')} /> oui</label></Champ>
        {v.amortissable && (<>
          <Champ label="Compte d'amortissement (28…)" requis id="ic-ca"><input id="ic-ca" value={v.compte_amort} onChange={set('compte_amort')} /></Champ>
          <Champ label="Compte de dotation (68…)" requis id="ic-cd"><input id="ic-cd" value={v.compte_dotation} onChange={set('compte_dotation')} /></Champ>
          <Champ label="Durée par défaut (années)" requis id="ic-d"><input id="ic-d" inputMode="decimal" value={v.duree_defaut} onChange={set('duree_defaut')} /></Champ>
        </>)}
        {c.id && <Champ label="Active" id="ic-ac"><label className="fin-choix"><input id="ic-ac" type="checkbox" checked={v.actif} onChange={set('actif')} /> oui</label></Champ>}
      </div>
    </Tiroir>
  );
}

// ── Saisie ──────────────────────────────────────────────────────────────────
export function ImmoSaisiePage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [ref, setRef] = useState(null);
  const [f, setF] = useState(null);
  const [erreur, setErreur] = useState('');
  useEffect(() => {
    (async () => {
      const r = await api.get('/finance/immobilisations/referentiels');
      if (r?.error) { setErreur(r.error); return; }
      setRef(r);
      if (id) {
        const x = await api.get(`/finance/immobilisations/${id}`);
        if (x?.error) { setErreur(x.error); return; }
        const i = x.immobilisation;
        setF({ code: i.code, designation: i.designation, categorie_id: i.categorie_id, date_acquisition: i.date_acquisition, date_mise_service: i.date_mise_service,
          valeur_origine: String(i.valeur_origine), duree_annees: i.duree_annees === null ? '' : String(i.duree_annees), amort_anterieurs: i.amort_anterieurs ? String(i.amort_anterieurs) : '',
          amort_anterieurs_au: i.amort_anterieurs_au || '', fournisseur_id: i.fournisseur_id || '', facture_id: i.facture_id || '', reference_piece: i.reference_piece,
          localisation: i.localisation, responsable: i.responsable, observations: i.observations });
        return;
      }
      const fac = r.factures.find((x) => x.id === params.get('facture'));
      const cat = fac?.compte ? r.categories.find((c) => fac.compte.startsWith(c.compte_immo.slice(0, 3))) : null;
      setF({ code: '', designation: fac?.designation?.slice(0, 200) || '', categorie_id: cat?.id || '', date_acquisition: fac?.date_facture || aujourdhui(), date_mise_service: '',
        valeur_origine: fac ? String(fac.total_ht) : '', duree_annees: '', amort_anterieurs: '', amort_anterieurs_au: '', fournisseur_id: fac?.fournisseur_id || '',
        facture_id: fac?.id || '', reference_piece: fac?.numero || '', localisation: '', responsable: '', observations: '' });
    })();
  }, [id, params]);
  if (erreur && !f) return <div className="cm-page fin-page"><Erreur message={erreur} /></div>;
  if (!f) return <div className="loading-msg">Chargement…</div>;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const cat = ref.categories.find((c) => c.id === f.categorie_id);
  const enregistrer = async () => {
    const r = id ? await api.put(`/finance/immobilisations/${id}`, f) : await api.post('/finance/immobilisations', f);
    if (r?.error) { setErreur(r.error); return; }
    toast(id ? 'Immobilisation modifiée.' : `Immobilisation ${r.code} créée.`, 'success');
    navigate(`/finance/immobilisations/${r.id}`);
  };
  return (
    <div className="cm-page fin-page">
      <Link to={id ? `/finance/immobilisations/${id}` : '/finance/immobilisations'} className="fin-lien">← Immobilisations</Link>
      <div className="cm-entete"><div><h2>{id ? `Modifier ${f.code}` : 'Nouvelle immobilisation'}</h2>
        {f.facture_id && !id && <p>Préremplie depuis la facture {f.reference_piece} : vérifiez la catégorie et la date de mise en service.</p>}</div></div>
      <Erreur message={erreur} />
      <section className="fin-carte">
        <div className="cm-grille">
          <Champ label="Désignation" requis pleine id="im-des"><input id="im-des" value={f.designation} maxLength={200} onChange={set('designation')} /></Champ>
          <Champ label="Catégorie" requis id="im-cat"><select id="im-cat" value={f.categorie_id} onChange={set('categorie_id')}>
            <option value="">— Choisir —</option>{ref.categories.filter((c) => c.actif || c.id === f.categorie_id).map((c) => <option key={c.id} value={c.id}>{c.libelle} ({c.compte_immo})</option>)}</select></Champ>
          <Champ label="Code" id="im-code" aide={id ? undefined : 'Laissé vide : attribué automatiquement (IMM-0001…)'}><input id="im-code" value={f.code} maxLength={30} onChange={set('code')} /></Champ>
          <Champ label="Valeur d'origine (HT)" requis id="im-vo"><input id="im-vo" inputMode="decimal" value={f.valeur_origine} onChange={set('valeur_origine')} /></Champ>
          <Champ label="Durée d'amortissement (années)" id="im-du" aide={cat ? (cat.amortissable ? `Par défaut : ${Number(cat.duree_defaut)} ans` : 'Catégorie non amortissable') : undefined}>
            <input id="im-du" inputMode="decimal" value={f.duree_annees} disabled={cat && !cat.amortissable} onChange={set('duree_annees')} placeholder={cat?.amortissable ? String(Number(cat.duree_defaut)) : '—'} /></Champ>
          <Champ label="Date d'acquisition" requis id="im-da"><input id="im-da" type="date" value={f.date_acquisition} onChange={set('date_acquisition')} /></Champ>
          <Champ label="Date de mise en service" id="im-ds" aide="Départ de l'amortissement ; vide = date d'acquisition"><input id="im-ds" type="date" value={f.date_mise_service} onChange={set('date_mise_service')} /></Champ>
          <Champ label="Fournisseur" id="im-f"><select id="im-f" value={f.fournisseur_id} onChange={set('fournisseur_id')}>
            <option value="">—</option>{ref.fournisseurs.map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}</select></Champ>
          <Champ label="Référence de la pièce" id="im-ref"><input id="im-ref" value={f.reference_piece} maxLength={60} onChange={set('reference_piece')} /></Champ>
          <Champ label="Localisation" id="im-loc"><input id="im-loc" value={f.localisation} maxLength={120} onChange={set('localisation')} /></Champ>
          <Champ label="Responsable / détenteur" id="im-resp"><input id="im-resp" value={f.responsable} maxLength={120} onChange={set('responsable')} /></Champ>
          <Champ label="Observations" pleine id="im-obs"><textarea id="im-obs" rows={2} maxLength={500} value={f.observations} onChange={set('observations')} /></Champ>
        </div>
      </section>
      <details className="fin-carte">
        <summary><b>Bien acquis avant l'utilisation de NJ FINANCE</b> (amortissements déjà pratiqués)</summary>
        <div className="cm-grille" style={{ marginTop: 10 }}>
          <Champ label="Amortissements cumulés déjà pratiqués" id="im-aa"><input id="im-aa" inputMode="decimal" value={f.amort_anterieurs} onChange={set('amort_anterieurs')} /></Champ>
          <Champ label="Arrêtés au" id="im-aaa" aide="Ex. 31/12 de l'exercice précédent"><input id="im-aaa" type="date" value={f.amort_anterieurs_au} onChange={set('amort_anterieurs_au')} /></Champ>
        </div>
      </details>
      <div className="fin-barre-actions">
        <Link className="cm-btn cm-secondaire" to={id ? `/finance/immobilisations/${id}` : '/finance/immobilisations'}>Annuler</Link>
        <button type="button" className="cm-btn cm-primaire" onClick={enregistrer}>Enregistrer</button>
      </div>
    </div>
  );
}

// ── Fiche ───────────────────────────────────────────────────────────────────
export function ImmoFichePage() {
  const { id } = useParams();
  const { can } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState('');
  const [sortie, setSortie] = useState(false);
  const gerer = can('finance.immos.gerer');
  const charger = useCallback(() => api.get(`/finance/immobilisations/${id}`).then((r) => (r?.error ? setErreur(r.error) : setD(r))), [id]);
  useEffect(() => { charger(); }, [charger]);
  if (erreur) return <div className="cm-page fin-page"><Link to="/finance/immobilisations" className="fin-lien">← Immobilisations</Link><Erreur message={erreur} /></div>;
  if (!d) return <div className="loading-msg">Chargement…</div>;
  const i = d.immobilisation;
  const supprimer = async () => {
    if (!window.confirm(`Supprimer la fiche ${i.code} ? (à réserver aux erreurs de saisie ; pour une vente ou une mise au rebut, utilisez « Sortie »)`)) return;
    const r = await api.delete(`/finance/immobilisations/${id}`);
    if (r?.error) { toast(r.error, 'error'); return; }
    toast('Fiche supprimée.', 'success'); navigate('/finance/immobilisations');
  };
  const annulerSortie = async () => {
    const r = await api.delete(`/finance/immobilisations/${id}/sortie`);
    if (r?.error) { toast(r.error, 'error'); return; }
    toast('Sortie annulée : le bien est de nouveau en service.', 'success'); charger();
  };
  return (
    <div className="cm-page fin-page">
      <Link to="/finance/immobilisations" className="fin-lien">← Immobilisations</Link>
      <div className="fin-fiche-tete">
        <div><h2>{i.code} — {i.designation} <Statut s={i.statut} /></h2>
          <p className="cm-sous">{i.categorie} · compte {i.compte_immo}{i.compte_amort ? ` · amortissement ${i.compte_amort}` : ''}
            {i.fournisseur ? ` · ${i.fournisseur}` : ''}{i.facture_numero ? ` · facture ${i.facture_numero}` : i.reference_piece ? ` · pièce ${i.reference_piece}` : ''}</p>
          <p className="cm-sous">Acquis le {fmtDate(i.date_acquisition)} · en service le {fmtDate(i.date_mise_service)}
            {i.localisation ? ` · ${i.localisation}` : ''}{i.responsable ? ` · ${i.responsable}` : ''}</p></div>
        {gerer && (
          <div className="fin-actions">
            <Link className="cm-btn cm-secondaire" to={`/finance/immobilisations/${id}/modifier`}>Modifier</Link>
            {i.statut === 'en_service' ? <button type="button" className="cm-btn cm-primaire" onClick={() => setSortie(true)}>Sortie (cession, rebut)</button>
              : <button type="button" className="cm-btn cm-secondaire" onClick={annulerSortie}>Annuler la sortie</button>}
            <button type="button" className="cm-btn cm-secondaire" onClick={supprimer}>Supprimer</button>
          </div>
        )}
      </div>
      <div className="fin-totaux-cartes">
        {[['Valeur d\'origine', i.valeur_origine], ['Amortissements cumulés', i.cumul], ['Valeur nette comptable', i.vnc]].map(([l, v]) => (
          <div key={l} className="fin-carte fin-chiffre"><span className="cm-sous">{l}</span><b>{m(v)}</b></div>))}
        <div className="fin-carte fin-chiffre"><span className="cm-sous">Amortissement</span><b>{i.amortissable ? `${i.duree_annees} ans` : 'Aucun'}</b>
          {i.amortissable && <span className="cm-sous">linéaire, {Math.round(10000 / i.duree_annees) / 100} % l'an</span>}</div>
      </div>
      {d.sortie && (
        <div className="fin-bandeau">{i.statut === 'cede' ? `Cédé le ${fmtDate(i.date_sortie)} pour ${m(i.prix_cession)}` : `Mis au rebut le ${fmtDate(i.date_sortie)}`}
          {' '}· VNC à la sortie {m(d.sortie.vnc)} · {d.sortie.resultat >= 0 ? 'plus-value' : 'moins-value'} {m(Math.abs(d.sortie.resultat))}{i.motif_sortie ? ` · ${i.motif_sortie}` : ''}</div>
      )}
      <section className="fin-carte">
        <h3 className="fin-titre-section">Plan d'amortissement</h3>
        {d.plan.length === 0 ? <p className="cm-sous">{i.amortissable ? 'Entièrement amorti.' : 'Bien non amortissable.'}</p> : (
          <table className="cm-table fin-table">
            <thead><tr><th>Exercice</th><th>Période</th><th className="fin-num">Jours</th><th className="fin-num">Dotation</th><th className="fin-num">Cumul</th><th className="fin-num">VNC fin</th></tr></thead>
            <tbody>
              {i.amort_anterieurs > 0 && <tr><td colSpan={4} className="cm-sous">Amortissements antérieurs au {fmtDate(i.amort_anterieurs_au)}</td><td className="fin-num">{m(i.amort_anterieurs)}</td><td className="fin-num">{m(i.valeur_origine - i.amort_anterieurs)}</td></tr>}
              {d.plan.map((l) => (
                <tr key={l.annee} className={l.annee === new Date().getFullYear() ? 'fin-ligne-courante' : undefined}>
                  <td>{l.annee}</td><td>{fmtDate(l.debut)} – {fmtDate(l.fin)}</td><td className="fin-num">{l.jours}</td>
                  <td className="fin-num">{m(l.dotation)}</td><td className="fin-num">{m(l.cumul)}</td><td className="fin-num">{m(l.vnc)}</td></tr>))}
            </tbody>
          </table>
        )}
      </section>
      {i.observations && <section className="fin-carte"><h3 className="fin-titre-section">Observations</h3><p>{i.observations}</p></section>}
      {sortie && <SortieTiroir i={i} onFermer={() => setSortie(false)} onFait={(r) => { setSortie(false); setD(r); toast('Sortie enregistrée.', 'success'); }} />}
    </div>
  );
}

function SortieTiroir({ i, onFermer, onFait }) {
  const [v, setV] = useState({ type: 'cession', date_sortie: aujourdhui(), prix_cession: '', motif: '' });
  const [erreur, setErreur] = useState('');
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  const valider = async () => {
    const r = await api.post(`/finance/immobilisations/${i.id}/sortie`, v);
    if (r?.error) { setErreur(r.error); return; }
    onFait(r);
  };
  return (
    <Tiroir titre={`Sortie de ${i.code}`} sousTitre={i.designation} onFermer={onFermer} pied={<>
      <button type="button" className="cm-btn cm-secondaire" onClick={onFermer}>Annuler</button>
      <button type="button" className="cm-btn cm-primaire" disabled={v.type === 'cession' && v.prix_cession === ''} onClick={valider}>Enregistrer la sortie</button></>}>
      <p className="cm-sous">L'amortissement s'arrête à la date de sortie ; la valeur nette et le résultat de cession sont calculés.</p>
      <Erreur message={erreur} />
      <div className="cm-grille">
        <Champ label="Nature" requis id="so-t"><select id="so-t" value={v.type} onChange={set('type')}><option value="cession">Cession (vente)</option><option value="rebut">Mise au rebut</option></select></Champ>
        <Champ label="Date de sortie" requis id="so-d"><input id="so-d" type="date" value={v.date_sortie} onChange={set('date_sortie')} /></Champ>
        {v.type === 'cession' && <Champ label="Prix de cession" requis id="so-p"><input id="so-p" inputMode="decimal" value={v.prix_cession} onChange={set('prix_cession')} /></Champ>}
        <Champ label="Motif / acquéreur" pleine id="so-m"><input id="so-m" value={v.motif} maxLength={300} onChange={set('motif')} /></Champ>
      </div>
    </Tiroir>
  );
}

// ── Tableau de l'exercice ───────────────────────────────────────────────────
const COLS = [['vb_debut', 'Valeur brute début'], ['acquisitions', 'Acquisitions'], ['sorties', 'Sorties'], ['vb_fin', 'Valeur brute fin'],
  ['amort_debut', 'Amort. début'], ['dotation', 'Dotation'], ['reprises', 'Reprises (sorties)'], ['amort_fin', 'Amort. fin'], ['vnc_fin', 'VNC fin']];
export function TableauImmosPage() {
  const [annee, setAnnee] = useState(new Date().getFullYear());
  const [t, setT] = useState(null);
  const [erreur, setErreur] = useState('');
  useEffect(() => {
    setT(null);
    api.get(`/finance/immobilisations/tableau?annee=${annee}`).then((r) => (r?.error ? setErreur(r.error) : setT(r)));
  }, [annee]);
  const excel = () => exporterExcel(`Tableau_immobilisations_${annee}`,
    ['Catégorie', 'Code', 'Désignation', 'Mise en service', 'Taux %', ...COLS.map((c) => c[1]), 'Résultat de sortie'],
    t.categories.flatMap((c) => [...c.lignes.map((l) => [c.categorie, l.code, l.designation, l.date_mise_service, l.taux ?? '', ...COLS.map(([k]) => l[k]), l.resultat_sortie ?? '']),
      [c.categorie, '', `Total ${c.categorie}`, '', '', ...COLS.map(([k]) => c.totaux[k]), '']]).concat([['', '', 'TOTAL GÉNÉRAL', '', '', ...COLS.map(([k]) => t.totaux[k]), '']]),
    [`Tableau des immobilisations — exercice ${annee}`, t.methode]);
  return (
    <div className="cm-page fin-page fin-page-large">
      <Link to="/finance/immobilisations" className="fin-lien">← Immobilisations</Link>
      <div className="cm-entete">
        <div><h2>Tableau des immobilisations — exercice {annee}</h2><p>{t?.methode || ''}. Exercice = année civile.</p></div>
        <div className="fin-actions">
          <select aria-label="Exercice" value={annee} onChange={(e) => setAnnee(Number(e.target.value))}>
            {Array.from({ length: 8 }, (_, k) => new Date().getFullYear() + 1 - k).map((a) => <option key={a} value={a}>{a}</option>)}</select>
          <button type="button" className="cm-btn cm-secondaire" disabled={!t?.categories?.length} onClick={excel}>Excel</button>
          <button type="button" className="cm-btn cm-secondaire" onClick={() => window.print()}>Imprimer</button>
        </div>
      </div>
      <Erreur message={erreur} />
      {!t && !erreur && <div className="loading-msg">Chargement…</div>}
      {t?.categories?.length === 0 && <div className="fin-vide"><h3>Aucune immobilisation sur cet exercice</h3></div>}
      {t?.categories?.length > 0 && (
        <div className="cm-table-wrap">
          <table className="cm-table fin-table fin-tableau-immos">
            <thead>
              <tr><th rowSpan={2}>Code</th><th rowSpan={2}>Désignation</th><th rowSpan={2}>Mise en service</th><th rowSpan={2} className="fin-num">Taux</th>
                <th colSpan={4} className="fin-groupe">Valeurs brutes</th><th colSpan={4} className="fin-groupe">Amortissements</th><th rowSpan={2} className="fin-num">VNC fin</th></tr>
              <tr>{['Début', 'Acquisitions', 'Sorties', 'Fin', 'Début', 'Dotations', 'Reprises', 'Fin'].map((l, k) => <th key={k} className="fin-num">{l}</th>)}</tr>
            </thead>
            {t.categories.map((c) => (
              <tbody key={c.categorie}>
                <tr className="fin-ligne-groupe"><td colSpan={13}><b>{c.categorie}</b></td></tr>
                {c.lignes.map((l) => (
                  <tr key={l.id}>
                    <td className="fin-mono"><Link to={`/finance/immobilisations/${l.id}`}>{l.code}</Link></td>
                    <td>{l.designation}{l.date_sortie && <div className="cm-sous">{l.statut === 'cede' ? 'Cédé' : 'Rebut'} le {fmtDate(l.date_sortie)}{l.resultat_sortie !== undefined ? ` · résultat ${m(l.resultat_sortie)}` : ''}</div>}</td>
                    <td>{fmtDate(l.date_mise_service)}</td><td className="fin-num">{l.taux ? `${l.taux} %` : '—'}</td>
                    {COLS.map(([k]) => <td key={k} className="fin-num">{m(l[k])}</td>)}
                  </tr>))}
                <tr className="fin-ligne-total"><td colSpan={4}>Total {c.categorie}</td>{COLS.map(([k]) => <td key={k} className="fin-num">{m(c.totaux[k])}</td>)}</tr>
              </tbody>
            ))}
            <tfoot><tr className="fin-ligne-total"><td colSpan={4}><b>TOTAL GÉNÉRAL</b></td>{COLS.map(([k]) => <td key={k} className="fin-num"><b>{m(t.totaux[k])}</b></td>)}</tr></tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
