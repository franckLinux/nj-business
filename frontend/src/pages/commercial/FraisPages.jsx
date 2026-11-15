// NJ COMMERCIAL — lot 8 (063) : frais accessoires d'achat (transport, douane, transit…).
// Un frais se rattache à un bon de commande émis et se répartit sur ses lignes ; une fois
// VALIDÉ, son montant HT entre dans le coût réel d'acquisition (le stock est revalorisé
// selon la méthode de l'article, CMUP ou FIFO). La taxe du frais n'est jamais incorporée.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { Entete, Section, Champ, useListe, useDiffere, fmtMontant, fmtQte } from '@/components/commercial/ui';
import { dateFr } from '@/components/commercial/achats';
import { PiecesDoc } from '@/components/commercial/fiche';
import { RUBRIQUES_FRAIS, METHODES_FRAIS, STATUTS_FRAIS, StatutFrais, nombreSaisi } from '@/components/commercial/appro';

const aujourdhui = () => new Date().toISOString().slice(0, 10);
const virgule = (n) => (n === null || n === undefined ? '' : String(n).replace('.', ','));
const ACTIONS = { COM_FRAIS_CREATION: 'Frais saisi', COM_FRAIS_MODIFICATION: 'Frais modifié', COM_FRAIS_VALIDATION: 'Frais validé : coût réel mis à jour', COM_FRAIS_ANNULATION: 'Frais annulé' };

