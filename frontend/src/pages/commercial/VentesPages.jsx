// NJ COMMERCIAL — lot 6 : ventes. Devis → commande client → préparation et livraison.
//   Le devis est validé par le responsable commercial, puis par la direction au-delà du
//   seuil des ventes ou d'une remise hors plafond ; jamais par son auteur. La livraison
//   est préparée au magasin puis validée par une autre personne : le stock sort alors.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { Entete, Section, Champ, Tiroir, useListe, useDiffere, fmtMontant, fmtQte } from '@/components/commercial/ui';
import { dateFr, ouvrirFichier, lireFichier } from '@/components/commercial/achats';
import { lireNombre } from '@/components/commercial/stock';
import { useFiche, PiecesDoc, MouvementsDoc, HistoriqueDoc } from '@/components/commercial/fiche';

export const DROITS_VENTES = ['com.ventes.voir', 'com.ventes.devis', 'com.ventes.valider', 'com.ventes.valider_direction', 'com.ventes.commandes',
  'com.ventes.preparer', 'com.ventes.livrer', 'com.ventes.annuler'];
export const DROITS_VALIDATION_VENTES = ['com.ventes.valider', 'com.ventes.valider_direction', 'com.ventes.livrer'];

const PASTILLES = {
  brouillon: ['Brouillon', 'cm-off'], a_valider: ['À valider', 'cm-alerte'], a_valider_direction: ['À valider (direction)', 'cm-violet'],
  valide: ['Validé', 'cm-ok'], accepte: ['Accepté', 'cm-ok'], refuse: ['Refusé', 'cm-rouge'], annule: ['Annulé', 'cm-rouge'], expire: ['Expiré', 'cm-rouge'],
  ouverte: ['Ouverte', 'cm-info'], annulee: ['Annulée', 'cm-rouge'],
  a_livrer: ['À livrer', 'cm-alerte'], partielle: ['Livrée en partie', 'cm-info'], livree: ['Livrée', 'cm-ok'],
  l_brouillon: ['En préparation', 'cm-off'], preparee: ['Préparée', 'cm-alerte'],
};
export function StatutVente({ statut, expire, livraison }) {
  const cle = expire ? 'expire' : livraison && statut === 'brouillon' ? 'l_brouillon' : statut;
  const [l, c] = PASTILLES[cle] || [statut, 'cm-off'];
  return <span className={`cm-pastille ${c}`}>{l}</span>;
}

const aujourdhui = () => new Date().toISOString().slice(0, 10);
const virgule = (n) => (n === null || n === undefined ? '' : String(n).replace('.', ','));
const arrondi = (n, dec = 0) => { const f = 10 ** dec; return Math.round(n * f) / f; };
const lien = (to, txt) => <Link to={to} onClick={(e) => e.stopPropagation()}>{txt}</Link>;

