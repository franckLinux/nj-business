// NJ FINANCE — Achats (lot F6, migration 080) et Ventes et facturation (lot F8, 081).
// Les mêmes écrans servent aux deux sens (prop `sens`).
// Achats : factures et avoirs fournisseurs saisis dans NJ FINANCE, ou validés dans
// NJ COMMERCIAL et lus par référence (imputation seulement).
// Ventes : factures, avoirs et proformas clients, PDF au logo de l'entreprise.
// Règlement : « Enregistrer le paiement » crée le mouvement de caisse ou de banque
// (mêmes contrôles que la caisse) ; ou un mouvement déjà saisi est relié ; ou un
// règlement hors caisse ni banque est proposé, valable une fois validé par le directeur.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { Champ, Tiroir, useDiffere } from '@/components/commercial/ui';
import { exporterExcel } from '@/lib/export';
import { ouvrirFichier } from '@/components/commercial/achats';
import { ChampCompte, Erreur, fmtCompta, fmtDate, aujourdhui } from '@/pages/comptabilite/commun';

const ETATS = {
  Brouillon: 'gris', 'À valider': 'orange', 'À imputer': 'violet', 'À payer': 'orange', 'À encaisser': 'orange', 'Réglée en partie': 'bleu',
  Réglée: 'vert', Validée: 'vert', Annulée: 'rouge', Émise: 'bleu', Facturée: 'vert',
};

