// NJ FINANCE — Configuration → Facturation (lot F5, migration 079).
// Catégories de charges et de produits, prestations et articles, familles,
// modes de règlement, taxes et leurs comptes, numérotation des documents.
// Règles garanties côté serveur : codes uniques, comptes de détail de la bonne
// classe, rien ne se supprime (on désactive), numérotation qui ne recule pas.
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { Champ, Tiroir } from '@/components/commercial/ui';
import { ChampCompte, Erreur, fmtCompta } from '@/pages/comptabilite/commun';

const URL_COMPTES = '/finance/config/comptes';
const SECTIONS = [
  ['categories', 'Catégories'], ['prestations', 'Prestations et articles'], ['familles', 'Familles'],
  ['modes', 'Modes de règlement'], ['taxes', 'Taxes'], ['numerotation', 'Numérotation'],
];
const SENS = { produit: 'Produits', charge: 'Charges' };

function Etat({ actif }) {
  return actif ? <span className="fin-badge fin-badge-validee">Actif</span> : <span className="fin-badge fin-badge-brouillard">Inactif</span>;
}
function Compte({ c }) {
  return c ? <span className="fin-mono">{c}</span> : <span className="cm-sous">—</span>;
}

export default function FacturationTab() {
  const { can } = useApp();
  const toast = useToast();
  const gere = can('finance.config.facturation');
  const [section, setSection] = useState('categories');
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState('');
  const [form, setForm] = useState(null);   // { type, valeurs }
  const [enCours, setEnCours] = useState(false);
  const charger = useCallback(async () => {
    const r = await api.get('/finance/config');
    if (r?.error) { setErreur(r.error); return; }
    setErreur(''); setD(r);
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const initialiser = async () => {
    setEnCours(true);
    const r = await api.post('/finance/config/initialiser', {});
    setEnCours(false);
    if (r?.error) { toast(r.error, 'error'); return; }
    const n = r.crees.categories.length + r.crees.modes.length + r.crees.taxes.length;
    toast(n ? `Paramétrage standard : ${r.crees.categories.length} catégorie(s), ${r.crees.modes.length} mode(s) de règlement${r.crees.taxes.length ? ', TVA 19,25 %' : ''}.` : 'Le paramétrage standard est déjà en place.', 'success');
    if (r.anomalies.length) toast(r.anomalies.join(' '), 'warning');
    charger();
  };
  const enregistrer = async () => {
    const { type, valeurs } = form;
    const chemin = { categories: 'categories', familles: 'familles', prestations: 'prestations', modes: 'modes-reglement', taxes: 'taxes' }[type];
    setEnCours(true);
    const r = type === 'numerotation'
      ? await api.put('/finance/config/sequences', valeurs)
      : valeurs.id ? await api.put(`/finance/config/${chemin}/${valeurs.id}`, valeurs) : await api.post(`/finance/config/${chemin}`, valeurs);
    setEnCours(false);
    if (r?.error) { toast(r.error, 'error'); return; }
    toast('Enregistré.', 'success');
    setForm(null); charger();
  };
  const ouvrir = (type, valeurs) => gere && setForm({ type, valeurs: { ...valeurs } });
  const set = (k) => (e) => setForm((f) => ({ ...f, valeurs: { ...f.valeurs, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value } }));
  const setV = (k, v) => setForm((f) => ({ ...f, valeurs: { ...f.valeurs, [k]: v } }));

  if (erreur) return <Erreur message={erreur} />;
  if (!d) return <div className="loading-msg">Chargement…</div>;
  const vide = !d.categories.length && !d.modes.length;
  const ligne = (type, v) => ({ className: gere ? 'cm-cliquable' : '', tabIndex: gere ? 0 : undefined, onClick: () => ouvrir(type, v),
    onKeyDown: (e) => { if (e.key === 'Enter') ouvrir(type, v); } });

  return (
    <div className="fin-config fin-page">
      <section className="fin-carte">
        <div className="fin-carte-tete">
          <div>
            <h3>Paramétrage de la facturation</h3>
            <p>Classification financière des factures, des achats et des ventes. Les articles, magasins et stocks se gèrent dans NJ COMMERCIAL ; les taxes sont communes aux deux modules.</p>
          </div>
          {gere && <button type="button" className={`cm-btn ${vide ? 'cm-primaire' : 'cm-secondaire'}`} disabled={enCours} onClick={initialiser}>Créer le paramétrage standard</button>}
        </div>
        {vide && <div className="fin-bandeau">Rien n'est encore paramétré. « Créer le paramétrage standard » propose les catégories usuelles SYSCOHADA, les modes de règlement et la TVA à 19,25 %, avec les comptes de votre plan.</div>}
        <div className="fin-onglets" role="tablist">
          {SECTIONS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={section === k} className={section === k ? 'actif' : ''} onClick={() => setSection(k)}>{l}</button>)}
        </div>

        {section === 'categories' && <>
          <div className="fin-section-tete"><p>Une facture d'achat ou de vente porte une catégorie : elle donne le compte de charge ou de produit par défaut.</p>
            {gere && <div className="cm-actions">
              <button type="button" className="cm-btn cm-secondaire" onClick={() => ouvrir('categories', { sens: 'produit', code: '', libelle: '', compte_defaut: '', actif: true })}>+ Catégorie de produits</button>
              <button type="button" className="cm-btn cm-secondaire" onClick={() => ouvrir('categories', { sens: 'charge', type_achat: 'autres', code: '', libelle: '', compte_defaut: '', actif: true })}>+ Catégorie de charges</button>
            </div>}</div>
          {['produit', 'charge'].map((s) => (
            <div key={s} className="cm-table-wrap" style={{ marginBottom: 14 }}>
              <table className="cm-table fin-table">
                <thead><tr><th colSpan={5} className="fin-groupe-gauche">{SENS[s]}</th></tr><tr><th>Code</th><th>Libellé</th><th>{s === 'charge' ? 'Type d\'achat' : ''}</th><th>Compte par défaut</th><th>État</th></tr></thead>
                <tbody>
                  {d.categories.filter((c) => c.sens === s).map((c) => (
                    <tr key={c.id} {...ligne('categories', c)}><td className="fin-mono">{c.code}</td><td>{c.libelle}</td><td>{c.type_achat ? d.types_achat[c.type_achat] : ''}</td><td><Compte c={c.compte_defaut} /></td><td><Etat actif={c.actif} /></td></tr>
                  ))}
                  {!d.categories.some((c) => c.sens === s) && <tr><td colSpan={5} className="cm-sous">Aucune catégorie.</td></tr>}
                </tbody>
              </table>
            </div>
          ))}
        </>}

        {section === 'prestations' && <>
          <div className="fin-section-tete"><p>Ce que l'entité facture ou achète couramment. Un article peut être relié à l'article de NJ COMMERCIAL correspondant, sans le recopier.</p>
            {gere && <button type="button" className="cm-btn cm-secondaire" onClick={() => ouvrir('prestations', { type: 'prestation', code: '', libelle: '', famille_id: '', unite: '', prix_vente: '', prix_achat: '', taxe_id: '', compte_produit: '', compte_charge: '', com_article_id: '', actif: true })}>+ Prestation ou article</button>}</div>
          <div className="cm-table-wrap">
            <table className="cm-table fin-table">
              <thead><tr><th>Code</th><th>Libellé</th><th>Famille</th><th>Unité</th><th className="fin-num">Prix de vente</th><th>Taxe</th><th>Comptes</th><th>État</th></tr></thead>
              <tbody>
                {d.prestations.map((p) => (
                  <tr key={p.id} {...ligne('prestations', { ...p, famille_id: p.famille_id || '', taxe_id: p.taxe_id || '', com_article_id: p.com_article_id || '', prix_vente: p.prix_vente ?? '', prix_achat: p.prix_achat ?? '' })}>
                    <td className="fin-mono">{p.code}</td>
                    <td>{p.libelle} <span className="fin-origine">{p.type === 'article' ? 'article' : 'prestation'}</span>{p.article_reference && <div className="cm-sous">NJ COMMERCIAL : {p.article_reference} — {p.article_designation}</div>}</td>
                    <td>{p.famille || '—'}</td><td>{p.unite || '—'}</td><td className="fin-num">{p.prix_vente !== null ? fmtCompta(p.prix_vente, { zero: '0' }) : '—'}</td>
                    <td>{p.taxe_code ? `${p.taxe_code} (${Number(p.taxe_taux)} %)` : '—'}</td>
                    <td>{[p.compte_produit, p.compte_charge].filter(Boolean).join(' / ') || <span className="cm-sous">celui de la famille</span>}</td><td><Etat actif={p.actif} /></td>
                  </tr>
                ))}
                {!d.prestations.length && <tr><td colSpan={8} className="cm-sous">Aucune prestation.</td></tr>}
              </tbody>
            </table>
          </div>
        </>}

        {section === 'familles' && <>
          <div className="fin-section-tete"><p>Regroupent les prestations et articles ; leurs comptes servent quand une prestation n'a pas les siens.</p>
            {gere && <button type="button" className="cm-btn cm-secondaire" onClick={() => ouvrir('familles', { code: '', libelle: '', compte_produit: '', compte_charge: '', actif: true })}>+ Famille</button>}</div>
          <div className="cm-table-wrap">
            <table className="cm-table fin-table">
              <thead><tr><th>Code</th><th>Libellé</th><th>Compte de produit</th><th>Compte de charge</th><th className="fin-num">Prestations</th><th>État</th></tr></thead>
              <tbody>
                {d.familles.map((f) => <tr key={f.id} {...ligne('familles', f)}><td className="fin-mono">{f.code}</td><td>{f.libelle}</td><td><Compte c={f.compte_produit} /></td><td><Compte c={f.compte_charge} /></td><td className="fin-num">{f.nb_prestations}</td><td><Etat actif={f.actif} /></td></tr>)}
                {!d.familles.length && <tr><td colSpan={6} className="cm-sous">Aucune famille.</td></tr>}
              </tbody>
            </table>
          </div>
        </>}

        {section === 'modes' && <>
          <div className="fin-section-tete"><p>Le mode de règlement propose la caisse ou la banque où le règlement s'enregistre ; un chèque ou un virement exige sa référence.</p>
            {gere && <button type="button" className="cm-btn cm-secondaire" onClick={() => ouvrir('modes', { code: '', libelle: '', journal_id: '', reference_obligatoire: false, actif: true })}>+ Mode de règlement</button>}</div>
          <div className="cm-table-wrap">
            <table className="cm-table fin-table">
              <thead><tr><th>Code</th><th>Libellé</th><th>Caisse / banque par défaut</th><th>Référence</th><th>État</th></tr></thead>
              <tbody>
                {d.modes.map((m) => <tr key={m.id} {...ligne('modes', { ...m, journal_id: m.journal_id || '' })}><td className="fin-mono">{m.code}</td><td>{m.libelle}</td><td>{m.journal_code ? `${m.journal_code} — ${m.journal_nom}` : '—'}</td><td>{m.reference_obligatoire ? 'Obligatoire' : 'Facultative'}</td><td><Etat actif={m.actif} /></td></tr>)}
                {!d.modes.length && <tr><td colSpan={5} className="cm-sous">Aucun mode de règlement.</td></tr>}
              </tbody>
            </table>
          </div>
        </>}

        {section === 'taxes' && <>
          <div className="fin-section-tete"><p>Taxes communes avec NJ COMMERCIAL. NJ FINANCE y ajoute les comptes : taxe collectée sur les ventes, déductible sur les achats et sur les immobilisations.</p>
            {gere && <button type="button" className="cm-btn cm-secondaire" onClick={() => ouvrir('taxes', { code: '', intitule: '', taux: '', type: 'tva', compte_collecte: '', compte_deductible: '', compte_deductible_immo: '', actif: true })}>+ Taxe</button>}</div>
          <div className="cm-table-wrap">
            <table className="cm-table fin-table">
              <thead><tr><th>Code</th><th>Intitulé</th><th className="fin-num">Taux</th><th>Collectée</th><th>Déductible achats</th><th>Déductible immob.</th><th>État</th></tr></thead>
              <tbody>
                {d.taxes.map((t) => <tr key={t.id} {...ligne('taxes', { ...t, taux: Number(t.taux) })}><td className="fin-mono">{t.code}</td><td>{t.intitule}</td><td className="fin-num">{Number(t.taux).toLocaleString('fr-FR')} %</td><td><Compte c={t.compte_collecte} /></td><td><Compte c={t.compte_deductible} /></td><td><Compte c={t.compte_deductible_immo} /></td><td><Etat actif={t.actif} /></td></tr>)}
                {!d.taxes.length && <tr><td colSpan={7} className="cm-sous">Aucune taxe.</td></tr>}
              </tbody>
            </table>
          </div>
        </>}

        {section === 'numerotation' && <>
          <div className="fin-section-tete"><p>Numéros attribués à la validation des documents, sans trou, recommencés chaque année. Une fois des numéros attribués, le préfixe ne change plus et le compteur ne recule jamais.</p></div>
          <div className="cm-table-wrap">
            <table className="cm-table fin-table">
              <thead><tr><th>Document</th><th>Année</th><th>Préfixe</th><th className="fin-num">Prochain</th><th>Prochain numéro</th></tr></thead>
              <tbody>
                {d.sequences.map((s) => <tr key={s.type_document} {...ligne('numerotation', s)}><td>{s.libelle}</td><td>{s.annee}</td><td className="fin-mono">{s.prefixe}</td><td className="fin-num">{s.prochain}</td><td className="fin-mono"><b>{s.apercu}</b></td></tr>)}
              </tbody>
            </table>
          </div>
        </>}
      </section>

      {form && (
        <Tiroir titre={titreForm(form)} onFermer={() => setForm(null)}
          pied={<><button type="button" className="cm-btn cm-secondaire" onClick={() => setForm(null)}>Annuler</button>
            <button type="button" className="cm-btn cm-primaire" disabled={enCours} onClick={enregistrer}>Enregistrer</button></>}>
          <FormulaireConfig form={form} d={d} set={set} setV={setV} />
        </Tiroir>
      )}
    </div>
  );
}

const titreForm = ({ type, valeurs: v }) => ({
  categories: v.id ? `Catégorie ${v.code}` : `Nouvelle catégorie de ${v.sens === 'produit' ? 'produits' : 'charges'}`,
  familles: v.id ? `Famille ${v.code}` : 'Nouvelle famille',
  prestations: v.id ? `${v.code} — ${v.libelle}` : 'Nouvelle prestation ou article',
  modes: v.id ? `Mode ${v.code}` : 'Nouveau mode de règlement',
  taxes: v.id ? `Taxe ${v.code}` : 'Nouvelle taxe',
  numerotation: v.libelle,
}[type]);

function ChampActif({ v, set }) {
  return <Champ label="État" id="c-actif"><select id="c-actif" value={v.actif ? '1' : '0'} onChange={(e) => set('actif')({ target: { type: 'text', value: e.target.value === '1' } })}>
    <option value="1">Actif</option><option value="0">Inactif (n'est plus proposé)</option></select></Champ>;
}

function FormulaireConfig({ form, d, set, setV }) {
  const { type, valeurs: v } = form;
  const code = (max) => <Champ label="Code" requis id="c-code"><input id="c-code" value={v.code} maxLength={max} onChange={(e) => setV('code', e.target.value.toUpperCase())} /></Champ>;
  const compte = (k, label, aide) => <Champ label={label} id={`c-${k}`} aide={aide}><ChampCompte id={`c-${k}`} url={URL_COMPTES} valeur={v[k] || ''} onChange={(c) => setV(k, c)} /></Champ>;
  if (type === 'categories') return (
    <div className="cm-grille">
      {code(16)}
      {v.sens === 'charge' ? <Champ label="Type d'achat" requis id="c-ta"><select id="c-ta" value={v.type_achat} onChange={set('type_achat')}>{Object.entries(d.types_achat).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Champ> : <div />}
      <Champ label="Libellé" requis pleine id="c-lib"><input id="c-lib" value={v.libelle} maxLength={120} onChange={set('libelle')} /></Champ>
      {compte('compte_defaut', 'Compte par défaut', v.sens === 'produit' ? 'Classe 7' : v.type_achat === 'immobilisation' ? 'Classe 2' : v.type_achat === 'marchandises' ? 'Comptes 60' : 'Classe 6')}
      <ChampActif v={v} set={set} />
    </div>
  );
  if (type === 'familles') return (
    <div className="cm-grille">
      {code(16)}<ChampActif v={v} set={set} />
      <Champ label="Libellé" requis pleine id="c-lib"><input id="c-lib" value={v.libelle} maxLength={120} onChange={set('libelle')} /></Champ>
      {compte('compte_produit', 'Compte de produit', 'Classe 7, facultatif')}{compte('compte_charge', 'Compte de charge', 'Classe 6 ou 2, facultatif')}
    </div>
  );
  if (type === 'prestations') return (
    <div className="cm-grille">
      {code(20)}
      <Champ label="Nature" id="c-type"><select id="c-type" value={v.type} onChange={set('type')}><option value="prestation">Prestation de services</option><option value="article">Article</option></select></Champ>
      <Champ label="Libellé" requis pleine id="c-lib"><input id="c-lib" value={v.libelle} maxLength={200} onChange={set('libelle')} /></Champ>
      <Champ label="Famille" id="c-fam"><select id="c-fam" value={v.famille_id} onChange={set('famille_id')}><option value="">—</option>{d.familles.filter((f) => f.actif || String(f.id) === String(v.famille_id)).map((f) => <option key={f.id} value={f.id}>{f.libelle}</option>)}</select></Champ>
      <Champ label="Unité" id="c-unite" aide="jour, heure, pièce…"><input id="c-unite" value={v.unite} maxLength={20} onChange={set('unite')} /></Champ>
      <Champ label="Prix de vente HT" id="c-pv"><input id="c-pv" inputMode="decimal" value={v.prix_vente} onChange={set('prix_vente')} /></Champ>
      <Champ label="Prix d'achat HT" id="c-pa"><input id="c-pa" inputMode="decimal" value={v.prix_achat} onChange={set('prix_achat')} /></Champ>
      <Champ label="Taxe par défaut" id="c-taxe"><select id="c-taxe" value={v.taxe_id} onChange={set('taxe_id')}><option value="">Aucune</option>{d.taxes.filter((t) => t.actif || String(t.id) === String(v.taxe_id)).map((t) => <option key={t.id} value={t.id}>{t.code} — {Number(t.taux)} %</option>)}</select></Champ>
      {v.type === 'article' && d.articles_commerciaux.length > 0 ? (
        <Champ label="Article de NJ COMMERCIAL" id="c-art"><select id="c-art" value={v.com_article_id} onChange={set('com_article_id')}><option value="">—</option>{d.articles_commerciaux.map((a) => <option key={a.id} value={a.id}>{a.reference} — {a.designation}</option>)}</select></Champ>
      ) : <div />}
      {compte('compte_produit', 'Compte de produit', 'Sinon celui de la famille')}{compte('compte_charge', 'Compte de charge', 'Sinon celui de la famille')}
      <ChampActif v={v} set={set} />
    </div>
  );
  if (type === 'modes') return (
    <div className="cm-grille">
      {code(16)}<ChampActif v={v} set={set} />
      <Champ label="Libellé" requis pleine id="c-lib"><input id="c-lib" value={v.libelle} maxLength={80} onChange={set('libelle')} /></Champ>
      <Champ label="Caisse ou banque par défaut" id="c-j"><select id="c-j" value={v.journal_id} onChange={set('journal_id')}><option value="">—</option>{d.journaux.map((j) => <option key={j.id} value={j.id}>{j.code} — {j.nom}</option>)}</select></Champ>
      <Champ label="Référence (n° de chèque, de virement…)" id="c-ref"><select id="c-ref" value={v.reference_obligatoire ? '1' : '0'} onChange={(e) => setV('reference_obligatoire', e.target.value === '1')}><option value="0">Facultative</option><option value="1">Obligatoire</option></select></Champ>
    </div>
  );
  if (type === 'taxes') return (
    <div className="cm-grille">
      {code(20)}
      <Champ label="Type" id="c-tt"><select id="c-tt" value={v.type} onChange={set('type')}><option value="tva">TVA</option><option value="precompte">Précompte</option><option value="autre">Autre</option></select></Champ>
      <Champ label="Intitulé" requis pleine id="c-int"><input id="c-int" value={v.intitule} maxLength={120} onChange={set('intitule')} /></Champ>
      <Champ label="Taux (%)" requis id="c-taux"><input id="c-taux" inputMode="decimal" value={v.taux} onChange={set('taux')} /></Champ>
      <ChampActif v={v} set={set} />
      {compte('compte_collecte', 'Compte de taxe collectée', 'Ventes — 443…')}{compte('compte_deductible', 'Déductible sur achats', '445…')}
      {compte('compte_deductible_immo', 'Déductible sur immobilisations', '4451…')}
    </div>
  );
  return (
    <div className="cm-grille">
      <Champ label="Préfixe" requis id="c-pref"><input id="c-pref" value={v.prefixe} maxLength={8} disabled={v.utilisee} onChange={(e) => setV('prefixe', e.target.value.toUpperCase())} /></Champ>
      <Champ label="Nombre de chiffres" id="c-ch"><input id="c-ch" type="number" min={3} max={8} value={v.chiffres} onChange={set('chiffres')} /></Champ>
      <Champ label="Prochain numéro" id="c-pro" aide={v.utilisee ? 'Ne peut qu\'augmenter' : 'Pour reprendre une numérotation existante'}><input id="c-pro" type="number" min={1} value={v.prochain} onChange={set('prochain')} /></Champ>
      <div className="fin-apercu">Prochain document : <b className="fin-mono">{`${v.prefixe}-${v.annee}-${String(v.prochain || 1).padStart(Number(v.chiffres) || 5, '0')}`}</b></div>
    </div>
  );
}