function Outils({ q, setQ, statut, setStatut, statuts, du, setDu, au, setAu, nb, placeholder }) {
  return (
    <div className="cm-outils">
      <input className="cm-recherche" type="search" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher" />
      <select className="cm-select" value={statut} onChange={(e) => setStatut(e.target.value)} aria-label="Statut">
        {statuts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <input className="cm-select" type="date" value={du} onChange={(e) => setDu(e.target.value)} aria-label="Du" title="Du" />
      <input className="cm-select" type="date" value={au} onChange={(e) => setAu(e.target.value)} aria-label="Au" title="Au" />
      <span className="cm-compteur">{nb}</span>
    </div>
  );
}

function TableListe({ colonnes, donnees, vide, ligne, lienDe, largeur = 760 }) {
  const navigate = useNavigate();
  const liste = donnees || [];
  return (
    <div className="cm-table-wrap">
      <table className="cm-table" style={{ minWidth: largeur }}>
        <thead><tr>{colonnes.map((c) => <th key={c} className={/TTC|Livré|Montant/.test(c) ? 'cm-num' : ''}>{c}</th>)}</tr></thead>
        <tbody>
          {!donnees ? <tr><td colSpan={colonnes.length} className="cm-vide">Chargement…</td></tr>
            : liste.length === 0 ? <tr><td colSpan={colonnes.length} className="cm-vide"><strong>Aucun document</strong>{vide}</td></tr>
              : liste.map((d) => (
                <tr key={d.id} className="cm-cliquable" tabIndex={0} onClick={() => navigate(lienDe(d))} onKeyDown={(e) => { if (e.key === 'Enter') navigate(lienDe(d)); }}>
                  {ligne(d)}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}

// ══ DEVIS ═══════════════════════════════════════════════════════════════
export function DevisListePage() {
  const { can } = useApp();
  const navigate = useNavigate();
  const [statut, setStatut] = useState('');
  const [q, setQ] = useState(''); const [du, setDu] = useState(''); const [au, setAu] = useState('');
  const qd = useDiffere(q);
  const { donnees, erreur } = useListe(`/commercial/devis?statut=${statut}&q=${encodeURIComponent(qd)}&du=${du}&au=${au}`);
  return (
    <div className="cm-page">
      <Entete titre="Devis"
        description="Proposition chiffrée remise au client. Elle est validée par le responsable commercial, puis par la direction au-delà du seuil des ventes ou d'une remise hors plafond ; le client l'accepte avant sa date de validité.">
        {can('com.ventes.devis') && <button type="button" className="cm-btn cm-primaire" onClick={() => navigate('/commercial/devis/nouveau')}>+ Nouveau devis</button>}
      </Entete>
      <Outils q={q} setQ={setQ} statut={statut} setStatut={setStatut} du={du} setDu={setDu} au={au} setAu={setAu} placeholder="Numéro, client, objet…"
        nb={donnees ? `${donnees.length} devis` : ''}
        statuts={[['', 'Tous les statuts'], ['brouillon', 'Brouillon'], ['en_validation', 'En validation'], ['valide', 'Validé'], ['expire', 'Expiré'],
          ['accepte', 'Accepté'], ['refuse', 'Refusé'], ['annule', 'Annulé']]} />
      {erreur && <div className="cm-erreur">{erreur}</div>}
      <TableListe donnees={donnees} lienDe={(d) => `/commercial/devis/${d.id}`} vide="Créez un devis avec « + Nouveau devis »."
        colonnes={['Devis', 'Date', 'Client', 'Valable jusqu\'au', 'Total TTC', 'Statut']}
        ligne={(d) => (
          <>
            <td><span className="cm-code">{d.numero}</span>{d.objet && <span className="cm-sous">{d.objet}</span>}</td>
            <td>{dateFr(d.date_devis)}</td>
            <td><strong>{d.client_nom}</strong></td>
            <td>{dateFr(d.date_validite)}</td>
            <td className="cm-num">{fmtMontant(d.total_ttc, d.devise)}</td>
            <td><StatutVente statut={d.statut} expire={d.expire} />{d.commande_numero && <span className="cm-sous">{d.commande_numero}</span>}</td>
          </>
        )} />
    </div>
  );
}

export function DevisFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [ref, setRef] = useState(null);           // { clients, articles, taxes }
  const [f, setF] = useState(null);
  const [lignes, setLignes] = useState([]);
  const [numero, setNumero] = useState('');
  const [regles, setRegles] = useState(null);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    (async () => {
      const [clients, articles, taxes] = await Promise.all([api.get('/commercial/tiers?type=client&actifs=1'), api.get('/commercial/articles?actifs=1'), api.get('/commercial/taxes')]);
      if (clients?.error || articles?.error) { setErreur(clients?.error || articles?.error); return; }
      const tx = (Array.isArray(taxes) ? taxes : []).filter((t) => t.actif && t.usage !== 'achat');
      setRef({ clients, articles, taxes: tx });
      if (id) {
        const d = await api.get(`/commercial/devis/${id}`);
        if (d?.error) { setErreur(d.error); return; }
        if (!d.droits.modifier) { navigate(`/commercial/devis/${id}`, { replace: true }); return; }
        setNumero(d.numero); setRegles(d.regles);
        setF({ client_id: String(d.client_id), date_devis: d.date_devis, date_validite: d.date_validite, objet: d.objet, conditions_paiement: d.conditions_paiement,
          delai_livraison: d.delai_livraison, observations: d.observations });
        setLignes(d.lignes.map((l) => ({ article_id: l.article_id, unite_id: String(l.unite_id || ''), quantite: virgule(l.quantite), prix_unitaire: virgule(l.prix_unitaire),
          remise_pct: l.remise_pct ? virgule(l.remise_pct) : '', taxe_id: l.taxe_id ? String(l.taxe_id) : '' })));
      } else {
        setF({ client_id: '', date_devis: aujourdhui(), date_validite: '', objet: '', conditions_paiement: '', delai_livraison: '', observations: '' });
      }
    })();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const articles = useMemo(() => new Map((ref?.articles || []).map((a) => [a.id, a])), [ref]);
  const taux = (tid) => Number(ref?.taxes.find((t) => String(t.id) === String(tid))?.taux || 0);
  const prixDefaut = (a, uid) => {
    if (a.prix_vente_indicatif === null) return '';
    const u = a.unites.find((x) => String(x.id) === String(uid)) || { coefficient: 1 };
    return virgule(arrondi(a.prix_vente_indicatif / (a.coef_vente || 1) * u.coefficient));
  };
  const ajouter = (e) => {
    const a = articles.get(Number(e.target.value));
    e.target.value = '';
    if (!a) return;
    setLignes((ls) => [...ls, { article_id: a.id, unite_id: String(a.unite_vente_id), quantite: '1', prix_unitaire: prixDefaut(a, a.unite_vente_id), remise_pct: '',
      taxe_id: a.taxe_vente_id ? String(a.taxe_vente_id) : '' }]);
  };
  const maj = (i, k, v) => setLignes((ls) => ls.map((l, j) => {
    if (j !== i) return l;
    const n = { ...l, [k]: v };
    if (k === 'unite_id') n.prix_unitaire = prixDefaut(articles.get(l.article_id), v);
    return n;
  }));
  const calc = lignes.map((l) => {
    const q = lireNombre(l.quantite) || 0; const pu = lireNombre(l.prix_unitaire) || 0; const r = lireNombre(l.remise_pct) || 0;
    const ht = arrondi(q * pu * (1 - r / 100));
    return { ht, tx: arrondi(ht * taux(l.taxe_id) / 100), r };
  });
  const totHt = calc.reduce((t, c) => t + c.ht, 0); const totTx = calc.reduce((t, c) => t + c.tx, 0);
  const client = ref?.clients.find((c) => String(c.id) === String(f?.client_id));
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const choisirClient = (e) => {
    const c = ref.clients.find((x) => String(x.id) === e.target.value);
    setF((x) => ({ ...x, client_id: e.target.value, conditions_paiement: x.conditions_paiement || c?.conditions_paiement || '' }));
  };
  const corps = () => ({ ...f, lignes: lignes.map((l) => ({ ...l, taxe_id: l.taxe_id || '' })) });
  const enregistrer = async (soumettre) => {
    setEnCours(true); setErreur('');
    const r = id ? await api.put(`/commercial/devis/${id}`, corps()) : await api.post('/commercial/devis', corps());
    if (r?.error) { setEnCours(false); setErreur(r.error); return; }
    if (soumettre) {
      const s = await api.post(`/commercial/devis/${r.id}/soumission`, {});
      setEnCours(false);
      if (s?.error) { setErreur(s.error); if (!id) navigate(`/commercial/devis/${r.id}/modifier`, { replace: true }); return; }
      toast(`${s.numero} soumis : il attend la validation ${s.niveau === 'direction' ? 'du responsable puis de la direction' : 'du responsable commercial'}.`, 'success');
    } else { setEnCours(false); toast(`Brouillon ${r.numero} enregistré.`, 'success'); }
    navigate(`/commercial/devis/${r.id}`);
  };

  if (!ref || !f) return <div className="cm-page">{erreur ? <div className="cm-erreur">{erreur}</div> : <div className="loading-msg">Chargement…</div>}</div>;
  return (
    <div className="cm-page">
      <Link to={id ? `/commercial/devis/${id}` : '/commercial/devis'} className="cm-retour">‹ {id ? numero : 'Devis'}</Link>
      <div className="cm-fiche-tete">
        <div><h2>{id ? `Modifier ${numero}` : 'Nouveau devis'}</h2></div>
        <div className="cm-actions">
          <button type="button" className="cm-btn cm-secondaire" onClick={() => enregistrer(false)} disabled={enCours}>Enregistrer le brouillon</button>
          <button type="button" className="cm-btn cm-primaire" onClick={() => enregistrer(true)} disabled={enCours}>{enCours ? 'Envoi…' : 'Soumettre pour validation'}</button>
        </div>
      </div>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      <Section titre="Client et conditions">
        <div className="cm-grille">
          <Champ label="Client" requis id="dvc">
            <select id="dvc" value={f.client_id} onChange={choisirClient}>
              <option value="">— Choisir un client —</option>
              {ref.clients.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
          </Champ>
          <Champ label="Objet" id="dvo"><input id="dvo" value={f.objet} onChange={set('objet')} maxLength={300} placeholder="Ex. Approvisionnement du bar" /></Champ>
          <Champ label="Date du devis" requis id="dvd"><input id="dvd" type="date" max={aujourdhui()} value={f.date_devis} onChange={set('date_devis')} /></Champ>
          <Champ label="Valable jusqu'au" id="dvv" aide={regles ? `Par défaut : ${regles.validite_jours} jours.` : 'Par défaut : 30 jours après la date du devis.'}>
            <input id="dvv" type="date" value={f.date_validite} min={f.date_devis} onChange={set('date_validite')} />
          </Champ>
          <Champ label="Conditions de paiement" id="dvp"><input id="dvp" value={f.conditions_paiement} onChange={set('conditions_paiement')} maxLength={300} placeholder="Ex. 50 % à la commande, solde à la livraison" /></Champ>
          <Champ label="Délai de livraison" id="dvl"><input id="dvl" value={f.delai_livraison} onChange={set('delai_livraison')} maxLength={200} placeholder="Ex. 5 jours ouvrés" /></Champ>
          <Champ label="Observations (imprimées sur le devis)" id="dvob" pleine><textarea id="dvob" value={f.observations} onChange={set('observations')} maxLength={2000} /></Champ>
        </div>
        {client && !client.actif && <p className="cm-erreur">Ce client est désactivé.</p>}
      </Section>
      <Section titre={`Articles (${lignes.length})`}>
        {lignes.length > 0 && (
          <table className="cm-lignes">
            <thead><tr><th>Article</th><th>Unité</th><th style={{ textAlign: 'right' }}>Quantité</th><th style={{ textAlign: 'right' }}>Prix unitaire HT</th><th style={{ textAlign: 'right' }}>Remise %</th><th>Taxe</th><th style={{ textAlign: 'right' }}>Montant HT</th><th /></tr></thead>
            <tbody>
              {lignes.map((l, i) => {
                const a = articles.get(l.article_id) || { designation: '?', reference: '', unites: [] };
                return (
                  <tr key={i}>
                    <td className="cm-l-article"><strong>{a.designation}</strong><span className="cm-sous">{a.reference}{!a.suivi_stock ? ' · prestation' : ''}</span></td>
                    <td><select value={l.unite_id} onChange={(e) => maj(i, 'unite_id', e.target.value)} aria-label={`Unité de ${a.designation}`}>
                      {a.unites.map((u) => <option key={u.id} value={u.id}>{u.code}{u.coefficient !== 1 ? ` (${fmtQte(u.coefficient)} ${a.unite_stock_code})` : ''}</option>)}
                    </select></td>
                    <td style={{ textAlign: 'right' }}><input className="cm-qte-input" inputMode="decimal" value={l.quantite} onChange={(e) => maj(i, 'quantite', e.target.value)} aria-label={`Quantité de ${a.designation}`} /></td>
                    <td style={{ textAlign: 'right' }}><input className="cm-qte-input" style={{ width: 110 }} inputMode="decimal" value={l.prix_unitaire} onChange={(e) => maj(i, 'prix_unitaire', e.target.value)} aria-label={`Prix de ${a.designation}`} /></td>
                    <td style={{ textAlign: 'right' }}><input className="cm-qte-input" style={{ width: 64, ...(regles && calc[i].r > regles.remise_max_pct ? { borderColor: '#7c3aed' } : {}) }} inputMode="decimal" value={l.remise_pct} onChange={(e) => maj(i, 'remise_pct', e.target.value)} aria-label={`Remise de ${a.designation}`} placeholder="0" /></td>
                    <td><select value={l.taxe_id} onChange={(e) => maj(i, 'taxe_id', e.target.value)} aria-label={`Taxe de ${a.designation}`}>
                      <option value="">Aucune</option>
                      {ref.taxes.map((t) => <option key={t.id} value={t.id}>{t.code} {fmtQte(t.taux)} %</option>)}
                    </select></td>
                    <td className="cm-num"><span className="cm-l-lib">Montant HT</span>{fmtMontant(calc[i].ht, '')}</td>
                    <td><button type="button" className="cm-x" onClick={() => setLignes((ls) => ls.filter((_, j) => j !== i))} aria-label={`Retirer ${a.designation}`}>✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="cm-grille" style={{ marginTop: 10 }}>
          <Champ label="Ajouter un article" id="dva">
            <select id="dva" onChange={ajouter} defaultValue="" aria-label="Ajouter un article">
              <option value="">— Choisir —</option>
              {ref.articles.map((a) => <option key={a.id} value={a.id}>{a.reference} — {a.designation}</option>)}
            </select>
          </Champ>
        </div>
        {lignes.length > 0 && (
          <div className="cm-totaux">
            <div><span>Total HT</span><strong>{fmtMontant(totHt)}</strong></div>
            <div><span>Taxes</span><strong>{fmtMontant(totTx)}</strong></div>
            <div className="cm-ttc"><span>Total TTC</span><strong>{fmtMontant(totHt + totTx)}</strong></div>
          </div>
        )}
        <p className="cm-aide" style={{ marginTop: 8 }}>Le prix proposé est le prix de vente indicatif de l'article, converti dans l'unité choisie ; il reste modifiable. Les montants définitifs sont calculés par le serveur.</p>
      </Section>
    </div>
  );
}

function AccepterDevis({ d, onFermer, onFait }) {
  const toast = useToast();
  const [f, setF] = useState({ reference_client: '', date_commande: aujourdhui(), date_livraison_souhaitee: '', adresse_livraison: d.client?.adresse || '', observations: '' });
  const [piece, setPiece] = useState(null);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const valider = async () => {
    setEnCours(true); setErreur('');
    const corps = { ...f };
    if (piece) {
      if (piece.size > 5 * 1024 * 1024) { setEnCours(false); setErreur('Pièce trop volumineuse (5 Mo au plus).'); return; }
      corps.piece = { nom_fichier: piece.name, data_base64: await lireFichier(piece) };
    }
    const r = await api.post(`/commercial/devis/${d.id}/acceptation`, corps);
    setEnCours(false);
    if (r?.error) { setErreur(r.error); return; }
    toast(`Commande ${r.numero} enregistrée.`, 'success');
    onFait(r);
  };
  return (
    <Tiroir titre={`Acceptation de ${d.numero}`} sousTitre={`${d.client_nom} · ${fmtMontant(d.total_ttc, d.devise)}`} onFermer={onFermer}
      pied={<><button type="button" className="cm-btn cm-secondaire" onClick={onFermer}>Annuler</button>
        <button type="button" className="cm-btn cm-primaire" onClick={valider} disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer la commande'}</button></>}>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      <p className="cm-aide" style={{ marginBottom: 10 }}>La commande reprend exactement les lignes et les prix du devis validé.</p>
      <div className="cm-grille">
        <Champ label="Référence du bon de commande du client" id="acr"><input id="acr" value={f.reference_client} onChange={set('reference_client')} maxLength={60} placeholder="Ex. BC-2026-118" /></Champ>
        <Champ label="Date de la commande" requis id="acd"><input id="acd" type="date" max={aujourdhui()} min={d.date_devis} value={f.date_commande} onChange={set('date_commande')} /></Champ>
        <Champ label="Livraison souhaitée le" id="acl"><input id="acl" type="date" min={f.date_commande} value={f.date_livraison_souhaitee} onChange={set('date_livraison_souhaitee')} /></Champ>
        <Champ label="Adresse de livraison" id="aca" pleine><input id="aca" value={f.adresse_livraison} onChange={set('adresse_livraison')} maxLength={300} /></Champ>
        <Champ label="Bon de commande du client (pièce)" id="acp" pleine aide="PDF ou image, 5 Mo au plus.">
          <input id="acp" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(e) => setPiece(e.target.files?.[0] || null)} />
        </Champ>
        <Champ label="Observations" id="aco" pleine><textarea id="aco" value={f.observations} onChange={set('observations')} maxLength={2000} /></Champ>
      </div>
    </Tiroir>
  );
}

function Totaux({ d }) {
  if (d.total_ttc === null) return null;
  const remise = d.total_brut !== undefined && d.total_brut !== null ? d.total_brut - d.total_ht : 0;
  return (
    <div className="cm-totaux">
      {remise > 0.004 && <div><span>Remises accordées</span><strong>− {fmtMontant(remise, d.devise)}</strong></div>}
      <div><span>Total HT</span><strong>{fmtMontant(d.total_ht, d.devise)}</strong></div>
      <div><span>Taxes</span><strong>{fmtMontant(d.total_taxes, d.devise)}</strong></div>
      <div className="cm-ttc"><span>Total TTC</span><strong>{fmtMontant(d.total_ttc, d.devise)}</strong></div>
    </div>
  );
}

function LignesPrix({ lignes, devise, extra }) {
  const prix = lignes.some((l) => l.prix_unitaire !== null);
  return (
    <table className="cm-lignes cm-bc-lecture">
      <thead><tr><th>Article</th><th style={{ textAlign: 'right' }}>Quantité</th>{prix && <><th style={{ textAlign: 'right' }}>P.U. HT</th><th style={{ textAlign: 'right' }}>Remise</th><th style={{ textAlign: 'right' }}>Taxe</th><th style={{ textAlign: 'right' }}>Montant HT</th></>}{extra && extra.titres}</tr></thead>
      <tbody>
        {lignes.map((l) => (
          <tr key={l.id}>
            <td className="cm-l-article"><strong>{l.designation}</strong><span className="cm-sous">{l.reference}</span></td>
            <td className="cm-num"><span className="cm-l-lib">Quantité</span>{fmtQte(l.quantite)} {l.unite}</td>
            {prix && <>
              <td className="cm-num"><span className="cm-l-lib">P.U. HT</span>{fmtMontant(l.prix_unitaire, '')}</td>
              <td className="cm-num"><span className="cm-l-lib">Remise</span>{l.remise_pct ? `${fmtQte(l.remise_pct)} %` : '—'}</td>
              <td className="cm-num"><span className="cm-l-lib">Taxe</span>{l.taxe_code ? `${l.taxe_code} ${fmtQte(l.taxe_taux)} %` : '—'}</td>
              <td className="cm-num"><span className="cm-l-lib">Montant HT</span>{fmtMontant(l.montant_ht, devise)}</td>
            </>}
            {extra && extra.cellules(l)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DevisPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { d, setD, erreur, enCours, agir } = useFiche(`/commercial/devis/${id}`);
  const [accepter, setAccepter] = useState(false);
  if (!d) return <div className="cm-page"><Link to="/commercial/devis" className="cm-retour">‹ Devis</Link>{erreur ? <div className="cm-erreur">{erreur}</div> : <div className="loading-msg">Chargement…</div>}</div>;
  const base = `/commercial/devis/${d.id}`;
  const occupe = Boolean(enCours);
  const motif = (question) => (window.prompt(question) || '').trim();
  const actions = {
    supprimer: async () => { if (window.confirm('Supprimer ce brouillon ?') && await agir('s', () => api.delete(base), 'Brouillon supprimé.')) navigate('/commercial/devis'); },
    soumettre: () => agir('soumettre', () => api.post(`${base}/soumission`, {}), 'Devis soumis pour validation.'),
    valider: () => {
      const suite = d.statut === 'a_valider' && d.niveau === 'direction' ? '\n\nCe devis exige aussi la validation de la direction.' : '';
      if (window.confirm(`Valider ${d.numero} ?${suite}`)) agir('valider', () => api.post(`${base}/validation`, {}), 'Devis validé.');
    },
    renvoyer: () => { const m = motif(`Renvoyer ${d.numero} à son auteur.\n\nQue faut-il corriger ?`); if (m) agir('renvoyer', () => api.post(`${base}/renvoi`, { motif: m }), 'Devis renvoyé pour correction.'); },
    annuler: () => { const m = motif(`Annuler ${d.numero} ?\nIl reste consultable, marqué « annulé ».\n\nMotif :`); if (m) agir('annuler', () => api.post(`${base}/annulation`, { motif: m }), 'Devis annulé.'); },
    refuser: () => { const m = motif(`Le client refuse ${d.numero}.\n\nRaison du refus :`); if (m) agir('refuser', () => api.post(`${base}/refus`, { motif: m }), 'Refus du client enregistré.'); },
    dupliquer: async () => { const r = await agir('dupliquer', () => api.post(`${base}/duplication`, {}), 'Nouveau brouillon créé.'); if (r) navigate(`/commercial/devis/${r.id}/modifier`); },
    pdf: () => ouvrirFichier(api, `${base}/pdf`, `${d.numero}.pdf`, 'application/pdf', toast),
  };
  const dr = d.droits;
  return (
    <div className="cm-page">
      <Link to="/commercial/devis" className="cm-retour">‹ Devis</Link>
      <div className="cm-fiche-tete">
        <div>
          <h2><span className="cm-code" style={{ fontSize: 15 }}>{d.numero}</span>Devis <StatutVente statut={d.statut} expire={d.expire} /></h2>
          <span className="cm-sous">Saisi par {d.cree_par_nom} le {dateFr(d.cree_le, true)}
            {d.valide_resp_le ? ` · validé par ${d.valide_resp_nom}` : ''}{d.valide_dir_le ? ` · direction : ${d.valide_dir_nom}` : ''}</span>
        </div>
        <div className="cm-actions">
          {dr.modifier && <button type="button" className="cm-btn cm-danger" onClick={actions.supprimer} disabled={occupe}>Supprimer</button>}
          {dr.annuler && <button type="button" className="cm-btn cm-danger" onClick={actions.annuler} disabled={occupe}>Annuler</button>}
          {d.total_ttc !== null && <button type="button" className="cm-btn cm-secondaire" onClick={actions.pdf}>{['valide', 'accepte'].includes(d.statut) ? 'PDF bon pour accord' : 'Aperçu PDF'}</button>}
          {dr.dupliquer && <button type="button" className="cm-btn cm-secondaire" onClick={actions.dupliquer} disabled={occupe}>Dupliquer</button>}
          {dr.modifier && <button type="button" className="cm-btn cm-secondaire" onClick={() => navigate(`${base}/modifier`)}>Modifier</button>}
          {dr.soumettre && <button type="button" className="cm-btn cm-primaire" onClick={actions.soumettre} disabled={occupe}>Soumettre pour validation</button>}
          {dr.renvoyer && <button type="button" className="cm-btn cm-secondaire" onClick={actions.renvoyer} disabled={occupe}>Renvoyer pour correction</button>}
          {dr.valider && <button type="button" className="cm-btn cm-primaire" onClick={actions.valider} disabled={occupe}>{enCours === 'valider' ? 'Validation…' : 'Valider'}</button>}
          {dr.refuser && <button type="button" className="cm-btn cm-secondaire" onClick={actions.refuser} disabled={occupe}>Refus du client</button>}
          {dr.accepter && <button type="button" className="cm-btn cm-primaire" onClick={() => setAccepter(true)} disabled={occupe}>Accepté par le client</button>}
        </div>
      </div>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      {dr.auto_validation_interdite && <div className="cm-note">Vous avez saisi ce devis : un autre valideur doit le valider (séparation des tâches).</div>}
      {d.statut === 'brouillon' && d.motif_renvoi && <div className="cm-note" style={{ background: '#eff6ff' }}><strong>À corriger :</strong> {d.motif_renvoi}</div>}
      {d.statut === 'brouillon' && d.niveau_calcule?.niveau === 'direction' && <div className="cm-note" style={{ background: '#f5f3ff', color: '#5b21b6' }}>Validation de la direction requise : {d.niveau_calcule.motif}.</div>}
      {['a_valider', 'a_valider_direction'].includes(d.statut) && (
        <div className="cm-note">{d.statut === 'a_valider' ? 'En attente de la validation du responsable commercial' : 'Validé par le responsable ; en attente de la direction'}
          {d.niveau === 'direction' ? ` (direction requise : ${d.motif_direction})` : ''}.</div>
      )}
      {d.expire && <div className="cm-erreur">Ce devis a expiré le {dateFr(d.date_validite)} : il ne peut plus être accepté. Dupliquez-le pour en établir un nouveau.</div>}
      {d.statut === 'valide' && !d.expire && <div className="cm-note" style={{ background: '#ecfdf5', color: '#065f46' }}>Devis validé : remettez le PDF « bon pour accord » au client, puis enregistrez sa réponse.</div>}
      {d.statut === 'refuse' && <div className="cm-erreur"><strong>Refusé par le client</strong> le {dateFr(d.decision_le, true)} : « {d.motif_refus} »</div>}
      {d.statut === 'annule' && <div className="cm-erreur"><strong>Devis annulé</strong> le {dateFr(d.annule_le, true)} par {d.annule_par_nom} : « {d.motif_annulation} »</div>}
      {d.commande_id && <div className="cm-note" style={{ background: '#ecfdf5', color: '#065f46' }}>Accepté par le client : commande {lien(`/commercial/commandes-clients/${d.commande_id}`, d.commande_numero)}.</div>}
      <div className="cm-deux">
        <div>
          <Section titre="Client et conditions">
            <dl className="cm-infos">
              <div><dt>Client</dt><dd>{d.client.nom}{d.client.telephone ? ` · ${d.client.telephone}` : ''}</dd></div>
              <div><dt>Objet</dt><dd>{d.objet || '—'}</dd></div>
              <div><dt>Date</dt><dd>{dateFr(d.date_devis)}</dd></div>
              <div><dt>Valable jusqu'au</dt><dd>{dateFr(d.date_validite)}</dd></div>
              <div><dt>Paiement</dt><dd>{d.conditions_paiement || '—'}</dd></div>
              <div><dt>Délai de livraison</dt><dd>{d.delai_livraison || '—'}</dd></div>
            </dl>
            {d.observations && <p className="cm-aide" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}><strong>Observations :</strong> {d.observations}</p>}
          </Section>
          <Section titre={`Articles (${d.lignes.length})`}>
            <LignesPrix lignes={d.lignes} devise={d.devise} />
            <Totaux d={d} />
          </Section>
        </div>
        <div>
          <PiecesDoc d={d} base="/commercial/devis" onMaj={setD} aide="Joignez la demande du client ou le devis signé « bon pour accord »." />
          <HistoriqueDoc historique={d.historique} />
        </div>
      </div>
      {accepter && <AccepterDevis d={d} onFermer={() => setAccepter(false)} onFait={(c) => navigate(`/commercial/commandes-clients/${c.id}`)} />}
    </div>
  );
}

// ══ COMMANDES CLIENTS ════════════════════════════════════════════════════
export function CommandesClientsPage() {
  const [etat, setEtat] = useState('');
  const [q, setQ] = useState(''); const [du, setDu] = useState(''); const [au, setAu] = useState('');
  const qd = useDiffere(q);
  const statut = etat === 'annulee' ? 'annulee' : etat ? 'ouverte' : '';
  const { donnees, erreur } = useListe(`/commercial/commandes-clients?statut=${statut}&etat=${etat === 'annulee' ? '' : etat}&q=${encodeURIComponent(qd)}&du=${du}&au=${au}`);
  return (
    <div className="cm-page">
      <Entete titre="Commandes clients"
        description="Une commande naît de l'acceptation d'un devis validé. Elle reprend ses lignes et ses prix, avec la référence et la pièce du bon de commande du client ; elle se livre en une ou plusieurs fois." />
      <Outils q={q} setQ={setQ} statut={etat} setStatut={setEtat} du={du} setDu={setDu} au={au} setAu={setAu} placeholder="Numéro, client, référence…"
        nb={donnees ? `${donnees.length} commande${donnees.length > 1 ? 's' : ''}` : ''}
        statuts={[['', 'Toutes'], ['a_livrer', 'À livrer'], ['partielle', 'Livrées en partie'], ['livree', 'Livrées'], ['annulee', 'Annulées']]} />
      {erreur && <div className="cm-erreur">{erreur}</div>}
      <TableListe donnees={donnees} lienDe={(c) => `/commercial/commandes-clients/${c.id}`} vide="Les commandes s'enregistrent depuis un devis validé (« Accepté par le client »)."
        colonnes={['Commande', 'Date', 'Client', 'Devis', 'Total TTC', 'Livraison']}
        ligne={(c) => (
          <>
            <td><span className="cm-code">{c.numero}</span>{c.reference_client && <span className="cm-sous">Réf. client {c.reference_client}</span>}</td>
            <td>{dateFr(c.date_commande)}</td>
            <td><strong>{c.client_nom}</strong></td>
            <td>{c.devis_numero}</td>
            <td className="cm-num">{fmtMontant(c.total_ttc, c.devise)}</td>
            <td><StatutVente statut={c.statut === 'annulee' ? 'annulee' : c.etat_livraison} />{c.livraisons_en_cours > 0 && <span className="cm-sous">{c.livraisons_en_cours} en préparation</span>}</td>
          </>
        )} />
    </div>
  );
}

export function CommandeClientPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { d, setD, erreur, enCours, agir } = useFiche(`/commercial/commandes-clients/${id}`);
  if (!d) return <div className="cm-page"><Link to="/commercial/commandes-clients" className="cm-retour">‹ Commandes clients</Link>{erreur ? <div className="cm-erreur">{erreur}</div> : <div className="loading-msg">Chargement…</div>}</div>;
  const annuler = () => {
    const m = (window.prompt(`Annuler la commande ${d.numero} ?\n\nMotif :`) || '').trim();
    if (m) agir('annuler', () => api.post(`/commercial/commandes-clients/${d.id}/annulation`, { motif: m }), 'Commande annulée.');
  };
  return (
    <div className="cm-page">
      <Link to="/commercial/commandes-clients" className="cm-retour">‹ Commandes clients</Link>
      <div className="cm-fiche-tete">
        <div>
          <h2><span className="cm-code" style={{ fontSize: 15 }}>{d.numero}</span>Commande client <StatutVente statut={d.statut === 'annulee' ? 'annulee' : d.etat_livraison} /></h2>
          <span className="cm-sous">Enregistrée par {d.cree_par_nom} le {dateFr(d.cree_le, true)} · devis {lien(`/commercial/devis/${d.devis_id}`, d.devis_numero)}</span>
        </div>
        <div className="cm-actions">
          {d.droits.annuler && <button type="button" className="cm-btn cm-danger" onClick={annuler} disabled={Boolean(enCours)}>Annuler</button>}
          {d.droits.livrer && <button type="button" className="cm-btn cm-primaire" onClick={() => navigate(`/commercial/livraisons/nouvelle?commande=${d.id}`)}>Préparer une livraison</button>}
        </div>
      </div>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      {d.statut === 'annulee' && <div className="cm-erreur"><strong>Commande annulée</strong> le {dateFr(d.annule_le, true)} par {d.annule_par_nom} : « {d.motif_annulation} »</div>}
      <div className="cm-deux">
        <div>
          <Section titre="Commande">
            <dl className="cm-infos">
              <div><dt>Client</dt><dd>{d.client.nom}</dd></div>
              <div><dt>Référence du client</dt><dd>{d.reference_client || '—'}</dd></div>
              <div><dt>Date</dt><dd>{dateFr(d.date_commande)}</dd></div>
              <div><dt>Livraison souhaitée</dt><dd>{d.date_livraison_souhaitee ? dateFr(d.date_livraison_souhaitee) : '—'}</dd></div>
              <div><dt>Adresse de livraison</dt><dd>{d.adresse_livraison || d.client.adresse || '—'}</dd></div>
            </dl>
            {d.observations && <p className="cm-aide" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}><strong>Observations :</strong> {d.observations}</p>}
          </Section>
          <Section titre={`Articles (${d.lignes.length})`}>
            <LignesPrix lignes={d.lignes} devise={d.devise} extra={{
              titres: <><th style={{ textAlign: 'right' }}>Livré</th><th style={{ textAlign: 'right' }}>Reste</th></>,
              cellules: (l) => <>
                <td className="cm-num"><span className="cm-l-lib">Livré</span>{fmtQte(l.livre)}{l.en_cours > 0 && <span className="cm-sous">+ {fmtQte(l.en_cours)} en préparation</span>}</td>
                <td className="cm-num"><span className="cm-l-lib">Reste</span>{l.reste > 0 ? <strong>{fmtQte(l.reste)}</strong> : 'soldé'}</td>
              </>,
            }} />
            <Totaux d={d} />
          </Section>
          <Section titre={`Livraisons (${d.livraisons.length})`}>
            {d.livraisons.length === 0 ? <p className="cm-aide">Aucune livraison pour l'instant.</p> : (
              <ul className="cm-pieces">
                {d.livraisons.map((x) => (
                  <li key={x.id}>
                    {x.visible ? <Link to={`/commercial/livraisons/${x.id}`}>{x.numero}</Link> : <span>{x.numero}</span>}
                    <span className="cm-sous">{dateFr(x.date_livraison)} · {x.magasin_code} · <StatutVente statut={x.statut} livraison /></span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
        <div>
          <PiecesDoc d={d} base="/commercial/commandes-clients" onMaj={setD} aide="Joignez le bon de commande signé du client." />
          <HistoriqueDoc historique={d.historique} />
        </div>
      </div>
    </div>
  );
}

// ══ LIVRAISONS ═══════════════════════════════════════════════════════════
function ALivrer() {
  const navigate = useNavigate();
  const { can } = useApp();
  const { donnees, erreur } = useListe('/commercial/livraisons/a-livrer');
  return (
    <>
      <p className="cm-aide" style={{ margin: '0 0 10px' }}>Commandes clients ouvertes dont une partie au moins reste à livrer.</p>
      {erreur && <div className="cm-erreur">{erreur}</div>}
      <div className="cm-table-wrap">
        <table className="cm-table" style={{ minWidth: 680 }}>
          <thead><tr><th>Commande</th><th>Client</th><th>Souhaitée le</th><th>État</th><th /></tr></thead>
          <tbody>
            {!donnees ? <tr><td colSpan={5} className="cm-vide">Chargement…</td></tr>
              : donnees.length === 0 ? <tr><td colSpan={5} className="cm-vide"><strong>Rien à livrer</strong>Toutes les commandes sont livrées.</td></tr>
                : donnees.map((c) => (
                  <tr key={c.id}>
                    <td><span className="cm-code">{c.numero}</span>{c.reference_client && <span className="cm-sous">Réf. {c.reference_client}</span>}</td>
                    <td><strong>{c.client_nom}</strong></td>
                    <td>{c.date_livraison_souhaitee ? dateFr(c.date_livraison_souhaitee) : '—'}</td>
                    <td><StatutVente statut={c.etat_livraison} />{c.livraisons_en_cours > 0 && <span className="cm-sous">{c.livraisons_en_cours} en préparation</span>}</td>
                    <td style={{ textAlign: 'right' }}>{can('com.ventes.preparer') && <button type="button" className="cm-btn cm-primaire" onClick={() => navigate(`/commercial/livraisons/nouvelle?commande=${c.id}`)}>Préparer</button>}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ListeLivraisons({ statutInitial = '' }) {
  const [statut, setStatut] = useState(statutInitial);
  const [q, setQ] = useState(''); const [du, setDu] = useState(''); const [au, setAu] = useState('');
  const qd = useDiffere(q);
  const { donnees, erreur } = useListe(`/commercial/livraisons?statut=${statut}&q=${encodeURIComponent(qd)}&du=${du}&au=${au}`);
  return (
    <>
      <Outils q={q} setQ={setQ} statut={statut} setStatut={setStatut} du={du} setDu={setDu} au={au} setAu={setAu} placeholder="Numéro, client, commande…"
        nb={donnees ? `${donnees.length} livraison${donnees.length > 1 ? 's' : ''}` : ''}
        statuts={[['', 'Tous les statuts'], ['brouillon', 'En préparation'], ['preparee', 'Préparée'], ['livree', 'Livrée'], ['annule', 'Annulée']]} />
      {erreur && <div className="cm-erreur">{erreur}</div>}
      <TableListe donnees={donnees} lienDe={(x) => `/commercial/livraisons/${x.id}`} vide="Les livraisons se préparent depuis l'onglet « À livrer »."
        colonnes={['Livraison', 'Date', 'Client', 'Commande', 'Magasin', 'Statut']}
        ligne={(x) => (
          <>
            <td><span className="cm-code">{x.numero}</span>{x.transporteur && <span className="cm-sous">{x.transporteur}</span>}</td>
            <td>{dateFr(x.date_livraison)}</td>
            <td><strong>{x.client_nom}</strong></td>
            <td>{x.commande_numero}</td>
            <td>{x.magasin_code}</td>
            <td><StatutVente statut={x.statut} livraison /></td>
          </>
        )} />
    </>
  );
}

export function LivraisonsPage() {
  const { can } = useApp();
  const prepare = can('com.ventes.preparer');
  const [vue, setVue] = useState(prepare ? 'a_livrer' : 'liste');
  return (
    <div className="cm-page">
      <Entete titre="Livraisons clients"
        description="Le magasin prépare la marchandise d'une commande (en une ou plusieurs fois) ; une autre personne valide la livraison, et c'est seulement alors que le stock sort, au coût du stock (CMUP ou FIFO). Le bon de livraison ne porte aucun prix." />
      {prepare && (
        <div className="cm-onglets" role="tablist">
          <button type="button" role="tab" aria-selected={vue === 'a_livrer'} onClick={() => setVue('a_livrer')}>À livrer</button>
          <button type="button" role="tab" aria-selected={vue === 'liste'} onClick={() => setVue('liste')}>Livraisons</button>
        </div>
      )}
      {vue === 'a_livrer' && prepare ? <ALivrer /> : <ListeLivraisons />}
    </div>
  );
}

export function LivraisonFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [commandeId, setCommandeId] = useState(params.get('commande'));
  const [magasins, setMagasins] = useState(null);
  const [prop, setProp] = useState(null);
  const [f, setF] = useState(null);
  const [saisies, setSaisies] = useState({});
  const [numero, setNumero] = useState('');
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    (async () => {
      const m = await api.get('/commercial/magasins?actifs=1&perimetre=1');
      if (m?.error) { setErreur(m.error); return; }
      setMagasins(m);
      if (id) {
        const x = await api.get(`/commercial/livraisons/${id}`);
        if (x?.error) { setErreur(x.error); return; }
        if (!x.droits.modifier) { navigate(`/commercial/livraisons/${id}`, { replace: true }); return; }
        setNumero(x.numero); setCommandeId(String(x.commande_id));
        setF({ magasin_id: String(x.magasin_id), date_livraison: x.date_livraison, adresse_livraison: x.adresse_livraison, transporteur: x.transporteur, observations: x.observations });
        setSaisies(Object.fromEntries(x.lignes.map((l) => [l.commande_ligne_id, virgule(l.quantite)])));
      } else {
        setF({ magasin_id: m.length === 1 ? String(m[0].id) : '', date_livraison: aujourdhui(), adresse_livraison: null, transporteur: '', observations: '' });
      }
    })();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!commandeId || !f) return;
    api.get(`/commercial/livraisons/proposition/${commandeId}${f.magasin_id ? `?magasin_id=${f.magasin_id}` : ''}`).then((p) => {
      if (p?.error) { setErreur(p.error); return; }
      setProp(p);
      if (f.adresse_livraison === null) setF((x) => ({ ...x, adresse_livraison: p.adresse_livraison || '' }));
      if (!id) setSaisies((s) => (Object.keys(s).length ? s : Object.fromEntries(p.lignes.map((l) => [l.id, virgule(l.reste || '')]))));
    });
  }, [commandeId, f?.magasin_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const corps = () => ({ commande_id: commandeId, ...f, adresse_livraison: f.adresse_livraison || '',
    lignes: (prop?.lignes || []).map((l) => ({ commande_ligne_id: l.id, quantite: saisies[l.id] || '' })) });
  const enregistrer = async (preparer) => {
    setEnCours(true); setErreur('');
    const r = id ? await api.put(`/commercial/livraisons/${id}`, corps()) : await api.post('/commercial/livraisons', corps());
    if (r?.error) { setEnCours(false); setErreur(r.error); return; }
    if (preparer) {
      const s = await api.post(`/commercial/livraisons/${r.id}/preparation`, {});
      setEnCours(false);
      if (s?.error) { setErreur(s.error); if (!id) navigate(`/commercial/livraisons/${r.id}/modifier`, { replace: true }); return; }
      toast(`${s.numero} préparée : elle attend la validation d'une autre personne.`, 'success');
    } else { setEnCours(false); toast(`Préparation ${r.numero} enregistrée.`, 'success'); }
    navigate(`/commercial/livraisons/${r.id}`);
  };

  if (!magasins || !f) return <div className="cm-page">{erreur ? <div className="cm-erreur">{erreur}</div> : <div className="loading-msg">Chargement…</div>}</div>;
  if (!commandeId) return <div className="cm-page"><div className="cm-erreur">Choisissez une commande depuis « À livrer ».</div></div>;
  return (
    <div className="cm-page">
      <Link to={id ? `/commercial/livraisons/${id}` : '/commercial/livraisons'} className="cm-retour">‹ {id ? numero : 'Livraisons'}</Link>
      <div className="cm-fiche-tete">
        <div>
          <h2>{id ? `Modifier ${numero}` : 'Préparer une livraison'}</h2>
          {prop && <span className="cm-sous">Commande {prop.commande_numero} · {prop.client_nom}{prop.reference_client ? ` · réf. ${prop.reference_client}` : ''}</span>}
        </div>
        <div className="cm-actions">
          <button type="button" className="cm-btn cm-secondaire" onClick={() => enregistrer(false)} disabled={enCours || !prop}>Enregistrer</button>
          <button type="button" className="cm-btn cm-primaire" onClick={() => enregistrer(true)} disabled={enCours || !prop}>{enCours ? 'Envoi…' : 'Préparation terminée'}</button>
        </div>
      </div>
      <div className="cm-note">Saisissez ce qui est réellement prélevé au magasin. Le stock ne sort qu'à la validation de la livraison, par une autre personne.</div>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      <Section titre="Expédition">
        <div className="cm-grille">
          <Champ label="Magasin d'expédition" requis id="lvm">
            <select id="lvm" value={f.magasin_id} onChange={set('magasin_id')} disabled={Boolean(id)}>
              <option value="">— Choisir —</option>
              {magasins.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.nom}</option>)}
            </select>
          </Champ>
          <Champ label="Date de livraison" requis id="lvd"><input id="lvd" type="date" max={aujourdhui()} value={f.date_livraison} onChange={set('date_livraison')} /></Champ>
          <Champ label="Transporteur" id="lvt"><input id="lvt" value={f.transporteur} onChange={set('transporteur')} maxLength={150} placeholder="Ex. Camion 12, chauffeur Paul" /></Champ>
          <Champ label="Adresse de livraison" id="lva"><input id="lva" value={f.adresse_livraison || ''} onChange={set('adresse_livraison')} maxLength={300} /></Champ>
          <Champ label="Observations" id="lvo" pleine><textarea id="lvo" value={f.observations} onChange={set('observations')} maxLength={2000} /></Champ>
        </div>
      </Section>
      <Section titre="Articles à livrer">
        {!prop ? <div className="loading-msg">Chargement…</div> : (
          <table className="cm-lignes">
            <thead><tr><th>Article</th><th style={{ textAlign: 'right' }}>Commandé</th><th style={{ textAlign: 'right' }}>Déjà livré</th><th style={{ textAlign: 'right' }}>Reste</th><th style={{ textAlign: 'right' }}>En stock</th><th style={{ textAlign: 'right' }}>À livrer</th></tr></thead>
            <tbody>
              {prop.lignes.map((l) => {
                const q = lireNombre(saisies[l.id]) || 0;
                const manque = l.disponible !== null && q > l.disponible + 1e-9;
                return (
                  <tr key={l.id}>
                    <td className="cm-l-article"><strong>{l.designation}</strong><span className="cm-sous">{l.reference}{!l.suivi_stock ? ' · prestation' : ''}</span></td>
                    <td className="cm-num"><span className="cm-l-lib">Commandé</span>{fmtQte(l.quantite)} {l.unite}</td>
                    <td className="cm-num"><span className="cm-l-lib">Déjà livré</span>{fmtQte(l.livre)}{l.en_cours > 0 && <span className="cm-sous">+ {fmtQte(l.en_cours)} en préparation</span>}</td>
                    <td className="cm-num"><span className="cm-l-lib">Reste</span>{fmtQte(l.reste)}</td>
                    <td className="cm-num"><span className="cm-l-lib">En stock</span>{l.disponible === null ? (l.suivi_stock ? '—' : 'sans stock') : <span style={manque ? { color: '#b91c1c', fontWeight: 600 } : undefined}>{fmtQte(l.disponible)}</span>}</td>
                    <td style={{ textAlign: 'right' }}>
                      <input className="cm-qte-input" inputMode="decimal" value={saisies[l.id] ?? ''} onChange={(e) => setSaisies((s) => ({ ...s, [l.id]: e.target.value }))}
                        aria-label={`Quantité à livrer de ${l.designation}`} style={q > l.reste + 1e-9 || manque ? { borderColor: '#d97706' } : undefined} />
                      <span className="cm-sous">{l.unite}</span>
                      {l.coefficient !== 1 && q > 0 && <span className="cm-conv">= {fmtQte(Math.round(q * l.coefficient * 1000) / 1000)} {l.unite_stock}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="cm-aide" style={{ marginTop: 8 }}>Laissez vide ou 0 ce qui n'est pas livré cette fois : le reste pourra l'être plus tard. Jamais au-delà du reste ; le stock négatif est refusé.</p>
      </Section>
    </div>
  );
}

export function LivraisonPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { d, setD, erreur, enCours, agir } = useFiche(`/commercial/livraisons/${id}`);
  if (!d) return <div className="cm-page"><Link to="/commercial/livraisons" className="cm-retour">‹ Livraisons</Link>{erreur ? <div className="cm-erreur">{erreur}</div> : <div className="loading-msg">Chargement…</div>}</div>;
  const base = `/commercial/livraisons/${d.id}`;
  const dr = d.droits; const occupe = Boolean(enCours);
  const motif = (question) => (window.prompt(question) || '').trim();
  const actions = {
    supprimer: async () => { if (window.confirm('Supprimer cette préparation ?') && await agir('s', () => api.delete(base), 'Préparation supprimée.')) navigate('/commercial/livraisons'); },
    preparer: () => agir('preparer', () => api.post(`${base}/preparation`, {}), 'Préparation terminée : en attente de validation.'),
    renvoyer: () => { const m = motif(`Renvoyer ${d.numero} en préparation.\n\nQue faut-il corriger ?`); if (m) agir('renvoyer', () => api.post(`${base}/renvoi`, { motif: m }), 'Renvoyée en préparation.'); },
    valider: () => { if (window.confirm(`Valider la livraison ${d.numero} ?\n\nLe stock sort à cet instant ; une livraison validée ne peut qu'être annulée, avec un motif.`)) agir('valider', () => api.post(`${base}/validation`, {}), 'Livraison validée : stock mis à jour.'); },
    annuler: () => { const m = motif(`Annuler la livraison ${d.numero} ?\nLa marchandise rentre en stock ; le document reste consultable.\n\nMotif :`); if (m) agir('annuler', () => api.post(`${base}/annulation`, { motif: m }), 'Livraison annulée.'); },
    pdf: () => ouvrirFichier(api, `${base}/pdf`, `${d.numero}.pdf`, 'application/pdf', toast),
  };
  return (
    <div className="cm-page">
      <Link to="/commercial/livraisons" className="cm-retour">‹ Livraisons</Link>
      <div className="cm-fiche-tete">
        <div>
          <h2><span className="cm-code" style={{ fontSize: 15 }}>{d.numero}</span>Livraison <StatutVente statut={d.statut} livraison /></h2>
          <span className="cm-sous">Préparée par {d.prepare_par_nom || d.cree_par_nom}{d.livre_le ? ` · validée par ${d.livre_par_nom} le ${dateFr(d.livre_le, true)}` : ''}</span>
        </div>
        <div className="cm-actions">
          {dr.modifier && <button type="button" className="cm-btn cm-danger" onClick={actions.supprimer} disabled={occupe}>Supprimer</button>}
          {dr.annuler && <button type="button" className="cm-btn cm-danger" onClick={actions.annuler} disabled={occupe}>Annuler</button>}
          <button type="button" className="cm-btn cm-secondaire" onClick={actions.pdf}>{d.statut === 'livree' ? 'Bon de livraison (PDF)' : 'Bon de préparation (PDF)'}</button>
          {dr.modifier && <button type="button" className="cm-btn cm-secondaire" onClick={() => navigate(`${base}/modifier`)}>Modifier</button>}
          {dr.preparer && <button type="button" className="cm-btn cm-primaire" onClick={actions.preparer} disabled={occupe}>Préparation terminée</button>}
          {dr.renvoyer && <button type="button" className="cm-btn cm-secondaire" onClick={actions.renvoyer} disabled={occupe}>Renvoyer en préparation</button>}
          {dr.valider && <button type="button" className="cm-btn cm-primaire" onClick={actions.valider} disabled={occupe}>{enCours === 'valider' ? 'Validation…' : 'Valider la livraison'}</button>}
        </div>
      </div>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      {dr.auto_validation_interdite && <div className="cm-note">Vous avez préparé cette livraison : une autre personne doit la valider (séparation des tâches).</div>}
      {d.statut === 'brouillon' && d.motif_renvoi && <div className="cm-note" style={{ background: '#eff6ff' }}><strong>À corriger :</strong> {d.motif_renvoi}</div>}
      {d.statut === 'preparee' && !dr.valider && !dr.auto_validation_interdite && <div className="cm-note">Préparée : en attente de validation. Le stock n'a pas encore bougé.</div>}
      {d.statut === 'annule' && <div className="cm-erreur"><strong>Livraison annulée</strong> le {dateFr(d.annule_le, true)} par {d.annule_par_nom} : « {d.motif_annulation} »</div>}
      <div className="cm-deux">
        <div>
          <Section titre="Expédition">
            <dl className="cm-infos">
              <div><dt>Client</dt><dd>{d.client_nom}</dd></div>
              <div><dt>Commande</dt><dd><Link to={`/commercial/commandes-clients/${d.commande_id}`}>{d.commande_numero}</Link>{d.reference_client ? ` · réf. ${d.reference_client}` : ''}</dd></div>
              <div><dt>Magasin</dt><dd>{d.magasin_code} — {d.magasin_nom}</dd></div>
              <div><dt>Date</dt><dd>{dateFr(d.date_livraison)}</dd></div>
              <div><dt>Adresse</dt><dd>{d.adresse_livraison || '—'}</dd></div>
              <div><dt>Transporteur</dt><dd>{d.transporteur || '—'}</dd></div>
            </dl>
            {d.observations && <p className="cm-aide" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}><strong>Observations :</strong> {d.observations}</p>}
          </Section>
          <Section titre={`Articles (${d.lignes.length})`}>
            <table className="cm-lignes cm-bc-lecture">
              <thead><tr><th>Article</th><th style={{ textAlign: 'right' }}>Commandé</th><th style={{ textAlign: 'right' }}>Livré ici</th><th style={{ textAlign: 'right' }}>{d.statut === 'livree' ? 'Reste' : 'En stock'}</th></tr></thead>
              <tbody>
                {d.lignes.map((l) => (
                  <tr key={l.id}>
                    <td className="cm-l-article"><strong>{l.designation}</strong><span className="cm-sous">{l.reference}{!l.suivi_stock ? ' · prestation' : ''}</span></td>
                    <td className="cm-num"><span className="cm-l-lib">Commandé</span>{fmtQte(l.commande)} {l.unite}</td>
                    <td className="cm-num"><span className="cm-l-lib">Livré ici</span><strong>{fmtQte(l.quantite)}</strong> {l.unite}{l.coefficient !== 1 && <span className="cm-conv">= {fmtQte(l.quantite_stock)} {l.unite_stock}</span>}</td>
                    <td className="cm-num"><span className="cm-l-lib">{d.statut === 'livree' ? 'Reste' : 'En stock'}</span>{d.statut === 'livree' ? (l.reste > 0 ? fmtQte(l.reste) : 'soldé')
                      : l.disponible_stock === null ? '—' : <span style={l.disponible_stock < l.quantite_stock ? { color: '#b91c1c', fontWeight: 600 } : undefined}>{fmtQte(l.disponible_stock)} {l.unite_stock}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
          <MouvementsDoc mouvements={d.mouvements} />
        </div>
        <div>
          <PiecesDoc d={d} base="/commercial/livraisons" onMaj={setD} aide="Joignez le bon de livraison signé par le client (scan ou photo)." />
          <HistoriqueDoc historique={d.historique} />
        </div>
      </div>
    </div>
  );
}

// ══ VALIDATION DES VENTES ════════════════════════════════════════════════
function DevisAValider() {
  const { donnees } = useListe('/commercial/devis?statut=en_validation');
  return (
    <Section titre="Devis à valider">
      <TableListe donnees={donnees} lienDe={(d) => `/commercial/devis/${d.id}`} vide="Aucun devis en attente." largeur={640}
        colonnes={['Devis', 'Client', 'Saisi par', 'Total TTC', 'Étape']}
        ligne={(d) => (
          <>
            <td><span className="cm-code">{d.numero}</span>{d.niveau === 'direction' && <span className="cm-sous">Direction requise</span>}</td>
            <td><strong>{d.client_nom}</strong></td>
            <td>{d.cree_par_nom}</td>
            <td className="cm-num">{fmtMontant(d.total_ttc, d.devise)}</td>
            <td><StatutVente statut={d.statut} /></td>
          </>
        )} />
    </Section>
  );
}

function LivraisonsAValider() {
  const { donnees } = useListe('/commercial/livraisons?statut=preparee');
  return (
    <Section titre="Livraisons à valider">
      <TableListe donnees={donnees} lienDe={(x) => `/commercial/livraisons/${x.id}`} vide="Aucune livraison préparée en attente." largeur={640}
        colonnes={['Livraison', 'Client', 'Magasin', 'Préparée par', 'Statut']}
        ligne={(x) => (
          <>
            <td><span className="cm-code">{x.numero}</span><span className="cm-sous">{x.commande_numero}</span></td>
            <td><strong>{x.client_nom}</strong></td>
            <td>{x.magasin_code}</td>
            <td>{x.prepare_par_nom}</td>
            <td><StatutVente statut={x.statut} livraison /></td>
          </>
        )} />
    </Section>
  );
}

export function ValidationVentesPage() {
  const { can } = useApp();
  return (
    <div className="cm-page">
      <Entete titre="Validation des ventes"
        description="Devis à valider (responsable commercial, puis direction au-delà du seuil ou d'une remise hors plafond) et livraisons préparées qui attendent leur validation. Personne ne valide ce qu'il a lui-même saisi ou préparé." />
      {(can('com.ventes.valider') || can('com.ventes.valider_direction')) && <DevisAValider />}
      {can('com.ventes.livrer') && <LivraisonsAValider />}
    </div>
  );
}