// Paramètres de chaque sens.
const CFG = {
  fournisseur: {
    api: '/finance/achats', base: '/finance/achats', fiche: (f) => `/finance/achats/${f.origine}/${f.id}`, action: (id) => `/finance/achats/fin/${id}`,
    tiers: 'Fournisseur', tiersPluriel: 'fournisseurs', titreListe: 'Factures fournisseurs', titreEcheancier: 'Échéancier fournisseurs',
    perms: { saisir: 'finance.achats.saisir', valider: 'finance.achats.valider' }, reste: 'Reste à payer', aPayer: 'À payer',
    ouvertes: '/finance/achats/ouvertes', disponibles: '/finance/achats/sorties-disponibles', mouvement: 'sortie',
  },
  client: {
    api: '/finance/ventes', base: '/finance/ventes', fiche: (f) => `/finance/ventes/${f.id}`, action: (id) => `/finance/ventes/${id}`,
    tiers: 'Client', tiersPluriel: 'clients', titreListe: 'Factures clients', titreEcheancier: 'Échéancier clients',
    perms: { saisir: 'finance.ventes.facturer', valider: 'finance.ventes.valider' }, reste: 'Reste à encaisser', aPayer: 'À encaisser',
    ouvertes: '/finance/ventes/ouvertes', disponibles: '/finance/ventes/entrees-disponibles', mouvement: 'entrée',
  },
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
const lienFacture = (f) => CFG[f.sens || 'fournisseur'].fiche(f);
const numeroEcriture = (e) => (e.numero ? `${e.journal_code}-${e.exercice_code}-${String(e.numero).padStart(5, '0')}` : 'brouillard');

// ── Liste ───────────────────────────────────────────────────────────────────
const FILTRES = {
  fournisseur: [['', 'Toutes'], ['a_valider', 'À valider'], ['a_imputer', 'À imputer'], ['a_payer', 'À payer'], ['echues', 'Échues'], ['annulees', 'Annulées']],
  client: [['', 'Tous'], ['factures', 'Factures et avoirs'], ['proformas', 'Proformas'], ['a_valider', 'À valider'], ['a_payer', 'À encaisser'], ['echues', 'Échues'], ['annulees', 'Annulés']],
};

export function AchatsListePage({ sens = 'fournisseur' }) {
  const C = CFG[sens];
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
    const r = await api.get(`${C.api}?${q}`);
    if (r?.error) { setErreur(r.error); return; }
    setErreur(''); setD({ ...r, factures: r.factures.map((f) => ({ ...f, sens })) });
  }, [filtre, origine, rech, C.api, sens]);
  useEffect(() => { charger(); }, [charger]);
  const choisir = (f) => setParams(f ? { filtre: f } : {});
  const exporter = () => exporterExcel(sens === 'client' ? 'Factures_clients' : 'Factures_fournisseurs', ['Origine', 'N°', 'Référence', C.tiers, 'Date', 'Échéance', 'HT', 'Taxes', 'TTC', 'Reste à payer', 'État'],
    d.factures.map((f) => [f.origine_libelle, f.numero, f.reference, f.tiers_nom, f.date_facture, f.date_echeance || '', +f.total_ht, +f.total_taxes,
      (f.type === 'avoir' ? -1 : 1) * f.total_ttc, f.reste === null ? '' : +f.reste, f.etat]));
  return (
    <div className="cm-page fin-page">
      <div className="cm-entete">
        <div>
          <h2>{C.titreListe}</h2>
          <p>{sens === 'client'
            ? 'Factures, avoirs et proformas, avec PDF au logo de l\'entreprise. Un encaissement par la caisse ou la banque se fait depuis la facture.'
            : 'Factures saisies ici et factures validées dans NJ COMMERCIAL, en une seule liste. Le paiement par la caisse ou la banque se fait depuis la facture.'}</p>
        </div>
        <div className="cm-actions">
          <button type="button" className="cm-btn cm-secondaire" disabled={!d?.factures?.length} onClick={exporter}>Exporter</button>
          {can(C.perms.saisir) && sens === 'client' && <Link className="cm-btn cm-secondaire" to="/finance/ventes/nouvelle?type=proforma">+ Proforma</Link>}
          {can(C.perms.saisir) && <Link className="cm-btn cm-primaire" to={`${C.base}/nouvelle`}>+ Nouvelle facture</Link>}
        </div>
      </div>
      {d && (
        <div className="fin-kpis">
          <Kpi libelle="À valider" valeur={d.compteurs.a_valider} aide={d.compteurs.brouillons ? `${d.compteurs.brouillons} brouillon(s)` : 'Soumises à validation'}
            ton={d.compteurs.a_valider ? 'alerte' : ''} onClick={() => choisir('a_valider')} actif={filtre === 'a_valider'} />
          {sens === 'fournisseur' ? (
            <Kpi libelle="À imputer (NJ COMMERCIAL)" valeur={d.compteurs.a_imputer} ton={d.compteurs.a_imputer ? 'alerte' : ''}
              onClick={() => choisir('a_imputer')} actif={filtre === 'a_imputer'} aide="Factures validées sans imputation" />
          ) : (
            <Kpi libelle="Proformas émises" valeur={d.compteurs.proformas} aide="En attente de commande" onClick={() => choisir('proformas')} actif={filtre === 'proformas'} />
          )}
          <Kpi libelle={C.reste} valeur={fmtCompta(d.compteurs.reste_total, { zero: '0' })} aide={`${d.compteurs.a_payer} facture(s)`}
            onClick={() => choisir('a_payer')} actif={filtre === 'a_payer'} />
          <Kpi libelle="Échu" valeur={fmtCompta(d.compteurs.echu_total, { zero: '0' })} aide={`${d.compteurs.echues} facture(s) en retard`}
            ton={d.compteurs.echues ? 'danger' : 'ok'} onClick={() => choisir('echues')} actif={filtre === 'echues'} />
        </div>
      )}
      {d?.compteurs.hors_caisse_a_valider > 0 && (
        <div className="fin-bandeau">{d.compteurs.hors_caisse_a_valider} règlement(s) hors caisse ni banque attendent la décision du directeur : ouvrez la facture concernée.</div>
      )}
      <div className="fin-onglets" role="tablist">
        {FILTRES[sens].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={filtre === k} className={filtre === k ? 'actif' : ''} onClick={() => choisir(k)}>{l}</button>)}
      </div>
      <div className="fin-filtres">
        <input type="search" className="fin-recherche" placeholder={`N°, référence, ${C.tiers.toLowerCase()}, objet…`} value={recherche} onChange={(e) => setRecherche(e.target.value)} />
        {sens === 'fournisseur' && (
          <select value={origine} onChange={(e) => setOrigine(e.target.value)} aria-label="Origine">
            <option value="">Toutes origines</option><option value="fin">Saisies dans NJ FINANCE</option><option value="com_ff">NJ COMMERCIAL</option>
          </select>
        )}
      </div>
      <Erreur message={erreur} />
      {d && (d.factures.length === 0 ? (
        <div className="fin-vide"><div className="fin-vide-icone" aria-hidden="true">🧾</div><h3>Aucune facture</h3>
          <p>{filtre ? 'Aucun document dans ce filtre.' : `Enregistrez la première facture ${sens === 'client' ? 'client' : 'fournisseur'} avec « Nouvelle facture ».`}</p></div>
      ) : (
        <div className="cm-table-wrap">
          <table className="cm-table fin-table">
            <thead><tr><th>N°</th><th>{C.tiers}</th><th>Référence</th><th>Date</th><th>Échéance</th>
              <th className="fin-num">TTC</th><th className="fin-num">{C.reste}</th><th>État</th></tr></thead>
            <tbody>
              {d.factures.map((f) => (
                <tr key={f.cle} className="cm-cliquable" tabIndex={0} onClick={() => navigate(lienFacture(f))} onKeyDown={(e) => { if (e.key === 'Enter') navigate(lienFacture(f)); }}>
                  <td className="fin-mono">{f.numero || <span className="cm-sous">brouillon</span>}
                    <div className="cm-sous">{f.type === 'avoir' ? 'Avoir' : f.type === 'proforma' ? 'Proforma' : 'Facture'}{sens === 'fournisseur' ? (f.origine === 'com_ff' ? ' · NJ COMMERCIAL' : ' · NJ FINANCE') : ''}</div></td>
                  <td><b>{f.tiers_nom}</b>{f.objet && <div className="cm-sous">{f.objet}</div>}</td>
                  <td className="fin-mono">{f.reference || '—'}</td>
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

export function AchatSaisiePage({ sens = 'fournisseur' }) {
  const C = CFG[sens];
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
      const r = await api.get(`${C.api}/referentiels`);
      if (r?.error) { setErreur(r.error); return; }
      setRef(r);
      const tva = r.taxes.find((t) => t.code === 'TVA')?.id || '';
      if (id) {
        const x = await api.get(C.action(id));
        if (x?.error) { setErreur(x.error); return; }
        const fa = x.facture;
        if (fa.facture_origine_id) setOrigineFacture({ numero: fa.origine_numero, reference: fa.origine_reference });
        setF({ type: fa.type, tiers_id: fa.tiers_id, reference: fa.reference, date_facture: fa.date_facture, date_echeance: fa.date_echeance || '',
          categorie_id: fa.categorie_id, objet: fa.objet, observations: fa.observations, activite_id: fa.activite_id ? String(fa.activite_id) : '',
          facture_origine_id: fa.facture_origine_id, motif_renvoi: fa.motif_renvoi, conditions_paiement: fa.conditions_paiement || '',
          lignes: x.lignes.map((l) => ({ prestation_id: l.prestation_id || '', designation: l.designation, quantite: String(Number(l.quantite)),
            prix_unitaire: String(Number(l.prix_unitaire)), remise_pct: Number(l.remise_pct) ? String(Number(l.remise_pct)) : '', taxe_id: l.taxe_id || '', compte: l.compte })) });
        return;
      }
      const origine = params.get('avoir');
      if (origine) {
        const o = await api.get(C.action(origine));
        if (o?.error) { setErreur(o.error); return; }
        setOrigineFacture({ numero: o.facture.numero, reference: o.facture.reference });
        setF({ type: 'avoir', tiers_id: o.facture.tiers_id, reference: '', date_facture: aujourdhui(), date_echeance: '', categorie_id: o.facture.categorie_id,
          objet: `Avoir sur ${o.facture.numero}`, observations: '', conditions_paiement: '', activite_id: o.facture.activite_id ? String(o.facture.activite_id) : '', facture_origine_id: origine,
          lignes: o.lignes.map((l) => ({ prestation_id: l.prestation_id || '', designation: l.designation, quantite: String(Number(l.quantite)),
            prix_unitaire: String(Number(l.prix_unitaire)), remise_pct: '', taxe_id: l.taxe_id || '', compte: l.compte })) });
        return;
      }
      setF({ type: sens === 'client' && params.get('type') === 'proforma' ? 'proforma' : 'facture', tiers_id: params.get('tiers') || '', reference: '',
        date_facture: aujourdhui(), date_echeance: '', conditions_paiement: '',
        categorie_id: r.categories.find((c) => c.code === (sens === 'client' ? 'PRESTA' : 'FOURN'))?.id || r.categories[0]?.id || '', objet: '', observations: '', activite_id: '',
        lignes: [ligneVide(tva)] });
    })();
  }, [id, params, C, sens]);

  const totaux = useMemo(() => {
    if (!f || !ref) return { ht: 0, taxe: 0 };
    return f.lignes.reduce((t, l) => { const m = calcul(l, ref.taxes); return { ht: t.ht + m.ht, taxe: t.taxe + m.taxe }; }, { ht: 0, taxe: 0 });
  }, [f, ref]);

  if (erreur && !f) return <div className="cm-page"><Link to={C.base} className="fin-lien">‹ {C.titreListe}</Link><Erreur message={erreur} /></div>;
  if (!f || !ref) return <div className="loading-msg">Chargement…</div>;
  if (!ref.categories.length) {
    return (
      <div className="cm-page fin-page">
        <Link to={C.base} className="fin-lien">‹ {C.titreListe}</Link>
        <div className="fin-vide"><div className="fin-vide-icone" aria-hidden="true">⚙️</div><h3>Paramétrage à faire</h3>
          <p>Aucune catégorie de {sens === 'client' ? 'produits' : 'charges'} : créez le paramétrage standard dans Configuration → Facturation.</p>
          <Link className="cm-btn cm-primaire" to="/config" state={{ onglet: 'facturation' }}>Ouvrir la configuration</Link></div>
      </div>
    );
  }
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setLigne = (i, k, v) => setF((x) => ({ ...x, lignes: x.lignes.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));
  const choisirPrestation = (i, pid) => {
    const p = ref.prestations.find((x) => x.id === pid);
    setF((x) => ({ ...x, lignes: x.lignes.map((l, j) => (j !== i ? l : { ...l, prestation_id: pid,
      ...(p ? { designation: l.designation || p.libelle, prix_unitaire: l.prix_unitaire || (p.prix !== null && p.prix !== undefined ? String(Number(p.prix)) : ''),
        taxe_id: p.taxe_id || l.taxe_id, compte: p.compte || l.compte } : {}) })) }));
  };
  const fournisseur = ref.tiers.find((t) => t.id === String(f.tiers_id));
  const categorie = ref.categories.find((c) => c.id === String(f.categorie_id));
  const proforma = f.type === 'proforma';
  const echeanceAuto = !f.date_facture ? '' : f.type === 'facture' && fournisseur ? ajouterJours(f.date_facture, fournisseur.delai)
    : proforma ? ajouterJours(f.date_facture, 30) : '';
  const enregistrer = async (soumettre) => {
    setErreur(''); setDoublon(null); setEnCours(true);
    const corps = { ...f, soumettre, lignes: f.lignes.filter((l) => l.designation.trim() || nombre(l.prix_unitaire)) };
    const r = id ? await api.put(C.action(id), corps) : await api.post(C.api, corps);
    setEnCours(false);
    if (r?.error) { setErreur(r.error); setDoublon(r.doublon || null); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    toast(soumettre ? 'Facture enregistrée et soumise à validation.' : 'Brouillon enregistré.', 'success');
    navigate(C.action(r.id));
  };
  const avoir = f.type === 'avoir';
  const nature = proforma ? 'proforma' : avoir ? 'avoir' : 'facture';
  const titres = {
    proforma: id ? 'Modifier la proforma' : 'Nouvelle proforma',
    avoir: id ? "Modifier l'avoir" : `Nouvel avoir ${sens === 'client' ? 'client' : 'fournisseur'}`,
    facture: id ? 'Modifier la facture' : `Nouvelle facture ${sens === 'client' ? 'client' : 'fournisseur'}`,
  };
  const intro = avoir ? `Avoir sur la facture ${origineFacture?.numero || ''}${origineFacture?.reference ? ` (réf. ${origineFacture.reference})` : ''} : il réduit ce qui reste à ${sens === 'client' ? 'encaisser' : 'payer'}.`
    : proforma ? 'La proforma reçoit son numéro (PRO-…) à l\'émission et se transforme ensuite en facture en un clic. Elle ne passe aucune écriture.'
      : sens === 'client' ? 'Le numéro (FAC-…) est attribué à la validation, qui passe aussi l\'écriture de vente. Une autre personne que vous doit valider.'
        : 'Le numéro interne est attribué à la validation, qui passe aussi l\'écriture d\'achat. Une autre personne que vous doit valider.';
  return (
    <div className="cm-page fin-page">
      <Link to={id ? C.action(id) : C.base} className="fin-lien">‹ {id ? 'Retour au document' : C.titreListe}</Link>
      <div className="cm-entete">
        <div>
          <h2>{titres[nature]}</h2>
          <p>{intro}</p>
        </div>
      </div>
      {f.motif_renvoi && <div className="fin-bandeau">Renvoyée au brouillon : {f.motif_renvoi}</div>}
      <Erreur message={erreur} />
      {doublon && <div className="fin-bandeau">Pièce déjà enregistrée : <Link to={`/finance/achats/${doublon.origine}/${doublon.id}`}>ouvrir la facture existante</Link></div>}
      <section className="fin-carte">
        <div className="cm-grille">
          <Champ label={C.tiers} requis id="a-tiers" aide={fournisseur ? `Délai de paiement : ${fournisseur.delai} jours` : <Link to="/finance/tiers">Créer un {C.tiers.toLowerCase()}</Link>}>
            <select id="a-tiers" value={f.tiers_id} disabled={avoir} onChange={set('tiers_id')}>
              <option value="">— choisir —</option>
              {ref.tiers.map((t) => <option key={t.id} value={t.id}>{t.nom}{t.nui ? ` · ${t.nui}` : ''}</option>)}
            </select>
          </Champ>
          {sens === 'client' ? (
            <Champ label="Référence du client" id="a-ref" aide="Son bon de commande, facultatif"><input id="a-ref" value={f.reference} maxLength={60} onChange={set('reference')} /></Champ>
          ) : (
            <Champ label={avoir ? "Référence de l'avoir du fournisseur" : 'Référence de la facture du fournisseur'} requis id="a-ref" aide="Numéro porté sur la pièce reçue">
              <input id="a-ref" value={f.reference} maxLength={60} onChange={set('reference')} />
            </Champ>
          )}
          <Champ label={avoir ? "Date de l'avoir" : proforma ? 'Date de la proforma' : 'Date de la facture'} requis id="a-date"><input id="a-date" type="date" value={f.date_facture} onChange={set('date_facture')} /></Champ>
          {!avoir && (
            <Champ label={proforma ? 'Valable jusqu\'au' : 'Échéance'} id="a-ech" aide={echeanceAuto && !f.date_echeance ? `Par défaut : ${fmtDate(echeanceAuto)}` : undefined}>
              <input id="a-ech" type="date" value={f.date_echeance} min={f.date_facture} onChange={set('date_echeance')} />
            </Champ>
          )}
          <Champ label="Catégorie" requis id="a-cat" aide={categorie ? `${categorie.type_achat ? `${ref.types_achat[categorie.type_achat]} · ` : ''}compte par défaut ${categorie.compte_defaut}` : undefined}>
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
          <Champ label="Objet" pleine id="a-objet"><input id="a-objet" value={f.objet} maxLength={300} onChange={set('objet')}
            placeholder={sens === 'client' ? 'Ex. Mission d\'assistance comptable — mars' : 'Ex. Fournitures de bureau du mois de mars'} /></Champ>
          {sens === 'client' && !avoir && (
            <Champ label="Conditions de paiement" pleine id="a-cond" aide="Imprimées sur le PDF">
              <input id="a-cond" value={f.conditions_paiement} maxLength={300} onChange={set('conditions_paiement')} placeholder="Ex. Virement à 30 jours, IBAN …" />
            </Champ>
          )}
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
        <Link className="cm-btn cm-secondaire" to={id ? C.action(id) : C.base}>Annuler</Link>
        <button type="button" className={`cm-btn ${proforma ? 'cm-primaire' : 'cm-secondaire'}`} disabled={enCours} onClick={() => enregistrer(false)}>Enregistrer{proforma ? '' : ' le brouillon'}</button>
        {!proforma && <button type="button" className="cm-btn cm-primaire" disabled={enCours} onClick={() => enregistrer(true)}>Enregistrer et soumettre à validation</button>}
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

// Relier un mouvement déjà saisi en caisse ou en banque.
function ReglementTiroir({ sens, facture, origine, reste, onFermer, onFait }) {
  const C = CFG[sens];
  const toast = useToast();
  const [mouvements, setMouvements] = useState(null);
  const [choix, setChoix] = useState(null);
  const [montant, setMontant] = useState('');
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  useEffect(() => {
    api.get(`${C.disponibles}?tiers_id=${facture.tiers_id}`).then((r) => { if (r?.error) setErreur(r.error); else setMouvements(r); });
  }, [facture.tiers_id, C.disponibles]);
  const choisir = (m) => { setChoix(m); setMontant(String(Math.min(Number(m.disponible), Number(reste)))); };
  const valider = async () => {
    setEnCours(true); setErreur('');
    const r = await api.post('/finance/reglements', { mouvement_id: choix.id, affectations: [{ facture_type: origine, facture_id: facture.id, montant }] });
    setEnCours(false);
    if (r?.error) { setErreur(r.error); return; }
    toast('Règlement relié.', 'success');
    if (r.anomalies?.length) toast(`Écriture de caisse à compléter : ${r.anomalies[0].motif}`, 'warning', 8000);
    onFait();
  };
  return (
    <Tiroir titre="Relier un mouvement déjà saisi" sousTitre={`${C.reste} : ${fmtCompta(reste)} — ${facture.tiers_nom}`} onFermer={onFermer} pied={<>
      <button type="button" className="cm-btn cm-secondaire" onClick={onFermer}>Annuler</button>
      <button type="button" className="cm-btn cm-primaire" disabled={!choix || enCours || !(Number(montant) > 0)} onClick={valider}>Relier</button>
    </>}>
      <p className="cm-sous">Pour un {C.mouvement === 'entrée' ? 'encaissement' : 'paiement'} déjà saisi dans le journal de caisse ou de banque. Sinon, utilisez « Enregistrer le paiement ».</p>
      <Erreur message={erreur} />
      {!mouvements ? <div className="loading-msg">Chargement…</div> : mouvements.length === 0 ? (
        <div className="fin-vide"><h3>Aucune {C.mouvement} libre</h3><p>Utilisez plutôt « Enregistrer le paiement » sur la facture.</p></div>
      ) : (
        <div className="fin-choix-liste">
          {mouvements.map((m) => (
            <label key={m.id} className={`fin-choix ${choix?.id === m.id ? 'actif' : ''}`}>
              <input type="radio" name="mouvement" checked={choix?.id === m.id} onChange={() => choisir(m)} />
              <span className="fin-choix-corps">
                <b>{fmtDate(m.date)} · {m.caisse}-{m.numero}</b> {m.intitule}{m.beneficiaire && ` — ${m.beneficiaire}`}
                <small>{m.tiers_id ? '' : 'Tiers non relié au registre · '}Montant {fmtCompta(m.montant)} · libre {fmtCompta(m.disponible)}</small>
              </span>
            </label>
          ))}
        </div>
      )}
      {choix && <Champ label="Montant réglé sur cette facture" requis id="r-montant"><input id="r-montant" inputMode="decimal" value={montant} onChange={(e) => setMontant(e.target.value)} /></Champ>}
    </Tiroir>
  );
}

// Enregistrer le paiement : NJ FINANCE crée l'entrée ou la sortie de caisse / banque
// (mêmes contrôles que la saisie en caisse) et la relie à la facture.
function PaiementTiroir({ sens, facture, origine, reste, onFermer, onFait }) {
  const C = CFG[sens];
  const toast = useToast();
  const [ref, setRef] = useState(null);
  const [v, setV] = useState({ journal_id: '', date: aujourdhui(), montant: String(Number(reste)), rubrique_code: '', reference_paiement: '' });
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  useEffect(() => {
    api.get(`${C.api}/referentiels`).then((r) => {
      if (r?.error) { setErreur(r.error); return; }
      setRef(r);
      const prefere = r.rubriques.find((x) => (sens === 'client' ? /CLIENT|ENCAISS|VENTE/i : /FOURNISS|REGLEMENT|RÈGLEMENT/i).test(x.intitule));
      setV((x) => ({ ...x, journal_id: r.journaux[0]?.id || '', rubrique_code: prefere?.code || r.rubriques[0]?.code || '' }));
    });
  }, [C.api, sens]);
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  const valider = async () => {
    setEnCours(true); setErreur('');
    const r = await api.post('/finance/reglements/paiement', { ...v, facture_type: origine, facture_id: facture.id });
    setEnCours(false);
    if (r?.error) { setErreur(r.error); return; }
    if (r.en_attente) { toast(r.message, 'warning', 10000); onFait(); return; }
    toast(`${sens === 'client' ? 'Encaissement' : 'Paiement'} enregistré en caisse (${r.caisse}-${r.numero}) et relié à la facture.`, 'success', 7000);
    if (r.budget_warning?.message) toast(r.budget_warning.message, 'warning', 7000);
    if (r.anomalies?.length) toast(`Écriture de caisse à compléter : ${r.anomalies[0].motif}`, 'warning', 8000);
    onFait();
  };
  return (
    <Tiroir titre={sens === 'client' ? 'Enregistrer l\'encaissement' : 'Enregistrer le paiement'} sousTitre={`${C.reste} : ${fmtCompta(reste)} — ${facture.tiers_nom}`} onFermer={onFermer} pied={<>
      <button type="button" className="cm-btn cm-secondaire" onClick={onFermer}>Annuler</button>
      <button type="button" className="cm-btn cm-primaire" disabled={enCours || !ref || !v.journal_id || !v.rubrique_code || !(Number(v.montant) > 0)} onClick={valider}>Enregistrer</button>
    </>}>
      <p className="cm-sous">Une {C.mouvement} est écrite directement dans la caisse ou la banque choisie, avec les contrôles habituels
        (période ouverte, solde{sens === 'client' ? '' : ', budget'}), puis reliée à cette facture.</p>
      <Erreur message={erreur} />
      {ref && (
        <div className="cm-grille">
          <Champ label="Caisse ou banque" requis id="p-j"><select id="p-j" value={v.journal_id} onChange={set('journal_id')}>
            {ref.journaux.map((j) => <option key={j.id} value={j.id}>{j.code} — {j.nom}</option>)}</select></Champ>
          <Champ label="Date" requis id="p-d"><input id="p-d" type="date" value={v.date} onChange={set('date')} /></Champ>
          <Champ label="Montant" requis id="p-m"><input id="p-m" inputMode="decimal" value={v.montant} onChange={set('montant')} /></Champ>
          <Champ label="Rubrique de caisse" requis id="p-r" aide={sens === 'client' ? 'Rubrique d\'entrée' : 'Rubrique de dépense (son budget est contrôlé)'}>
            <select id="p-r" value={v.rubrique_code} onChange={set('rubrique_code')}>
              <option value="">— choisir —</option>{ref.rubriques.map((x) => <option key={x.code} value={x.code}>{x.code} — {x.intitule}</option>)}</select></Champ>
          <Champ label="Référence (chèque, virement, mobile money…)" pleine id="p-ref"><input id="p-ref" value={v.reference_paiement} maxLength={200} onChange={set('reference_paiement')} /></Champ>
        </div>
      )}
    </Tiroir>
  );
}

// Règlement hors caisse ni banque : compte au choix et motif ; le directeur seul le valide.
function HorsCaisseTiroir({ sens, facture, origine, reste, directeur, onFermer, onFait }) {
  const C = CFG[sens];
  const toast = useToast();
  const [v, setV] = useState({ date: aujourdhui(), montant: String(Number(reste)), compte: '', tiers_id: '', motif: '' });
  const [tiers, setTiers] = useState([]);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  useEffect(() => { api.get('/finance/tiers?sens=').then((r) => { if (!r?.error) setTiers(r.tiers || []); }); }, []);
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  const envoyer = async (valider) => {
    setEnCours(true); setErreur('');
    const r = await api.post('/finance/reglements/hors-caisse', { ...v, facture_type: origine, facture_id: facture.id, valider });
    setEnCours(false);
    if (r?.error) { setErreur(r.error); return; }
    toast(r.statut === 'valide' ? 'Règlement hors caisse validé : écriture d\'OD passée.' : 'Règlement proposé : il attend la décision du directeur.', 'success', 7000);
    onFait();
  };
  const compteTiers = /^4[01]/.test(v.compte);
  return (
    <Tiroir titre="Règlement hors caisse ni banque" sousTitre={`${C.reste} : ${fmtCompta(reste)} — ${facture.tiers_nom}`} onFermer={onFermer} pied={<>
      <button type="button" className="cm-btn cm-secondaire" onClick={onFermer}>Annuler</button>
      <button type="button" className={`cm-btn ${directeur ? 'cm-secondaire' : 'cm-primaire'}`} disabled={enCours} onClick={() => envoyer(false)}>Proposer</button>
      {directeur && <button type="button" className="cm-btn cm-primaire" disabled={enCours} onClick={() => envoyer(true)}>Enregistrer et valider</button>}
    </>}>
      <p className="cm-sous">Compensation, paiement par un associé ou un tiers, abandon, petite différence… Choisissez le compte de contrepartie
        (jamais un compte de caisse ou de banque) et donnez le motif. <b>Seul le directeur valide</b> : l'écriture d'OD n'est passée qu'à ce moment.</p>
      <Erreur message={erreur} />
      <div className="cm-grille">
        <Champ label="Date" requis id="h-d"><input id="h-d" type="date" value={v.date} onChange={set('date')} /></Champ>
        <Champ label="Montant" requis id="h-m"><input id="h-m" inputMode="decimal" value={v.montant} onChange={set('montant')} /></Champ>
        <Champ label="Compte de contrepartie" requis id="h-c" aide="Ex. 462 compte courant d'associé, 658 / 758 charges ou produits divers">
          <ChampCompte id="h-c" valeur={v.compte} url="/finance/config/comptes" onChange={(c) => setV((x) => ({ ...x, compte: c }))} />
        </Champ>
        <Champ label={`Tiers concerné${compteTiers ? '' : ' (facultatif)'}`} requis={compteTiers} id="h-t">
          <select id="h-t" value={v.tiers_id} onChange={set('tiers_id')}><option value="">—</option>
            {tiers.map((t) => <option key={t.id} value={t.id}>{t.nom}</option>)}</select>
        </Champ>
        <Champ label="Motif" requis pleine id="h-motif"><textarea id="h-motif" rows={3} maxLength={500} value={v.motif} onChange={set('motif')} /></Champ>
      </div>
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

const STATUTS_HC = { propose: 'À valider', valide: 'Validée', rejete: 'Annulée', annule: 'Annulée' };

export function AchatFichePage({ sens = 'fournisseur' }) {
  const C = CFG[sens];
  const params = useParams();
  const origine = sens === 'client' ? 'fin' : params.origine;
  const { id } = params;
  const { can, user } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState('');
  const [tiroir, setTiroir] = useState(null);
  const url = sens === 'client' ? `/finance/ventes/${id}` : `/finance/achats/${origine}/${id}`;
  const charger = useCallback(async () => {
    const r = await api.get(url);
    if (r?.error) { setErreur(r.error); return; }
    setErreur(''); setD(r);
  }, [url]);
  useEffect(() => { charger(); }, [charger]);
  if (erreur && !d) return <div className="cm-page"><Link to={C.base} className="fin-lien">‹ {C.titreListe}</Link><Erreur message={erreur} /></div>;
  if (!d) return <div className="loading-msg">Chargement…</div>;
  const f = d.facture;
  const fin = origine === 'fin';
  const directeur = user?.role === 'directeur';
  const auteur = fin && f.cree_par && f.cree_par === user?.id;
  const action = async (chemin, corps = {}, message = 'Enregistré.') => {
    const r = await api.post(`${C.action(id)}/${chemin}`, corps);
    if (r?.error) { toast(r.error, 'error', 8000); return null; }
    toast(message, 'success'); setTiroir(null); charger(); return r;
  };
  const supprimer = async () => {
    if (!window.confirm('Supprimer ce brouillon ?')) return;
    const r = await api.delete(C.action(id));
    if (r?.error) { toast(r.error, 'error'); return; }
    toast('Brouillon supprimé.', 'success'); navigate(C.base);
  };
  const retirer = async (a) => {
    if (!window.confirm(`Retirer le règlement de ${fmtCompta(a.montant)} (${a.caisse}-${a.numero}) ? Le mouvement redevient libre.`)) return;
    const r = await api.delete(`/finance/reglements/${a.id}`);
    if (r?.error) { toast(r.error, 'error'); return; }
    toast('Règlement retiré.', 'success'); charger();
  };
  const decider = async (h, decision) => {
    let motif = '';
    if (decision !== 'valider') {
      motif = window.prompt(decision === 'rejeter' ? 'Motif du rejet :' : 'Motif de l\'annulation (l\'écriture sera extournée) :') || '';
      if (!motif.trim()) return;
    }
    const r = await api.post(`/finance/reglements/hors-caisse/${h.id}/decision`, { decision, motif });
    if (r?.error) { toast(r.error, 'error', 8000); return; }
    toast(decision === 'valider' ? 'Règlement validé : écriture d\'OD passée.' : 'Décision enregistrée.', 'success'); charger();
  };
  const retirerHc = async (h) => {
    if (!window.confirm('Retirer cette proposition ?')) return;
    const r = await api.delete(`/finance/reglements/hors-caisse/${h.id}`);
    if (r?.error) { toast(r.error, 'error'); return; }
    charger();
  };
  const transformer = async () => {
    const r = await action('transformer', {}, 'Facture créée à partir de la proforma : vérifiez-la puis soumettez-la.');
    if (r?.facture_id) navigate(`/finance/ventes/${r.facture_id}`);
  };
  const pdf = () => ouvrirFichier(api, `/finance/ventes/${id}/pdf`, `${f.numero || 'brouillon'}.pdf`, 'application/pdf', toast);
  const estFacture = f.type === 'facture';
  const proforma = f.type === 'proforma';
  const payable = d.reste !== null && Number(d.reste) > 0;
  const etat = !fin && f.statut === 'validee' && !f.imputation_id ? 'À imputer'
    : f.statut === 'validee' && estFacture ? (Number(d.reste) <= 0 ? 'Réglée' : Number(d.reste) < Number(f.total_ttc) ? 'Réglée en partie' : C.aPayer)
      : f.statut_libelle;
  const nature = proforma ? 'Proforma' : estFacture ? 'Facture' : 'Avoir';
  const peutSaisir = can(C.perms.saisir);
  const peutValider = can(C.perms.valider);
  return (
    <div className="cm-page fin-page">
      <Link to={C.base} className="fin-lien">‹ {C.titreListe}</Link>
      <div className="fin-fiche-tete">
        <div className="fin-avatar" aria-hidden="true">{proforma ? 'PF' : estFacture ? 'FA' : 'AV'}</div>
        <div className="fin-fiche-id">
          <h2>{nature} {f.numero || '(non numérotée)'} <BadgeEtat etat={etat} /></h2>
          <div className="fin-fiche-meta">
            <span><Link to={`/finance/tiers/${f.tiers_id}`}>{f.tiers_nom}</Link></span>
            {f.reference && <span>{sens === 'client' ? 'Réf. client' : 'Réf. fournisseur'} <b className="fin-mono">{f.reference}</b></span>}
            {sens === 'fournisseur' && <span>{fin ? 'Saisie dans NJ FINANCE' : 'NJ COMMERCIAL'}</span>}
            {f.categorie && <span>{f.categorie}</span>}
            {f.activite && <span>🎯 {f.activite}</span>}
            {f.origine_numero && <span>Sur la facture {f.origine_numero}</span>}
            {f.proforma_numero && <span>Issue de la proforma <Link to={`/finance/ventes/${f.proforma_id}`}>{f.proforma_numero}</Link></span>}
            {f.facture_issue_id && <span>Facturée : <Link to={`/finance/ventes/${f.facture_issue_id}`}>{f.facture_issue_numero}</Link></span>}
          </div>
        </div>
        <div className="cm-actions">
          {sens === 'client' && <button type="button" className="cm-btn cm-secondaire" onClick={pdf}>📄 PDF</button>}
          {fin && ['brouillon', 'a_valider'].includes(f.statut) && peutSaisir && <>
            <Link className="cm-btn cm-secondaire" to={`${C.action(id)}/modifier`}>Modifier</Link>
            <button type="button" className="cm-btn cm-secondaire" onClick={supprimer}>Supprimer</button>
            {!proforma && f.statut === 'brouillon' && <button type="button" className="cm-btn cm-secondaire" onClick={() => action('soumettre', {}, 'Soumise à validation.')}>Soumettre</button>}
            {proforma && <button type="button" className="cm-btn cm-primaire" onClick={() => action('emettre', {}, 'Proforma émise : numéro attribué, PDF prêt à envoyer.')}>Émettre</button>}
          </>}
          {fin && !proforma && ['brouillon', 'a_valider'].includes(f.statut) && peutValider && <>
            {f.statut === 'a_valider' && <button type="button" className="cm-btn cm-secondaire" onClick={() => setTiroir('renvoi')}>Renvoyer</button>}
            <button type="button" className="cm-btn cm-primaire" disabled={auteur} title={auteur ? 'Vous avez établi cette facture : une autre personne doit la valider' : undefined}
              onClick={() => action('valider', {}, `Validée : écriture ${sens === 'client' ? 'de vente' : 'd\'achat'} passée.`)}>Valider</button>
          </>}
          {proforma && f.statut === 'validee' && peutSaisir && <button type="button" className="cm-btn cm-primaire" onClick={transformer}>Transformer en facture</button>}
          {fin && f.statut === 'validee' && estFacture && peutSaisir && <Link className="cm-btn cm-secondaire" to={`${C.base}/nouvelle?avoir=${id}`}>Passer un avoir</Link>}
          {fin && f.statut === 'validee' && peutValider && <button type="button" className="cm-btn cm-danger" onClick={() => setTiroir('annulation')}>Annuler</button>}
        </div>
      </div>
      {f.motif_renvoi && f.statut === 'brouillon' && <div className="fin-bandeau">Renvoyée au brouillon : {f.motif_renvoi}</div>}
      {f.statut === 'annulee' && <div className="fin-bandeau fin-bandeau-gris">Annulée{f.annule_par_nom ? ` par ${f.annule_par_nom}` : ''}{f.motif_annulation ? ` : ${f.motif_annulation}` : ''}</div>}
      {auteur && !proforma && ['brouillon', 'a_valider'].includes(f.statut) && <div className="fin-bandeau fin-bandeau-gris">Vous avez établi ce document : une autre personne habilitée le validera.</div>}
      {payable && (
        <div className="fin-paiement">
          <span>{C.reste} : <b>{fmtCompta(d.reste)}</b>{f.date_echeance && ` · échéance ${fmtDate(f.date_echeance)}`}</span>
          <div className="cm-actions">
            {can('finance.reglements.affecter') && can('journal.create') && (
              <button type="button" className="cm-btn cm-primaire" onClick={() => setTiroir('paiement')}>{sens === 'client' ? '💰 Enregistrer l\'encaissement' : '💸 Enregistrer le paiement'}</button>
            )}
            {can('finance.reglements.affecter') && <button type="button" className="cm-btn cm-secondaire" onClick={() => setTiroir('reglement')}>Relier un mouvement déjà saisi</button>}
            {can('finance.reglements.hors_caisse') && <button type="button" className="cm-btn cm-secondaire" onClick={() => setTiroir('hors_caisse')}>Hors caisse ni banque…</button>}
          </div>
        </div>
      )}
      <div className="fin-kpis">
        <Kpi libelle="Total HT" valeur={fmtCompta(f.total_ht, { zero: '0' })} />
        <Kpi libelle="Taxes" valeur={fmtCompta(f.total_taxes, { zero: '0' })} />
        <Kpi libelle="Total TTC" valeur={fmtCompta(f.total_ttc, { zero: '0' })} />
        {estFacture && <Kpi libelle={C.reste} valeur={d.reste === null ? '—' : fmtCompta(d.reste, { zero: '0' })}
          ton={d.reste === null ? '' : Number(d.reste) > 0 ? 'alerte' : 'ok'} aide={`Échéance ${fmtDate(f.date_echeance)}`} />}
        {proforma && <Kpi libelle="Valable jusqu'au" valeur={fmtDate(f.date_echeance)} />}
      </div>
      {!fin && <ImputationCarte d={d} onFait={charger} />}
      <section className="fin-carte">
        <div className="fin-carte-tete"><div><h3>Détail</h3><p>Date {fmtDate(f.date_facture)}{f.objet ? ` · ${f.objet}` : ''}{f.conditions_paiement ? ` · ${f.conditions_paiement}` : ''}</p></div></div>
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
      {estFacture && !['brouillon', 'a_valider'].includes(f.statut) && (
        <section className="fin-carte">
          <div className="fin-carte-tete"><div><h3>Règlements</h3><p>Mouvements de caisse ou de banque reliés à cette facture, et règlements hors caisse.</p></div></div>
          {d.reglements.length === 0 && d.hors_caisse.length === 0 ? <p className="cm-sous">Aucun règlement.</p> : (
            <div className="cm-table-wrap">
              <table className="cm-table fin-table">
                <thead><tr><th>Date</th><th>Mode</th><th>Libellé</th><th className="fin-num">Montant</th><th>Par</th><th>État</th><th aria-label="Actions" /></tr></thead>
                <tbody>
                  {d.reglements.map((a) => (
                    <tr key={`m${a.id}`} className={a.annule ? 'fin-ligne-annulee' : ''}>
                      <td>{fmtDate(a.date)}</td><td className="fin-mono">{a.caisse}-{a.numero}</td>
                      <td>{a.intitule}{a.annule && <div className="cm-sous">Mouvement annulé en caisse : ce règlement ne compte plus</div>}</td>
                      <td className="fin-num">{fmtCompta(a.montant)}</td><td>{a.par || '—'}</td><td>{a.annule ? '—' : <BadgeEtat etat="Validée" />}</td>
                      <td>{!a.annule && can('finance.reglements.affecter') && <button type="button" className="cm-btn-lien" onClick={() => retirer(a)}>Retirer</button>}</td>
                    </tr>
                  ))}
                  {d.hors_caisse.map((h) => (
                    <tr key={`h${h.id}`} className={['rejete', 'annule'].includes(h.statut) ? 'fin-ligne-annulee' : ''}>
                      <td>{fmtDate(h.date)}</td><td>Hors caisse · <span className="fin-mono">{h.compte}</span></td>
                      <td>{h.motif}{h.tiers_nom && <div className="cm-sous">{h.tiers_nom}</div>}{h.motif_decision && <div className="cm-sous">Décision : {h.motif_decision}</div>}</td>
                      <td className="fin-num">{fmtCompta(h.montant)}</td>
                      <td>{h.propose_par_nom || '—'}{h.decide_par_nom && <div className="cm-sous">décidé par {h.decide_par_nom}</div>}</td>
                      <td><BadgeEtat etat={STATUTS_HC[h.statut]} /></td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {h.statut === 'propose' && directeur && <>
                          <button type="button" className="cm-btn-lien" onClick={() => decider(h, 'valider')}>Valider</button>{' · '}
                          <button type="button" className="cm-btn-lien" onClick={() => decider(h, 'rejeter')}>Rejeter</button>
                        </>}
                        {h.statut === 'propose' && !directeur && <span className="cm-sous">attend le directeur</span>}
                        {h.statut === 'propose' && (h.propose_par_nom === user?.username || directeur) && <>{' · '}<button type="button" className="cm-btn-lien" onClick={() => retirerHc(h)}>Retirer</button></>}
                        {h.statut === 'valide' && directeur && <button type="button" className="cm-btn-lien" onClick={() => decider(h, 'annuler')}>Annuler</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {d.avoirs.length > 0 && <>
            <h4 className="fin-sous-titre">Avoirs</h4>
            <ul className="fin-liste-simple">
              {d.avoirs.map((a) => <li key={a.id}><Link to={sens === 'client' ? `/finance/ventes/${a.id}` : `/finance/achats/${origine}/${a.id}`}>{a.numero || 'Brouillon'}</Link>
                {a.reference ? ` · réf. ${a.reference}` : ''} · {fmtDate(a.date_facture)} · {fmtCompta(a.total_ttc)} · {a.statut}</li>)}
            </ul>
          </>}
        </section>
      )}
      {d.ecritures.length > 0 && (
        <section className="fin-carte">
          <div className="fin-carte-tete"><div><h3>Écritures</h3><p>Journal {sens === 'client' ? 'des ventes' : 'des achats'} ; un document annulé est extourné, jamais supprimé.</p></div></div>
          <ul className="fin-liste-simple">
            {d.ecritures.map((e) => <li key={e.id}><span className="fin-mono">{numeroEcriture(e)}</span> du {fmtDate(e.date)}{e.extournee ? ' — extournée' : ''}</li>)}
          </ul>
        </section>
      )}
      <p className="cm-sous">
        {fin && f.cree_par_nom && `Établi par ${f.cree_par_nom}`}{fin && f.soumis_par_nom && ` · ${proforma ? 'émis' : 'soumis'} par ${f.soumis_par_nom}`}
        {f.valide_par_nom && ` · validé par ${f.valide_par_nom}${f.valide_le ? ` le ${fmtDate(String(f.valide_le).slice(0, 10))}` : ''}`}
      </p>
      {tiroir === 'paiement' && <PaiementTiroir sens={sens} facture={f} origine={origine} reste={d.reste} onFermer={() => setTiroir(null)} onFait={() => { setTiroir(null); charger(); }} />}
      {tiroir === 'reglement' && <ReglementTiroir sens={sens} facture={f} origine={origine} reste={d.reste} onFermer={() => setTiroir(null)} onFait={() => { setTiroir(null); charger(); }} />}
      {tiroir === 'hors_caisse' && <HorsCaisseTiroir sens={sens} facture={f} origine={origine} reste={d.reste} directeur={directeur} onFermer={() => setTiroir(null)} onFait={() => { setTiroir(null); charger(); }} />}
      {tiroir === 'annulation' && <MotifTiroir titre={`Annuler ${f.numero}`} bouton="Annuler le document"
        aide={proforma ? 'La proforma ne pourra plus être transformée en facture.' : 'L\'écriture est extournée. Un document déjà réglé ou portant un avoir ne s\'annule pas : retirez d\'abord ses règlements ou annulez l\'avoir.'}
        onFermer={() => setTiroir(null)} onValider={(motif) => action('annuler', { motif }, 'Document annulé.')} />}
      {tiroir === 'renvoi' && <MotifTiroir titre="Renvoyer au brouillon" bouton="Renvoyer" aide="La personne qui l'a établie verra votre motif et pourra corriger le document."
        onFermer={() => setTiroir(null)} onValider={(motif) => action('renvoyer', { motif }, 'Renvoyé au brouillon.')} />}
    </div>
  );
}

// ── Échéancier ──────────────────────────────────────────────────────────────
export function EcheancierPage({ sens = 'fournisseur' }) {
  const C = CFG[sens];
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState('');
  useEffect(() => {
    api.get(`${C.api}/echeancier`).then((r) => (r?.error ? setErreur(r.error)
      : setD({ ...r, groupes: r.groupes.map((g) => ({ ...g, factures: g.factures.map((f) => ({ ...f, sens })) })) })));
  }, [C.api, sens]);
  if (erreur) return <div className="cm-page"><Erreur message={erreur} /></div>;
  if (!d) return <div className="loading-msg">Chargement…</div>;
  const exporter = () => exporterExcel(sens === 'client' ? 'Echeancier_clients' : 'Echeancier_fournisseurs', ['Tranche', C.tiers, 'N°', 'Référence', 'Échéance', 'Reste à payer'],
    d.groupes.flatMap((g) => g.factures.map((f) => [g.libelle, f.tiers_nom, f.numero, f.reference, f.date_echeance || '', +f.reste])));
  const tons = { echu_60: 'danger', echu_30: 'danger', echu: 'alerte' };
  return (
    <div className="cm-page fin-page">
      <div className="cm-entete">
        <div><h2>{C.titreEcheancier}</h2><p>Factures restant à {sens === 'client' ? 'encaisser' : 'payer'} au {fmtDate(d.au)}, par échéance. Total : <b>{fmtCompta(d.total, { zero: '0' })}</b>.</p></div>
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
              <thead><tr><th>{C.tiers}</th><th>N°</th><th>Référence</th><th>Échéance</th><th className="fin-num">TTC</th><th className="fin-num">{C.reste}</th></tr></thead>
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
      {!d.groupes.some((g) => g.nombre) && <div className="fin-vide"><div className="fin-vide-icone" aria-hidden="true">✅</div><h3>Rien en attente</h3><p>Toutes les factures {sens === 'client' ? 'clients' : 'fournisseurs'} sont réglées.</p></div>}
    </div>
  );
}