// ── Liste : rubrique, prestataire, montant, commande associée ─────────────
export function FraisListePage() {
  const { can } = useApp();
  const [statut, setStatut] = useState('');
  const [q, setQ] = useState('');
  const qd = useDiffere(q);
  const { donnees, erreur } = useListe(`/commercial/frais?statut=${statut}&q=${encodeURIComponent(qd)}`);
  const liste = donnees || [];
  const totalValide = liste.filter((f) => f.statut === 'valide').reduce((t, f) => t + f.montant_ht, 0);
  return (
    <div className="cm-page">
      <Entete titre="Frais d'achat" description="Frais accessoires des commandes (transport, douane, transit, manutention…). Validés, ils s'ajoutent au coût d'achat des articles pour donner leur coût réel en stock.">
        {can('com.frais.saisir') && <Link to="/commercial/frais/nouveau" className="cm-btn cm-primaire" style={{ textDecoration: 'none' }}>+ Nouveau frais</Link>}
      </Entete>
      <div className="cm-outils">
        <input className="cm-recherche" type="search" placeholder="Rechercher un n°, un prestataire, un bon…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher" />
        <select className="cm-select" value={statut} onChange={(e) => setStatut(e.target.value)} aria-label="Statut">
          <option value="">Tous les statuts</option>
          {Object.entries(STATUTS_FRAIS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <span className="cm-compteur">{donnees ? `${liste.length} frais · validés : ${fmtMontant(Math.round(totalValide * 100) / 100)} HT` : ''}</span>
      </div>
      {erreur && <div className="cm-erreur">{erreur}</div>}
      <div className="cm-table-wrap">
        <table className="cm-table">
          <thead><tr><th>N°</th><th>Rubrique</th><th>Nom du fournisseur</th><th className="cm-num">Montant HT</th><th>Commande associée</th><th>Répartition</th><th>Statut</th></tr></thead>
          <tbody>
            {!donnees ? <tr><td colSpan={7} className="cm-vide">Chargement…</td></tr>
              : liste.length === 0 ? <tr><td colSpan={7} className="cm-vide"><strong>Aucun frais d'achat</strong>Saisissez le transport, la douane ou le transit d'une commande émise.</td></tr>
                : liste.map((f) => (
                  <tr key={f.id}>
                    <td><Link to={`/commercial/frais/${f.id}`} className="cm-code">{f.numero}</Link><span className="cm-sous">{dateFr(f.date_frais)}{f.reference_piece ? ` · pièce ${f.reference_piece}` : ''}</span></td>
                    <td><strong>{f.rubrique_libelle}</strong>{f.libelle && <span className="cm-sous">{f.libelle}</span>}</td>
                    <td>{f.fournisseur_nom}</td>
                    <td className="cm-num">{fmtMontant(f.montant_ht, f.devise)}</td>
                    <td><Link to={`/commercial/bons/${f.bc_id}`}>{f.bc_numero}</Link><span className="cm-sous">{f.bc_fournisseur_nom}</span></td>
                    <td>{f.methode_libelle}</td>
                    <td><StatutFrais statut={f.statut} /></td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Saisie (nouveau ou brouillon) avec aperçu de la répartition ───────────
export function FraisFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [bons, setBons] = useState(null);
  const [prestataires, setPrestataires] = useState([]);
  const [f, setF] = useState(null);
  const [manuel, setManuel] = useState({});
  const [apercu, setApercu] = useState(null);
  const [erreurApercu, setErreurApercu] = useState('');
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [numero, setNumero] = useState('');

  useEffect(() => {
    (async () => {
      const [b, t] = await Promise.all([api.get('/commercial/bons-commande?statut=emis'), api.get('/commercial/tiers?type=fournisseur&actifs=1')]);
      setBons(Array.isArray(b) ? b : []);
      setPrestataires(Array.isArray(t) ? t : []);
      if (id) {
        const x = await api.get(`/commercial/frais/${id}`);
        if (x?.error) { setErreur(x.error); return; }
        if (!x.droits.modifier) { navigate(`/commercial/frais/${id}`, { replace: true }); return; }
        setNumero(x.numero);
        setF({ bc_id: String(x.bc_id), rubrique: x.rubrique, libelle: x.libelle, fournisseur_id: x.fournisseur_id ? String(x.fournisseur_id) : '', fournisseur_nom: x.fournisseur_id ? '' : x.fournisseur_nom,
          reference_piece: x.reference_piece, date_frais: x.date_frais, montant_ht: virgule(x.montant_ht), montant_taxe: virgule(x.montant_taxe), methode: x.methode, observations: x.observations });
        if (x.methode === 'manuel') setManuel(Object.fromEntries(x.repartition.map((r) => [r.bc_ligne_id, virgule(r.montant)])));
      } else {
        setF({ bc_id: params.get('bc') || '', rubrique: 'transport', libelle: '', fournisseur_id: '', fournisseur_nom: '', reference_piece: '', date_frais: aujourdhui(),
          montant_ht: '', montant_taxe: '', methode: 'valeur', observations: '' });
      }
    })();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Aperçu de la répartition, recalculé par le serveur à chaque changement utile.
  const cle = f ? JSON.stringify([f.bc_id, f.methode, f.montant_ht, manuel]) : '';
  useEffect(() => {
    if (!f?.bc_id || !(nombreSaisi(f.montant_ht) > 0)) { setApercu(null); setErreurApercu(''); return undefined; }
    const t = setTimeout(async () => {
      const r = await api.post('/commercial/frais/apercu', { bc_id: f.bc_id, rubrique: f.rubrique, montant_ht: f.montant_ht, methode: f.methode,
        manuel: Object.entries(manuel).map(([k, v]) => ({ bc_ligne_id: Number(k), montant: v })) });
      if (Array.isArray(r)) { setApercu(r); setErreurApercu(''); } else { setErreurApercu(r?.error || ''); if (f.methode !== 'manuel') setApercu(null); }
    }, 300);
    return () => clearTimeout(t);
  }, [cle]); // eslint-disable-line react-hooks/exhaustive-deps
  // En affectation manuelle, les lignes du bon viennent d'un aperçu « valeur » (toujours calculable).
  const [lignesBon, setLignesBon] = useState([]);
  useEffect(() => {
    if (f?.methode !== 'manuel' || !f.bc_id) return;
    api.post('/commercial/frais/apercu', { bc_id: f.bc_id, rubrique: f.rubrique, montant_ht: nombreSaisi(f.montant_ht) > 0 ? f.montant_ht : 1, methode: 'valeur' })
      .then((r) => setLignesBon(Array.isArray(r) ? r : []));
  }, [f?.methode, f?.bc_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const sommeManuelle = Object.values(manuel).reduce((t, v) => t + (nombreSaisi(v) || 0), 0);
  const enregistrer = async () => {
    setEnCours(true); setErreur('');
    const corps = { ...f, fournisseur_id: f.fournisseur_id || null, fournisseur_nom: f.fournisseur_id ? '' : f.fournisseur_nom,
      manuel: f.methode === 'manuel' ? Object.entries(manuel).map(([k, v]) => ({ bc_ligne_id: Number(k), montant: v })) : [] };
    const r = id ? await api.put(`/commercial/frais/${id}`, corps) : await api.post('/commercial/frais', corps);
    setEnCours(false);
    if (r?.error) { setErreur(r.error); return; }
    toast(`Frais ${r.numero} enregistré (brouillon) : il sera intégré au coût réel après validation.`, 'success');
    navigate(`/commercial/frais/${r.id}`);
  };

  if (!f || !bons) return <div className="cm-page">{erreur ? <div className="cm-erreur">{erreur}</div> : <div className="loading-msg">Chargement…</div>}</div>;
  const bon = bons.find((b) => String(b.id) === String(f.bc_id));
  const lignesAffichees = f.methode === 'manuel' ? lignesBon : (apercu || []);
  return (
    <div className="cm-page">
      <Link to={id ? `/commercial/frais/${id}` : '/commercial/frais'} className="cm-retour">‹ {id ? numero : 'Frais d\'achat'}</Link>
      <div className="cm-fiche-tete">
        <h2>{id ? `Modifier le frais ${numero}` : 'Nouveau frais d\'achat'}</h2>
        <div className="cm-actions"><button type="button" className="cm-btn cm-primaire" onClick={enregistrer} disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</button></div>
      </div>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      <Section titre="Frais">
        <div className="cm-grille">
          <Champ label="Commande associée" requis id="fbc" aide="Un bon de commande émis.">
            <select id="fbc" value={f.bc_id} onChange={set('bc_id')}>
              <option value="">— Choisir —</option>
              {bons.map((b) => <option key={b.id} value={b.id}>{b.numero_complet} — {b.fournisseur_nom} ({fmtMontant(b.total_ht, b.devise)} HT)</option>)}
            </select>
          </Champ>
          <Champ label="Rubrique" requis id="fru">
            <select id="fru" value={f.rubrique} onChange={set('rubrique')}>{Object.entries(RUBRIQUES_FRAIS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </Champ>
          <Champ label="Nom du fournisseur (prestataire)" requis id="fpr" aide="Transporteur, transitaire… Choisissez-le, ou saisissez son nom s'il n'est pas enregistré.">
            <select id="fpr" value={f.fournisseur_id} onChange={set('fournisseur_id')}>
              <option value="">— Autre (saisir le nom) —</option>
              {prestataires.map((t) => <option key={t.id} value={t.id}>{t.nom}</option>)}
            </select>
            {!f.fournisseur_id && <input value={f.fournisseur_nom} onChange={set('fournisseur_nom')} maxLength={150} placeholder="Nom du prestataire" style={{ marginTop: 6 }} aria-label="Nom du prestataire" />}
          </Champ>
          <Champ label="Libellé" id="fli"><input id="fli" value={f.libelle} onChange={set('libelle')} maxLength={200} placeholder="Ex. Transport Douala – Yaoundé" /></Champ>
          <Champ label="Montant HT" requis id="fmh" aide="Seul le hors-taxes entre dans le coût des articles."><input id="fmh" inputMode="decimal" value={f.montant_ht} onChange={set('montant_ht')} /></Champ>
          <Champ label="Taxe de la pièce" id="fmt" aide="Récupérable : jamais incorporée au coût."><input id="fmt" inputMode="decimal" value={f.montant_taxe} onChange={set('montant_taxe')} /></Champ>
          <Champ label="Référence de la pièce" id="frf"><input id="frf" value={f.reference_piece} onChange={set('reference_piece')} maxLength={60} placeholder="N° de facture du prestataire" /></Champ>
          <Champ label="Date" id="fdt"><input id="fdt" type="date" max={aujourdhui()} value={f.date_frais} onChange={set('date_frais')} /></Champ>
          <Champ label="Observations" id="fob" pleine><textarea id="fob" value={f.observations} onChange={set('observations')} maxLength={1000} /></Champ>
        </div>
      </Section>
      <Section titre="Répartition sur les articles de la commande">
        <div className="cm-methodes" role="radiogroup" aria-label="Méthode de répartition">
          {Object.entries(METHODES_FRAIS).map(([k, [l, d]]) => (
            <label key={k} className={f.methode === k ? 'cm-choisi' : ''}>
              <input type="radio" name="methode" checked={f.methode === k} onChange={() => setF((x) => ({ ...x, methode: k }))} />
              <span><strong>{l}</strong><span className="cm-sous">{d}</span></span>
            </label>
          ))}
        </div>
        {!f.bc_id ? <p className="cm-aide" style={{ marginTop: 10 }}>Choisissez la commande pour voir la répartition.</p> : (
          <>
            {erreurApercu && <div className="cm-erreur" style={{ marginTop: 10 }}>{erreurApercu}</div>}
            {lignesAffichees.length > 0 && (
              <div className="cm-table-defile" style={{ marginTop: 12 }}>
              <table className="cm-lignes">
                <thead><tr><th>Article</th><th style={{ textAlign: 'right' }}>Quantité</th><th style={{ textAlign: 'right' }}>Montant HT de la ligne</th>
                  {f.methode === 'poids' && <th style={{ textAlign: 'right' }}>Poids unitaire</th>}<th style={{ textAlign: 'right' }}>Part du frais</th><th style={{ textAlign: 'right' }}>Frais par unité</th></tr></thead>
                <tbody>
                  {lignesAffichees.map((l) => {
                    const part = f.methode === 'manuel' ? (nombreSaisi(manuel[l.bc_ligne_id]) || 0) : l.part;
                    return (
                      <tr key={l.bc_ligne_id}>
                        <td className="cm-l-article"><strong>{l.designation}</strong><span className="cm-sous">{l.reference}</span></td>
                        <td className="cm-num"><span className="cm-l-lib">Quantité</span>{fmtQte(l.quantite)} {l.unite}</td>
                        <td className="cm-num"><span className="cm-l-lib">Ligne HT</span>{fmtMontant(l.montant_ht, '')}</td>
                        {f.methode === 'poids' && <td className="cm-num"><span className="cm-l-lib">Poids</span>{l.poids_kg === null ? <span style={{ color: '#b91c1c' }}>manquant</span> : `${fmtQte(l.poids_kg)} kg`}</td>}
                        <td className="cm-num"><span className="cm-l-lib">Part</span>
                          {f.methode === 'manuel'
                            ? <input className="cm-qte-input" style={{ width: 110 }} inputMode="decimal" value={manuel[l.bc_ligne_id] ?? ''} onChange={(e) => setManuel((m) => ({ ...m, [l.bc_ligne_id]: e.target.value }))} aria-label={`Part de ${l.designation}`} />
                            : <strong>{fmtMontant(part, '')}</strong>}
                        </td>
                        <td className="cm-num"><span className="cm-l-lib">Par unité</span>{l.quantite > 0 ? fmtMontant(Math.round(part / l.quantite * 100) / 100, '') : '—'} <span className="cm-sous" style={{ display: 'inline' }}>/ {l.unite}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            )}
            {f.methode === 'manuel' && (
              <p className="cm-aide" style={{ marginTop: 8, color: Math.abs(sommeManuelle - (nombreSaisi(f.montant_ht) || 0)) > 0.004 ? '#b45309' : undefined }}>
                Somme affectée : {fmtMontant(Math.round(sommeManuelle * 100) / 100)} sur {fmtMontant(nombreSaisi(f.montant_ht) || 0)} HT.
              </p>
            )}
            {bon && <p className="cm-aide" style={{ marginTop: 8 }}>Coût réel d'acquisition = prix d'achat net + part des frais validés, par unité. Il est intégré au stock à la validation du frais (réceptions déjà faites revalorisées, réceptions suivantes valorisées d'office).</p>}
          </>
        )}
      </Section>
    </div>
  );
}

// ── Fiche ─────────────────────────────────────────────────────────────────
export function FraisPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useApp();
  const [f, setF] = useState(null);
  const [couts, setCouts] = useState(null);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  const charger = async () => {
    const r = await api.get(`/commercial/frais/${id}`);
    if (r?.error) { setErreur(r.error); return; }
    setF(r); setErreur('');
    const c = await api.get(`/commercial/bons-commande/${r.bc_id}/couts`);
    if (!c?.error) setCouts(c);
  };
  useEffect(() => { charger(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const agir = async (url, corps, msg, apres) => {
    setEnCours(true); setErreur('');
    const r = await api.post(url, corps);
    setEnCours(false);
    if (r?.error) { setErreur(r.error); return; }
    toast(msg, 'success');
    if (apres) apres(); else charger();
  };
  const valider = () => { if (window.confirm(`Valider le frais ${f.numero} ? Son montant HT sera intégré au coût réel des articles du bon ${f.bc_numero} et le stock revalorisé.`)) agir(`/commercial/frais/${id}/validation`, {}, 'Frais validé : coût réel et stock mis à jour.'); };
  const annuler = () => { const m = window.prompt(`Annuler le frais ${f.numero} ? Le coût des articles reviendra au prix d'achat (stock revalorisé).\n\nMotif :`) || ''; if (m.trim().length >= 3) agir(`/commercial/frais/${id}/annulation`, { motif: m }, 'Frais annulé.'); };
  const supprimer = async () => {
    if (!window.confirm(`Supprimer le brouillon ${f.numero} ?`)) return;
    const r = await api.delete(`/commercial/frais/${id}`);
    if (r?.error) { setErreur(r.error); return; }
    toast('Brouillon supprimé.', 'success'); navigate('/commercial/frais');
  };
  if (!f) return <div className="cm-page">{erreur ? <><Link to="/commercial/frais" className="cm-retour">‹ Frais d'achat</Link><div className="cm-erreur">{erreur}</div></> : <div className="loading-msg">Chargement…</div>}</div>;
  const pieces = { ...f, pieces: f.documents.map((p) => ({ ...p, ajoute_par_nom: '' })), droits: { joindre: f.statut !== 'annule' && can('com.frais.saisir') } };
  return (
    <div className="cm-page">
      <Link to="/commercial/frais" className="cm-retour">‹ Frais d'achat</Link>
      <div className="cm-fiche-tete">
        <div>
          <h2><span className="cm-code" style={{ fontSize: 15 }}>{f.numero}</span> {f.rubrique_libelle} <StatutFrais statut={f.statut} /></h2>
          <span className="cm-sous">Commande <Link to={`/commercial/bons/${f.bc_id}`}>{f.bc_numero}</Link> ({f.bc_fournisseur_nom}) · saisi par {f.cree_par_nom} le {dateFr(f.cree_le, true)}</span>
        </div>
        <div className="cm-actions">
          {f.droits.modifier && <button type="button" className="cm-btn cm-danger" onClick={supprimer} disabled={enCours}>Supprimer</button>}
          {f.droits.annuler && <button type="button" className="cm-btn cm-danger" onClick={annuler} disabled={enCours}>Annuler</button>}
          {f.droits.modifier && <button type="button" className="cm-btn cm-secondaire" onClick={() => navigate(`/commercial/frais/${id}/modifier`)}>Modifier</button>}
          {f.droits.valider && <button type="button" className="cm-btn cm-primaire" onClick={valider} disabled={enCours}>Valider</button>}
        </div>
      </div>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      {f.statut === 'brouillon' && <div className="cm-note">Brouillon : ce frais n'entre pas encore dans le coût réel. {f.droits.valider ? 'Vérifiez-le puis validez-le.' : 'Une personne habilitée (comptable) le validera.'}</div>}
      <div className="cm-deux">
        <div>
          <Section titre="Frais">
            <dl className="cm-infos">
              <div><dt>Rubrique</dt><dd>{f.rubrique_libelle}{f.libelle && <span className="cm-sous">{f.libelle}</span>}</dd></div>
              <div><dt>Fournisseur (prestataire)</dt><dd>{f.fournisseur_nom}</dd></div>
              <div><dt>Montant HT</dt><dd>{fmtMontant(f.montant_ht, f.devise)}</dd></div>
              <div><dt>Taxe (non incorporée)</dt><dd>{fmtMontant(f.montant_taxe, f.devise)}</dd></div>
              <div><dt>Pièce</dt><dd>{f.reference_piece || '—'} du {dateFr(f.date_frais)}</dd></div>
              <div><dt>Répartition</dt><dd>{f.methode_libelle}</dd></div>
              {f.valide_le && <div><dt>Validé</dt><dd>{dateFr(f.valide_le, true)} par {f.valide_par_nom}</dd></div>}
              {f.annule_le && <div><dt>Annulé</dt><dd>{dateFr(f.annule_le, true)} par {f.annule_par_nom}<span className="cm-sous">{f.motif_annulation}</span></dd></div>}
            </dl>
            {f.observations && <p className="cm-aide" style={{ marginTop: 10 }}><strong>Observations :</strong> {f.observations}</p>}
          </Section>
          <Section titre="Répartition par article">
            <table className="cm-lignes">
              <thead><tr><th>Article</th><th style={{ textAlign: 'right' }}>Quantité</th><th style={{ textAlign: 'right' }}>Part du frais</th><th style={{ textAlign: 'right' }}>Par unité</th></tr></thead>
              <tbody>{f.repartition.map((r) => (
                <tr key={r.bc_ligne_id}><td className="cm-l-article"><strong>{r.designation}</strong><span className="cm-sous">{r.reference}</span></td>
                  <td className="cm-num">{fmtQte(r.quantite)} {r.unite}</td><td className="cm-num"><strong>{fmtMontant(r.montant, '')}</strong></td>
                  <td className="cm-num">{r.quantite > 0 ? fmtMontant(Math.round(r.montant / r.quantite * 100) / 100, '') : '—'}</td></tr>
              ))}</tbody>
            </table>
          </Section>
        </div>
        <div>
          {couts && <CoutsBon couts={couts} />}
          <PiecesDoc d={pieces} base="/commercial/frais" onMaj={() => charger()} aide="Joignez la facture du transporteur, du transitaire…" />
        </div>
      </div>
    </div>
  );
}

// Coût réel d'acquisition d'un bon : prix d'achat net + frais validés, par unité.
export function CoutsBon({ couts, titre = 'Coût réel d\'acquisition' }) {
  return (
    <Section titre={titre}>
      <div className="cm-table-defile">
      <table className="cm-lignes">
        <thead><tr><th>Article</th><th style={{ textAlign: 'right' }}>Prix d'achat net</th><th style={{ textAlign: 'right' }}>Frais par unité</th><th style={{ textAlign: 'right' }}>Coût réel unitaire</th></tr></thead>
        <tbody>{couts.lignes.map((l) => (
          <tr key={l.bc_ligne_id}><td className="cm-l-article"><strong>{l.designation}</strong><span className="cm-sous">{fmtQte(l.quantite)} {l.unite}{l.frais_brouillon ? ` · ${fmtMontant(l.frais_brouillon, '')} de frais en brouillon` : ''}</span></td>
            <td className="cm-num"><span className="cm-l-lib">Achat net</span>{fmtMontant(l.prix_net, '')}</td>
            <td className="cm-num"><span className="cm-l-lib">Frais</span>{fmtMontant(Math.round(l.frais_unitaire * 100) / 100, '')}</td>
            <td className="cm-num"><span className="cm-l-lib">Coût réel</span><strong>{fmtMontant(Math.round(l.cout_reel_unitaire * 100) / 100, '')}</strong><span className="cm-sous">par {l.unite}</span></td></tr>
        ))}</tbody>
      </table>
      </div>
      <div className="cm-totaux">
        <div><span>Achats HT</span><strong>{fmtMontant(couts.total_achat, couts.devise)}</strong></div>
        <div><span>Frais validés</span><strong>{fmtMontant(couts.total_frais, couts.devise)}</strong></div>
        <div className="cm-ttc"><span>Coût réel total</span><strong>{fmtMontant(couts.total_reel, couts.devise)}</strong></div>
      </div>
    </Section>
  );
}
