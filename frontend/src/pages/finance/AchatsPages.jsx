// NJ FINANCE — Achats (lot F6, migration 080).
// Factures et avoirs fournisseurs : saisis dans NJ FINANCE, ou validés dans
// NJ COMMERCIAL et lus par référence (imputation seulement). Un règlement est
// toujours une sortie de caisse ou de banque reliée aux factures qu'elle règle.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { Champ, Tiroir, useDiffere } from '@/components/commercial/ui';
import { exporterExcel } from '@/lib/export';
import { Erreur, fmtCompta, fmtDate, aujourdhui } from '@/pages/comptabilite/commun';

const ETATS = {
  Brouillon: 'gris', 'À valider': 'orange', 'À imputer': 'violet', 'À payer': 'orange', 'Réglée en partie': 'bleu',
  Réglée: 'vert', Validée: 'vert', Annulée: 'rouge',
};
export function BadgeEtat({ etat }) {
  return <span className={`fin-pastille fin-pastille-${ETATS[etat] || 'gris'}`}>{etat}</span>;
}
function Kpi({ libelle, valeur, aide, ton = '', onClick, actif }) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp type={onClick ? 'button' : undefined} className={`fin-kpi ${ton} ${onClick ? 'fin-kpi-filtre' : ''} ${actif ? 'actif' : ''}`} onClick={onClick}>
      <span>{libelle}</span><b>{valeur}</b>{aide && <small>{aide}</small>}
    </Comp>
  );
}
const lienFacture = (f) => `/finance/achats/${f.origine}/${f.id}`;
const numeroEcriture = (e) => (e.numero ? `${e.journal_code}-${e.exercice_code}-${String(e.numero).padStart(5, '0')}` : 'brouillard');

// ── Liste ───────────────────────────────────────────────────────────────────
const FILTRES = [['', 'Toutes'], ['a_valider', 'À valider'], ['a_imputer', 'À imputer'], ['a_payer', 'À payer'], ['echues', 'Échues'], ['annulees', 'Annulées']];

export function AchatsListePage() {
  const { can } = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filtre = params.get('filtre') || '';
  const [origine, setOrigine] = useState('');
  const [recherche, setRecherche] = useState('');
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState('');
  const rech = useDiffere(recherche, 300);
  const charger = useCallback(async () => {
    const q = new URLSearchParams({ filtre, origine, q: rech });
    const r = await api.get(`/finance/achats?${q}`);
    if (r?.error) { setErreur(r.error); return; }
    setErreur(''); setD(r);
  }, [filtre, origine, rech]);
  useEffect(() => { charger(); }, [charger]);
  const choisir = (f) => setParams(f ? { filtre: f } : {});
  const exporter = () => exporterExcel('Factures_fournisseurs', ['Origine', 'N°', 'Référence', 'Fournisseur', 'Date', 'Échéance', 'HT', 'Taxes', 'TTC', 'Reste à payer', 'État'],
    d.factures.map((f) => [f.origine_libelle, f.numero, f.reference, f.tiers_nom, f.date_facture, f.date_echeance || '', +f.total_ht, +f.total_taxes,
      (f.type === 'avoir' ? -1 : 1) * f.total_ttc, f.reste === null ? '' : +f.reste, f.etat]));
  return (
    <div className="cm-page fin-page">
      <div className="cm-entete">
        <div>
          <h2>Factures fournisseurs</h2>
          <p>Factures saisies ici et factures validées dans NJ COMMERCIAL, en une seule liste. Le règlement se fait par une sortie de caisse ou de banque reliée à la facture.</p>
        </div>
        <div className="cm-actions">
          <button type="button" className="cm-btn cm-secondaire" disabled={!d?.factures?.length} onClick={exporter}>Exporter</button>
          {can('finance.achats.saisir') && <Link className="cm-btn cm-primaire" to="/finance/achats/nouvelle">+ Nouvelle facture</Link>}
        </div>
      </div>
      {d && (
        <div className="fin-kpis">
          <Kpi libelle="À valider" valeur={d.compteurs.a_valider} aide={d.compteurs.brouillons ? `${d.compteurs.brouillons} brouillon(s)` : 'Soumises à validation'}
            ton={d.compteurs.a_valider ? 'alerte' : ''} onClick={() => choisir('a_valider')} actif={filtre === 'a_valider'} />
          <Kpi libelle="À imputer (NJ COMMERCIAL)" valeur={d.compteurs.a_imputer} ton={d.compteurs.a_imputer ? 'alerte' : ''}
            onClick={() => choisir('a_imputer')} actif={filtre === 'a_imputer'} aide="Factures validées sans imputation" />
          <Kpi libelle="Reste à payer" valeur={fmtCompta(d.compteurs.reste_total, { zero: '0' })} aide={`${d.compteurs.a_payer} facture(s)`}
            onClick={() => choisir('a_payer')} actif={filtre === 'a_payer'} />
          <Kpi libelle="Échu" valeur={fmtCompta(d.compteurs.echu_total, { zero: '0' })} aide={`${d.compteurs.echues} facture(s) en retard`}
            ton={d.compteurs.echues ? 'danger' : 'ok'} onClick={() => choisir('echues')} actif={filtre === 'echues'} />
        </div>
      )}
      <div className="fin-onglets" role="tablist">
        {FILTRES.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={filtre === k} className={filtre === k ? 'actif' : ''} onClick={() => choisir(k)}>{l}</button>)}
      </div>
      <div className="fin-filtres">
        <input type="search" className="fin-recherche" placeholder="N°, référence, fournisseur, objet…" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
        <select value={origine} onChange={(e) => setOrigine(e.target.value)} aria-label="Origine">
          <option value="">Toutes origines</option><option value="fin">Saisies dans NJ FINANCE</option><option value="com_ff">NJ COMMERCIAL</option>
        </select>
      </div>
      <Erreur message={erreur} />
      {d && (d.factures.length === 0 ? (
        <div className="fin-vide"><div className="fin-vide-icone" aria-hidden="true">🧾</div><h3>Aucune facture</h3>
          <p>{filtre ? 'Aucune facture dans ce filtre.' : 'Enregistrez la première facture fournisseur avec « Nouvelle facture ».'}</p></div>
      ) : (
        <div className="cm-table-wrap">
          <table className="cm-table fin-table">
            <thead><tr><th>N°</th><th>Fournisseur</th><th>Référence</th><th>Date</th><th>Échéance</th>
              <th className="fin-num">TTC</th><th className="fin-num">Reste à payer</th><th>État</th></tr></thead>
            <tbody>
              {d.factures.map((f) => (
                <tr key={f.cle} className="cm-cliquable" tabIndex={0} onClick={() => navigate(lienFacture(f))} onKeyDown={(e) => { if (e.key === 'Enter') navigate(lienFacture(f)); }}>
                  <td className="fin-mono">{f.numero || <span className="cm-sous">brouillon</span>}
                    <div className="cm-sous">{f.type === 'avoir' ? 'Avoir · ' : ''}{f.origine === 'com_ff' ? 'NJ COMMERCIAL' : 'NJ FINANCE'}</div></td>
                  <td><b>{f.tiers_nom}</b>{f.objet && <div className="cm-sous">{f.objet}</div>}</td>
                  <td className="fin-mono">{f.reference}</td>
                  <td>{fmtDate(f.date_facture)}</td>
                  <td className={f.echue ? 'fin-retard' : ''}>{fmtDate(f.date_echeance)}{f.echue && <div className="cm-sous">{f.jours_retard} j de retard</div>}</td>
                  <td className="fin-num">{f.type === 'avoir' ? '−' : ''}{fmtCompta(f.total_ttc)}</td>
                  <td className="fin-num fin-fort">{f.reste === null ? '—' : fmtCompta(f.reste, { zero: '0' })}</td>
                  <td><BadgeEtat etat={f.etat} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.total > d.factures.length && <p className="cm-sous">{d.factures.length} premières factures sur {d.total} : affinez la recherche.</p>}
        </div>
      ))}
    </div>
  );
}

// ── Saisie (facture ou avoir) ───────────────────────────────────────────────
const ligneVide = (taxeId = '') => ({ prestation_id: '', designation: '', quantite: '1', prix_unitaire: '', remise_pct: '', taxe_id: taxeId, compte: '' });
const nombre = (v) => Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')) || 0;
const calcul = (l, taxes) => {
  const taux = Number(taxes.find((t) => t.id === String(l.taxe_id))?.taux || 0);
  const ht = Math.round(nombre(l.quantite) * nombre(l.prix_unitaire) * (100 - nombre(l.remise_pct)));
  return { ht, taxe: Math.round((ht * taux) / 100) };
};
const ajouterJours = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + Number(n || 0)); return d.toISOString().slice(0, 10); };

export function AchatSaisiePage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [ref, setRef] = useState(null);
  const [f, setF] = useState(null);
  const [origineFacture, setOrigineFacture] = useState(null);
  const [erreur, setErreur] = useState('');
  const [doublon, setDoublon] = useState(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await api.get('/finance/achats/referentiels');
      if (r?.error) { setErreur(r.error); return; }
      setRef(r);
      const tva = r.taxes.find((t) => t.code === 'TVA')?.id || '';
      if (id) {
        const x = await api.get(`/finance/achats/fin/${id}`);
        if (x?.error) { setErreur(x.error); return; }
        const fa = x.facture;
        if (fa.facture_origine_id) setOrigineFacture({ numero: fa.origine_numero, reference: fa.origine_reference });
        setF({ type: fa.type, tiers_id: fa.tiers_id, reference: fa.reference, date_facture: fa.date_facture, date_echeance: fa.date_echeance || '',
          categorie_id: fa.categorie_id, objet: fa.objet, observations: fa.observations, activite_id: fa.activite_id ? String(fa.activite_id) : '',
          facture_origine_id: fa.facture_origine_id, motif_renvoi: fa.motif_renvoi,
          lignes: x.lignes.map((l) => ({ prestation_id: l.prestation_id || '', designation: l.designation, quantite: String(Number(l.quantite)),
            prix_unitaire: String(Number(l.prix_unitaire)), remise_pct: Number(l.remise_pct) ? String(Number(l.remise_pct)) : '', taxe_id: l.taxe_id || '', compte: l.compte })) });
        return;
      }
      const origine = params.get('avoir');
      if (origine) {
        const o = await api.get(`/finance/achats/fin/${origine}`);
        if (o?.error) { setErreur(o.error); return; }
        setOrigineFacture({ numero: o.facture.numero, reference: o.facture.reference });
        setF({ type: 'avoir', tiers_id: o.facture.tiers_id, reference: '', date_facture: aujourdhui(), date_echeance: '', categorie_id: o.facture.categorie_id,
          objet: `Avoir sur ${o.facture.numero}`, observations: '', activite_id: o.facture.activite_id ? String(o.facture.activite_id) : '', facture_origine_id: origine,
          lignes: o.lignes.map((l) => ({ prestation_id: l.prestation_id || '', designation: l.designation, quantite: String(Number(l.quantite)),
            prix_unitaire: String(Number(l.prix_unitaire)), remise_pct: '', taxe_id: l.taxe_id || '', compte: l.compte })) });
        return;
      }
      setF({ type: 'facture', tiers_id: params.get('tiers') || '', reference: '', date_facture: aujourdhui(), date_echeance: '',
        categorie_id: r.categories.find((c) => c.code === 'FOURN')?.id || r.categories[0]?.id || '', objet: '', observations: '', activite_id: '',
        lignes: [ligneVide(tva)] });
    })();
  }, [id, params]);

  const totaux = useMemo(() => {
    if (!f || !ref) return { ht: 0, taxe: 0 };
    return f.lignes.reduce((t, l) => { const m = calcul(l, ref.taxes); return { ht: t.ht + m.ht, taxe: t.taxe + m.taxe }; }, { ht: 0, taxe: 0 });
  }, [f, ref]);

  if (erreur && !f) return <div className="cm-page"><Link to="/finance/achats" className="fin-lien">‹ Factures fournisseurs</Link><Erreur message={erreur} /></div>;
  if (!f || !ref) return <div className="loading-msg">Chargement…</div>;
  if (!ref.categories.length) {
    return (
      <div className="cm-page fin-page">
        <Link to="/finance/achats" className="fin-lien">‹ Factures fournisseurs</Link>
        <div className="fin-vide"><div className="fin-vide-icone" aria-hidden="true">⚙️</div><h3>Paramétrage à faire</h3>
          <p>Aucune catégorie de charges : créez le paramétrage standard dans Configuration → Facturation.</p>
          <Link className="cm-btn cm-primaire" to="/config" state={{ onglet: 'facturation' }}>Ouvrir la configuration</Link></div>
      </div>
    );
  }
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setLigne = (i, k, v) => setF((x) => ({ ...x, lignes: x.lignes.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));
  const choisirPrestation = (i, pid) => {
    const p = ref.prestations.find((x) => x.id === pid);
    setF((x) => ({ ...x, lignes: x.lignes.map((l, j) => (j !== i ? l : { ...l, prestation_id: pid,
      ...(p ? { designation: l.designation || p.libelle, prix_unitaire: l.prix_unitaire || (p.prix_achat !== null ? String(Number(p.prix_achat)) : ''),
        taxe_id: p.taxe_id || l.taxe_id, compte: p.compte || l.compte } : {}) })) }));
  };
  const fournisseur = ref.fournisseurs.find((t) => t.id === String(f.tiers_id));
  const categorie = ref.categories.find((c) => c.id === String(f.categorie_id));
  const echeanceAuto = f.type === 'facture' && fournisseur && f.date_facture ? ajouterJours(f.date_facture, fournisseur.delai) : '';
  const enregistrer = async (soumettre) => {
    setErreur(''); setDoublon(null); setEnCours(true);
    const corps = { ...f, soumettre, lignes: f.lignes.filter((l) => l.designation.trim() || nombre(l.prix_unitaire)) };
    const r = id ? await api.put(`/finance/achats/fin/${id}`, corps) : await api.post('/finance/achats', corps);
    setEnCours(false);
    if (r?.error) { setErreur(r.error); setDoublon(r.doublon || null); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    toast(soumettre ? 'Facture enregistrée et soumise à validation.' : 'Brouillon enregistré.', 'success');
    navigate(`/finance/achats/fin/${r.id}`);
  };
  const avoir = f.type === 'avoir';
  return (
    <div className="cm-page fin-page">
      <Link to={id ? `/finance/achats/fin/${id}` : '/finance/achats'} className="fin-lien">‹ {id ? 'Retour à la facture' : 'Factures fournisseurs'}</Link>
      <div className="cm-entete">
        <div>
          <h2>{id ? (avoir ? "Modifier l'avoir" : 'Modifier la facture') : (avoir ? 'Nouvel avoir fournisseur' : 'Nouvelle facture fournisseur')}</h2>
          <p>{avoir ? `Avoir sur la facture ${origineFacture?.numero || ''} (réf. ${origineFacture?.reference || ''}) : il réduit ce qui reste à payer.`
            : 'Le numéro interne est attribué à la validation, qui passe aussi l\'écriture d\'achat. Une autre personne que vous doit valider.'}</p>
        </div>
      </div>
      {f.motif_renvoi && <div className="fin-bandeau">Renvoyée au brouillon : {f.motif_renvoi}</div>}
      <Erreur message={erreur} />
      {doublon && <div className="fin-bandeau">Pièce déjà enregistrée : <Link to={`/finance/achats/${doublon.origine}/${doublon.id}`}>ouvrir la facture existante</Link></div>}
      <section className="fin-carte">
        <div className="cm-grille">
          <Champ label="Fournisseur" requis id="a-tiers" aide={fournisseur ? `Délai de paiement : ${fournisseur.delai} jours` : <Link to="/finance/tiers">Créer un fournisseur</Link>}>
            <select id="a-tiers" value={f.tiers_id} disabled={avoir} onChange={set('tiers_id')}>
              <option value="">— choisir —</option>
              {ref.fournisseurs.map((t) => <option key={t.id} value={t.id}>{t.nom}{t.nui ? ` · ${t.nui}` : ''}</option>)}
            </select>
          </Champ>
          <Champ label={avoir ? "Référence de l'avoir du fournisseur" : 'Référence de la facture du fournisseur'} requis id="a-ref" aide="Numéro porté sur la pièce reçue">
            <input id="a-ref" value={f.reference} maxLength={60} onChange={set('reference')} />
          </Champ>
          <Champ label={avoir ? "Date de l'avoir" : 'Date de la facture'} requis id="a-date"><input id="a-date" type="date" value={f.date_facture} onChange={set('date_facture')} /></Champ>
          {!avoir && (
            <Champ label="Échéance" id="a-ech" aide={echeanceAuto && !f.date_echeance ? `Par défaut : ${fmtDate(echeanceAuto)}` : undefined}>
              <input id="a-ech" type="date" value={f.date_echeance} min={f.date_facture} onChange={set('date_echeance')} />
            </Champ>
          )}
          <Champ label="Catégorie" requis id="a-cat" aide={categorie ? `${ref.types_achat[categorie.type_achat]} · compte par défaut ${categorie.compte_defaut}` : undefined}>
            <select id="a-cat" value={f.categorie_id} disabled={avoir} onChange={set('categorie_id')}>
              {ref.categories.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
            </select>
          </Champ>
          {ref.ong && (
            <Champ label="Activité / projet" id="a-act">
              <select id="a-act" value={f.activite_id} onChange={set('activite_id')}>
                <option value="">— Non ventilé —</option>
                {ref.activites.map((a) => <option key={a.id} value={a.id}>{a.nom}</option>)}
              </select>
            </Champ>
          )}
          <Champ label="Objet" pleine id="a-objet"><input id="a-objet" value={f.objet} maxLength={300} onChange={set('objet')} placeholder="Ex. Fournitures de bureau du mois de mars" /></Champ>
        </div>
      </section>
      <section className="fin-carte">
        <h3 className="fin-titre-section">Lignes</h3>
        <div className="cm-table-wrap">
          <table className="cm-table fin-table fin-saisie-lignes">
            <thead><tr><th style={{ width: '18%' }}>Prestation</th><th>Désignation</th><th className="fin-num" style={{ width: 80 }}>Qté</th>
              <th className="fin-num" style={{ width: 120 }}>Prix unit. HT</th><th className="fin-num" style={{ width: 70 }}>Remise %</th>
              <th style={{ width: 110 }}>Taxe</th><th style={{ width: 100 }}>Compte</th><th className="fin-num" style={{ width: 120 }}>Montant HT</th><th aria-label="Retirer" /></tr></thead>
            <tbody>
              {f.lignes.map((l, i) => {
                const m = calcul(l, ref.taxes);
                return (
                  <tr key={i}>
                    <td><select aria-label={`Prestation ligne ${i + 1}`} value={l.prestation_id} onChange={(e) => choisirPrestation(i, e.target.value)}>
                      <option value="">—</option>{ref.prestations.map((p) => <option key={p.id} value={p.id}>{p.libelle}</option>)}</select></td>
                    <td><input aria-label={`Désignation ligne ${i + 1}`} value={l.designation} maxLength={300} onChange={(e) => setLigne(i, 'designation', e.target.value)} /></td>
                    <td><input aria-label={`Quantité ligne ${i + 1}`} className="fin-num" inputMode="decimal" value={l.quantite} onChange={(e) => setLigne(i, 'quantite', e.target.value)} /></td>
                    <td><input aria-label={`Prix ligne ${i + 1}`} className="fin-num" inputMode="decimal" value={l.prix_unitaire} onChange={(e) => setLigne(i, 'prix_unitaire', e.target.value)} /></td>
                    <td><input aria-label={`Remise ligne ${i + 1}`} className="fin-num" inputMode="decimal" value={l.remise_pct} onChange={(e) => setLigne(i, 'remise_pct', e.target.value)} /></td>
                    <td><select aria-label={`Taxe ligne ${i + 1}`} value={l.taxe_id} onChange={(e) => setLigne(i, 'taxe_id', e.target.value)}>
                      <option value="">Aucune</option>{ref.taxes.map((t) => <option key={t.id} value={t.id}>{t.code} {Number(t.taux)} %</option>)}</select></td>
                    <td><input aria-label={`Compte ligne ${i + 1}`} className="fin-mono" value={l.compte} maxLength={20} placeholder={categorie?.compte_defaut}
                      onChange={(e) => setLigne(i, 'compte', e.target.value.trim())} /></td>
                    <td className="fin-num">{fmtCompta(m.ht / 100, { zero: '0' })}</td>
                    <td><button type="button" className="cm-btn-icone" title="Retirer la ligne" disabled={f.lignes.length === 1}
                      onClick={() => setF((x) => ({ ...x, lignes: x.lignes.filter((_, j) => j !== i) }))}>✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button type="button" className="cm-btn cm-secondaire" onClick={() => setF((x) => ({ ...x, lignes: [...x.lignes, ligneVide(x.lignes[x.lignes.length - 1]?.taxe_id || '')] }))}>+ Ajouter une ligne</button>
        <div className="fin-totaux">
          <div><span>Total HT</span><b>{fmtCompta(totaux.ht / 100, { zero: '0' })}</b></div>
          <div><span>Taxes</span><b>{fmtCompta(totaux.taxe / 100, { zero: '0' })}</b></div>
          <div className="fin-totaux-ttc"><span>Total TTC</span><b>{fmtCompta((totaux.ht + totaux.taxe) / 100, { zero: '0' })}</b></div>
        </div>
      </section>
      <section className="fin-carte">
        <Champ label="Observations" id="a-obs"><textarea id="a-obs" rows={2} maxLength={2000} value={f.observations} onChange={set('observations')} /></Champ>
      </section>
      <div className="fin-barre-actions">
        <Link className="cm-btn cm-secondaire" to={id ? `/finance/achats/fin/${id}` : '/finance/achats'}>Annuler</Link>
        <button type="button" className="cm-btn cm-secondaire" disabled={enCours} onClick={() => enregistrer(false)}>Enregistrer le brouillon</button>
        <button type="button" className="cm-btn cm-primaire" disabled={enCours} onClick={() => enregistrer(true)}>Enregistrer et soumettre à validation</button>
      </div>
    </div>
  );
}

// ── Fiche ───────────────────────────────────────────────────────────────────
function MotifTiroir({ titre, aide, bouton, onFermer, onValider }) {
  const [motif, setMotif] = useState('');
  const [enCours, setEnCours] = useState(false);
  return (
    <Tiroir titre={titre} onFermer={onFermer} pied={<>
      <button type="button" className="cm-btn cm-secondaire" onClick={onFermer}>Fermer</button>
      <button type="button" className="cm-btn cm-danger" disabled={enCours || !motif.trim()} onClick={async () => { setEnCours(true); await onValider(motif); setEnCours(false); }}>{bouton}</button>
    </>}>
      <p className="cm-sous">{aide}</p>
      <Champ label="Motif" requis id="m-motif"><textarea id="m-motif" rows={3} maxLength={500} value={motif} onChange={(e) => setMotif(e.target.value)} /></Champ>
    </Tiroir>
  );
}

function ReglementTiroir({ facture, origine, reste, onFermer, onFait }) {
  const toast = useToast();
  const [sorties, setSorties] = useState(null);
  const [choix, setChoix] = useState(null);
  const [montant, setMontant] = useState('');
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  useEffect(() => {
    api.get(`/finance/achats/sorties-disponibles?tiers_id=${facture.tiers_id}`).then((r) => {
      if (r?.error) setErreur(r.error); else setSorties(r);
    });
  }, [facture.tiers_id]);
  const choisir = (s) => { setChoix(s); setMontant(String(Math.min(Number(s.disponible), Number(reste)))); };
  const valider = async () => {
    setEnCours(true); setErreur('');
    const r = await api.post('/finance/reglements', { mouvement_id: choix.id, affectations: [{ facture_type: origine, facture_id: facture.id, montant }] });
    setEnCours(false);
    if (r?.error) { setErreur(r.error); return; }
    toast('Règlement enregistré.', 'success');
    if (r.anomalies?.length) toast(`Écriture de caisse à compléter : ${r.anomalies[0].motif}`, 'warning', 8000);
    onFait();
  };
  return (
    <Tiroir titre="Relier un paiement" sousTitre={`Reste à payer : ${fmtCompta(reste)} — ${facture.tiers_nom}`} onFermer={onFermer} pied={<>
      <button type="button" className="cm-btn cm-secondaire" onClick={onFermer}>Annuler</button>
      <button type="button" className="cm-btn cm-primaire" disabled={!choix || enCours || !(Number(montant) > 0)} onClick={valider}>Enregistrer le règlement</button>
    </>}>
      <p className="cm-sous">Le paiement se saisit dans la caisse ou la banque (sortie, avec le fournisseur comme bénéficiaire) ; reliez-le ici à la facture.
        Vous pouvez aussi le relier au moment de la saisie de la sortie.</p>
      <Erreur message={erreur} />
      {!sorties ? <div className="loading-msg">Chargement…</div> : sorties.length === 0 ? (
        <div className="fin-vide"><h3>Aucune sortie libre</h3><p>Saisissez d'abord le paiement dans le journal de caisse ou de banque.</p></div>
      ) : (
        <div className="fin-choix-liste">
          {sorties.map((s) => (
            <label key={s.id} className={`fin-choix ${choix?.id === s.id ? 'actif' : ''}`}>
              <input type="radio" name="sortie" checked={choix?.id === s.id} onChange={() => choisir(s)} />
              <span className="fin-choix-corps">
                <b>{fmtDate(s.date)} · {s.caisse}-{s.numero}</b> {s.intitule}{s.beneficiaire && ` — ${s.beneficiaire}`}
                <small>{s.tiers_id ? '' : 'Bénéficiaire non relié au registre · '}Sortie {fmtCompta(s.sortie)} · libre {fmtCompta(s.disponible)}</small>
              </span>
            </label>
          ))}
        </div>
      )}
      {choix && <Champ label="Montant réglé sur cette facture" requis id="r-montant"><input id="r-montant" inputMode="decimal" value={montant} onChange={(e) => setMontant(e.target.value)} /></Champ>}
    </Tiroir>
  );
}

function ImputationCarte({ d, onFait }) {
  const toast = useToast();
  const { can } = useApp();
  const [ref, setRef] = useState(null);
  const f = d.facture;
  const [v, setV] = useState({ categorie_id: f.categorie_id || '', compte: f.imputation_compte || '', activite_id: f.activite_id || '' });
  const [ouvert, setOuvert] = useState(!f.imputation_id);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  useEffect(() => { api.get('/finance/achats/referentiels').then((r) => { if (!r?.error) { setRef(r); setV((x) => ({ ...x, categorie_id: x.categorie_id || r.categories.find((c) => c.code === 'ACH_MARCH')?.id || '' })); } }); }, []);
  if (f.statut !== 'validee') return null;
  const peut = can('finance.achats.valider');
  const imputer = async () => {
    setEnCours(true); setErreur('');
    const r = await api.post(`/finance/achats/com_ff/${f.id}/imputer`, v);
    setEnCours(false);
    if (r?.error) { setErreur(r.error); return; }
    toast('Facture imputée : écriture d\'achat passée.', 'success');
    setOuvert(false); onFait();
  };
  return (
    <section className={`fin-carte ${!f.imputation_id ? 'fin-carte-alerte' : ''}`}>
      <div className="fin-carte-tete">
        <div>
          <h3>Imputation comptable</h3>
          <p>{f.imputation_id ? `Catégorie « ${f.categorie} » · imputée le ${fmtDate(f.impute_le)} par ${f.impute_par_nom || '—'} · fournisseur au ${f.compte_tiers}`
            : 'Cette facture a été validée dans NJ COMMERCIAL. Choisissez sa catégorie : l\'écriture d\'achat est passée et la facture devient payable.'}</p>
        </div>
        {f.imputation_id && peut && !ouvert && <button type="button" className="cm-btn cm-secondaire" onClick={() => setOuvert(true)}>Modifier l'imputation</button>}
      </div>
      {ouvert && ref && (peut ? (
        <>
          <Erreur message={erreur} />
          <div className="cm-grille">
            <Champ label="Catégorie" requis id="i-cat"><select id="i-cat" value={v.categorie_id} onChange={(e) => setV({ ...v, categorie_id: e.target.value })}>
              <option value="">— choisir —</option>{ref.categories.map((c) => <option key={c.id} value={c.id}>{c.libelle} ({c.compte_defaut})</option>)}</select></Champ>
            <Champ label="Compte (facultatif)" id="i-compte" aide="Sinon : compte de l'article dans NJ FINANCE, puis celui de la catégorie">
              <input id="i-compte" className="fin-mono" value={v.compte} maxLength={20} onChange={(e) => setV({ ...v, compte: e.target.value.trim() })} /></Champ>
            {ref.ong && <Champ label="Activité / projet" id="i-act"><select id="i-act" value={v.activite_id} onChange={(e) => setV({ ...v, activite_id: e.target.value })}>
              <option value="">— Non ventilé —</option>{ref.activites.map((a) => <option key={a.id} value={a.id}>{a.nom}</option>)}</select></Champ>}
          </div>
          <div className="cm-actions"><button type="button" className="cm-btn cm-primaire" disabled={enCours || !v.categorie_id} onClick={imputer}>{f.imputation_id ? 'Enregistrer' : 'Imputer la facture'}</button></div>
        </>
      ) : <p className="cm-sous">L'imputation est faite par une personne habilitée à valider les achats.</p>)}
    </section>
  );
}

export function AchatFichePage() {
  const { origine, id } = useParams();
  const { can, user } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState('');
  const [tiroir, setTiroir] = useState(null);
  const charger = useCallback(async () => {
    const r = await api.get(`/finance/achats/${origine}/${id}`);
    if (r?.error) { setErreur(r.error); return; }
    setErreur(''); setD(r);
  }, [origine, id]);
  useEffect(() => { charger(); }, [charger]);
  if (erreur && !d) return <div className="cm-page"><Link to="/finance/achats" className="fin-lien">‹ Factures fournisseurs</Link><Erreur message={erreur} /></div>;
  if (!d) return <div className="loading-msg">Chargement…</div>;
  const f = d.facture;
  const fin = origine === 'fin';
  const auteur = fin && f.cree_par && f.cree_par === user?.id;
  const action = async (chemin, corps = {}, message = 'Enregistré.') => {
    const r = await api.post(`/finance/achats/fin/${id}/${chemin}`, corps);
    if (r?.error) { toast(r.error, 'error', 8000); return false; }
    toast(message, 'success'); setTiroir(null); charger(); return true;
  };
  const supprimer = async () => {
    if (!window.confirm('Supprimer ce brouillon ?')) return;
    const r = await api.delete(`/finance/achats/fin/${id}`);
    if (r?.error) { toast(r.error, 'error'); return; }
    toast('Brouillon supprimé.', 'success'); navigate('/finance/achats');
  };
  const retirer = async (a) => {
    if (!window.confirm(`Retirer le règlement de ${fmtCompta(a.montant)} (${a.caisse}-${a.numero}) ? La sortie redevient libre.`)) return;
    const r = await api.delete(`/finance/reglements/${a.id}`);
    if (r?.error) { toast(r.error, 'error'); return; }
    toast('Règlement retiré.', 'success'); charger();
  };
  const estFacture = f.type === 'facture';
  const payable = d.reste !== null && Number(d.reste) > 0;
  const etat = !fin && f.statut === 'validee' && !f.imputation_id ? 'À imputer'
    : f.statut === 'validee' && estFacture ? (Number(d.reste) <= 0 ? 'Réglée' : Number(d.reste) < Number(f.total_ttc) ? 'Réglée en partie' : 'À payer')
      : f.statut_libelle;
  return (
    <div className="cm-page fin-page">
      <Link to="/finance/achats" className="fin-lien">‹ Factures fournisseurs</Link>
      <div className="fin-fiche-tete">
        <div className="fin-avatar" aria-hidden="true">{estFacture ? 'FA' : 'AV'}</div>
        <div className="fin-fiche-id">
          <h2>{estFacture ? 'Facture' : 'Avoir'} {f.numero || '(non numérotée)'} <BadgeEtat etat={etat} /></h2>
          <div className="fin-fiche-meta">
            <span><Link to={`/finance/tiers/${f.tiers_id}`}>{f.tiers_nom}</Link></span>
            <span>Réf. fournisseur <b className="fin-mono">{f.reference}</b></span>
            <span>{fin ? 'Saisie dans NJ FINANCE' : 'NJ COMMERCIAL'}</span>
            {f.categorie && <span>{f.categorie}</span>}
            {f.activite && <span>🎯 {f.activite}</span>}
            {f.origine_numero && <span>Sur la facture {f.origine_numero}</span>}
          </div>
        </div>
        <div className="cm-actions">
          {fin && ['brouillon', 'a_valider'].includes(f.statut) && can('finance.achats.saisir') && <>
            <Link className="cm-btn cm-secondaire" to={`/finance/achats/fin/${id}/modifier`}>Modifier</Link>
            <button type="button" className="cm-btn cm-secondaire" onClick={supprimer}>Supprimer</button>
            {f.statut === 'brouillon' && <button type="button" className="cm-btn cm-secondaire" onClick={() => action('soumettre', {}, 'Soumise à validation.')}>Soumettre</button>}
          </>}
          {fin && ['brouillon', 'a_valider'].includes(f.statut) && can('finance.achats.valider') && <>
            {f.statut === 'a_valider' && <button type="button" className="cm-btn cm-secondaire" onClick={() => setTiroir('renvoi')}>Renvoyer</button>}
            <button type="button" className="cm-btn cm-primaire" disabled={auteur} title={auteur ? 'Vous avez saisi cette facture : une autre personne doit la valider' : undefined}
              onClick={() => action('valider', {}, 'Facture validée : écriture d\'achat passée.')}>Valider</button>
          </>}
          {fin && f.statut === 'validee' && estFacture && can('finance.achats.saisir') && <Link className="cm-btn cm-secondaire" to={`/finance/achats/nouvelle?avoir=${id}`}>Passer un avoir</Link>}
          {fin && f.statut === 'validee' && can('finance.achats.valider') && <button type="button" className="cm-btn cm-danger" onClick={() => setTiroir('annulation')}>Annuler</button>}
          {payable && can('finance.reglements.affecter') && <button type="button" className="cm-btn cm-primaire" onClick={() => setTiroir('reglement')}>Relier un paiement</button>}
        </div>
      </div>
      {f.motif_renvoi && f.statut === 'brouillon' && <div className="fin-bandeau">Renvoyée au brouillon : {f.motif_renvoi}</div>}
      {f.statut === 'annulee' && <div className="fin-bandeau fin-bandeau-gris">Annulée{f.annule_par_nom ? ` par ${f.annule_par_nom}` : ''}{f.motif_annulation ? ` : ${f.motif_annulation}` : ''}</div>}
      {auteur && ['brouillon', 'a_valider'].includes(f.statut) && <div className="fin-bandeau fin-bandeau-gris">Vous avez saisi cette facture : une autre personne habilitée la validera.</div>}
      <div className="fin-kpis">
        <Kpi libelle="Total HT" valeur={fmtCompta(f.total_ht, { zero: '0' })} />
        <Kpi libelle="Taxes" valeur={fmtCompta(f.total_taxes, { zero: '0' })} />
        <Kpi libelle="Total TTC" valeur={fmtCompta(f.total_ttc, { zero: '0' })} />
        {estFacture && <Kpi libelle="Reste à payer" valeur={d.reste === null ? '—' : fmtCompta(d.reste, { zero: '0' })}
          ton={d.reste === null ? '' : Number(d.reste) > 0 ? 'alerte' : 'ok'} aide={`Échéance ${fmtDate(f.date_echeance)}`} />}
      </div>
      {!fin && <ImputationCarte d={d} onFait={charger} />}
      <section className="fin-carte">
        <div className="fin-carte-tete"><div><h3>Détail</h3><p>Date {fmtDate(f.date_facture)}{f.objet ? ` · ${f.objet}` : ''}</p></div></div>
        <div className="cm-table-wrap">
          <table className="cm-table fin-table">
            <thead><tr><th>Désignation</th><th className="fin-num">Qté</th><th className="fin-num">Prix unit. HT</th><th className="fin-num">Remise</th>
              <th>Taxe</th>{fin && <th>Compte</th>}<th className="fin-num">Montant HT</th></tr></thead>
            <tbody>
              {d.lignes.map((l) => (
                <tr key={l.id}><td>{l.designation}</td><td className="fin-num">{Number(l.quantite).toLocaleString('fr-FR')}{l.unite ? ` ${l.unite}` : ''}</td>
                  <td className="fin-num">{fmtCompta(l.prix_unitaire)}</td><td className="fin-num">{Number(l.remise_pct) ? `${Number(l.remise_pct)} %` : '—'}</td>
                  <td>{l.taxe_code ? `${l.taxe_code} ${Number(l.taxe_taux)} %` : '—'}</td>{fin && <td className="fin-mono">{l.compte}</td>}
                  <td className="fin-num">{fmtCompta(l.montant_ht)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {estFacture && f.statut !== 'brouillon' && f.statut !== 'a_valider' && (
        <section className="fin-carte">
          <div className="fin-carte-tete"><div><h3>Règlements</h3><p>Sorties de caisse ou de banque reliées à cette facture.</p></div></div>
          {d.reglements.length === 0 ? <p className="cm-sous">Aucun règlement.</p> : (
            <div className="cm-table-wrap">
              <table className="cm-table fin-table">
                <thead><tr><th>Date</th><th>Mouvement</th><th>Libellé</th><th className="fin-num">Montant</th><th>Relié par</th><th aria-label="Actions" /></tr></thead>
                <tbody>
                  {d.reglements.map((a) => (
                    <tr key={a.id} className={a.annule ? 'fin-ligne-annulee' : ''}>
                      <td>{fmtDate(a.date)}</td><td className="fin-mono">{a.caisse}-{a.numero}</td>
                      <td>{a.intitule}{a.annule && <div className="cm-sous">Sortie annulée en caisse : ce règlement ne compte plus</div>}</td>
                      <td className="fin-num">{fmtCompta(a.montant)}</td><td>{a.par || '—'}</td>
                      <td>{!a.annule && can('finance.reglements.affecter') && <button type="button" className="cm-btn-lien" onClick={() => retirer(a)}>Retirer</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {d.avoirs.length > 0 && <>
            <h4 className="fin-sous-titre">Avoirs</h4>
            <ul className="fin-liste-simple">
              {d.avoirs.map((a) => <li key={a.id}><Link to={`/finance/achats/${origine}/${a.id}`}>{a.numero || 'Brouillon'}</Link> · réf. {a.reference} · {fmtDate(a.date_facture)} · {fmtCompta(a.total_ttc)} · {a.statut}</li>)}
            </ul>
          </>}
        </section>
      )}
      {d.ecritures.length > 0 && (
        <section className="fin-carte">
          <div className="fin-carte-tete"><div><h3>Écritures</h3><p>Journal des achats ; une facture annulée est extournée, jamais supprimée.</p></div></div>
          <ul className="fin-liste-simple">
            {d.ecritures.map((e) => <li key={e.id}><span className="fin-mono">{numeroEcriture(e)}</span> du {fmtDate(e.date)}{e.extournee ? ' — extournée' : ''}</li>)}
          </ul>
        </section>
      )}
      <p className="cm-sous">
        {fin && f.cree_par_nom && `Saisie par ${f.cree_par_nom}`}{fin && f.soumis_par_nom && ` · soumise par ${f.soumis_par_nom}`}
        {f.valide_par_nom && ` · validée par ${f.valide_par_nom}${f.valide_le ? ` le ${fmtDate(String(f.valide_le).slice(0, 10))}` : ''}`}
      </p>
      {tiroir === 'reglement' && <ReglementTiroir facture={f} origine={origine} reste={d.reste} onFermer={() => setTiroir(null)} onFait={() => { setTiroir(null); charger(); }} />}
      {tiroir === 'annulation' && <MotifTiroir titre={`Annuler ${f.numero}`} bouton="Annuler la facture"
        aide="L'écriture d'achat est extournée. Une facture déjà réglée ou portant un avoir ne s'annule pas : retirez d'abord ses règlements ou annulez l'avoir."
        onFermer={() => setTiroir(null)} onValider={(motif) => action('annuler', { motif }, 'Facture annulée : écriture extournée.')} />}
      {tiroir === 'renvoi' && <MotifTiroir titre="Renvoyer au brouillon" bouton="Renvoyer" aide="La personne qui l'a saisie verra votre motif et pourra corriger la facture."
        onFermer={() => setTiroir(null)} onValider={(motif) => action('renvoyer', { motif }, 'Facture renvoyée au brouillon.')} />}
    </div>
  );
}

// ── Échéancier ──────────────────────────────────────────────────────────────
export function EcheancierPage() {
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState('');
  useEffect(() => { api.get('/finance/achats/echeancier').then((r) => (r?.error ? setErreur(r.error) : setD(r))); }, []);
  if (erreur) return <div className="cm-page"><Erreur message={erreur} /></div>;
  if (!d) return <div className="loading-msg">Chargement…</div>;
  const exporter = () => exporterExcel('Echeancier_fournisseurs', ['Tranche', 'Fournisseur', 'N°', 'Référence', 'Échéance', 'Reste à payer'],
    d.groupes.flatMap((g) => g.factures.map((f) => [g.libelle, f.tiers_nom, f.numero, f.reference, f.date_echeance || '', +f.reste])));
  const tons = { echu_60: 'danger', echu_30: 'danger', echu: 'alerte' };
  return (
    <div className="cm-page fin-page">
      <div className="cm-entete">
        <div><h2>Échéancier fournisseurs</h2><p>Factures restant à payer au {fmtDate(d.au)}, par échéance. Total : <b>{fmtCompta(d.total, { zero: '0' })}</b>.</p></div>
        <div className="cm-actions"><button type="button" className="cm-btn cm-secondaire" onClick={exporter}>Exporter</button></div>
      </div>
      <div className="fin-kpis">
        {d.groupes.filter((g) => g.code !== 'sans' || g.nombre).map((g) => (
          <Kpi key={g.code} libelle={g.libelle} valeur={fmtCompta(g.total, { zero: '0' })} aide={`${g.nombre} facture(s)`} ton={g.nombre ? tons[g.code] || '' : ''} />
        ))}
      </div>
      {d.groupes.filter((g) => g.nombre).map((g) => (
        <section key={g.code} className="fin-carte">
          <div className="fin-carte-tete"><div><h3>{g.libelle}</h3><p>{g.nombre} facture(s) · {fmtCompta(g.total)}</p></div></div>
          <div className="cm-table-wrap">
            <table className="cm-table fin-table">
              <thead><tr><th>Fournisseur</th><th>N°</th><th>Référence</th><th>Échéance</th><th className="fin-num">TTC</th><th className="fin-num">Reste à payer</th></tr></thead>
              <tbody>
                {g.factures.map((f) => (
                  <tr key={f.cle} className="cm-cliquable" tabIndex={0} onClick={() => navigate(lienFacture(f))} onKeyDown={(e) => { if (e.key === 'Enter') navigate(lienFacture(f)); }}>
                    <td><b>{f.tiers_nom}</b></td><td className="fin-mono">{f.numero}</td><td className="fin-mono">{f.reference}</td>
                    <td className={f.echue ? 'fin-retard' : ''}>{fmtDate(f.date_echeance)}{f.echue && <div className="cm-sous">{f.jours_retard} j de retard</div>}</td>
                    <td className="fin-num">{fmtCompta(f.total_ttc)}</td><td className="fin-num fin-fort">{fmtCompta(f.reste)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {!d.groupes.some((g) => g.nombre) && <div className="fin-vide"><div className="fin-vide-icone" aria-hidden="true">✅</div><h3>Rien à payer</h3><p>Toutes les factures fournisseurs sont réglées.</p></div>}
    </div>
  );
}
