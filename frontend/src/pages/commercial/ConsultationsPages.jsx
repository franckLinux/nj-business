// NJ COMMERCIAL — lot 8 (063) : consultation des fournisseurs (demandes de proforma),
// comparaison des offres et attribution par article. Étape FACULTATIVE entre la demande
// validée et le bon de commande. Le serveur revérifie tout (droits, minimum de trois
// fournisseurs sauf dérogation, quantités restant à commander, choix motivés).
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { Entete, Section, Champ, Cases, useListe, useDiffere, fmtMontant, fmtQte } from '@/components/commercial/ui';
import { dateFr, ouvrirFichier, StatutBon } from '@/components/commercial/achats';
import { StatutConsultation, StatutFournisseurConsulte, STATUTS_CONSULTATION, delaiTexte, copier, nombreSaisi } from '@/components/commercial/appro';

const MINIMUM = 3;
const dansJours = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const virgule = (n) => String(n).replace('.', ',');
const ACTIONS = {
  COM_CONSULTATION_CREATION: 'Consultation créée', COM_CONSULTATION_MODIFICATION: 'Consultation modifiée', COM_CONSULTATION_LANCEMENT: 'Consultation lancée',
  COM_CONSULTATION_ENVOI: 'Demande de proforma envoyée', COM_CONSULTATION_AJOUT_FOURNISSEUR: 'Fournisseur ajouté', COM_CONSULTATION_OFFRE_RECUE: 'Offre reçue',
  COM_CONSULTATION_REFUS: 'Consultation déclinée par le fournisseur', COM_CONSULTATION_REOUVERTURE: 'Offre rouverte', COM_CONSULTATION_ANNULATION: 'Consultation annulée',
  COM_CONSULTATION_ATTRIBUTION: 'Attribution des articles',
};

// ── Liste ─────────────────────────────────────────────────────────────────
export function ConsultationsPage() {
  const [statut, setStatut] = useState('');
  const [q, setQ] = useState('');
  const qd = useDiffere(q);
  const { donnees, erreur } = useListe(`/commercial/consultations?statut=${statut}&q=${encodeURIComponent(qd)}`);
  const liste = donnees || [];
  return (
    <div className="cm-page">
      <Entete titre="Consultations des fournisseurs" description="Demandes de proforma : plusieurs fournisseurs répondent en ligne, vous comparez article par article, puis vous générez un ou plusieurs bons de commande. Une consultation se lance depuis une demande d'achat validée." />
      <div className="cm-outils">
        <input className="cm-recherche" type="search" placeholder="Rechercher un n° de consultation ou de demande…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher" />
        <select className="cm-select" value={statut} onChange={(e) => setStatut(e.target.value)} aria-label="Statut">
          <option value="">Tous les statuts</option>
          {Object.entries(STATUTS_CONSULTATION).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <span className="cm-compteur">{donnees ? `${liste.length} consultation${liste.length > 1 ? 's' : ''}` : ''}</span>
      </div>
      {erreur && <div className="cm-erreur">{erreur}</div>}
      <div className="cm-table-wrap">
        <table className="cm-table">
          <thead><tr><th>Consultation</th><th>Demande</th><th>Magasin</th><th>Date limite</th><th className="cm-num">Offres reçues</th><th>Statut</th></tr></thead>
          <tbody>
            {!donnees ? <tr><td colSpan={6} className="cm-vide">Chargement…</td></tr>
              : liste.length === 0 ? <tr><td colSpan={6} className="cm-vide"><strong>Aucune consultation</strong>Ouvrez une demande d'achat validée puis « Lancer une demande de proforma ».</td></tr>
                : liste.map((c) => (
                  <tr key={c.id}>
                    <td><Link to={`/commercial/consultations/${c.id}`} className="cm-code">{c.numero}</Link><span className="cm-sous">créée par {c.cree_par_nom}</span></td>
                    <td><Link to={`/commercial/demandes/${c.demande_id}`}>{c.demande_numero}</Link></td>
                    <td>{c.magasin_code} — {c.magasin_nom}</td>
                    <td>{dateFr(c.date_limite)}{c.expiree && c.statut === 'lancee' && <span className="cm-sous" style={{ color: '#b45309' }}>Dépassée</span>}</td>
                    <td className="cm-num">{c.nb_offres} / {c.nb_fournisseurs}</td>
                    <td><StatutConsultation statut={c.statut} /></td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Préparation (nouvelle ou brouillon) ───────────────────────────────────
export function ConsultationFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useApp();
  const [demande, setDemande] = useState(null);
  const [fournisseurs, setFournisseurs] = useState(null);
  const [f, setF] = useState(null);
  const [lignes, setLignes] = useState([]);
  const [choisis, setChoisis] = useState([]);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState('');
  const [numero, setNumero] = useState('');

  useEffect(() => {
    (async () => {
      let c = null; let demandeId = params.get('demande');
      if (id) {
        c = await api.get(`/commercial/consultations/${id}`);
        if (c?.error) { setErreur(c.error); return; }
        if (!c.droits.modifier) { navigate(`/commercial/consultations/${id}`, { replace: true }); return; }
        demandeId = c.demande_id; setNumero(c.numero);
      }
      if (!demandeId) { setErreur('Choisissez d\'abord une demande d\'achat validée.'); return; }
      const [d, fo] = await Promise.all([api.get(`/commercial/demandes/${demandeId}`), api.get('/commercial/tiers?type=fournisseur&actifs=1')]);
      if (d?.error) { setErreur(d.error); return; }
      setDemande(d);
      setFournisseurs(Array.isArray(fo) ? fo : []);
      const dejaLigne = new Map((c?.lignes || []).map((l) => [l.demande_ligne_id, l.quantite]));
      setLignes(d.lignes.map((l) => {
        const reste = Math.max(0, Math.round((l.suivi.approuvee - l.suivi.commandee - l.suivi.en_preparation) * 1000) / 1000);
        return { demande_ligne_id: l.id, designation: l.designation, reference: l.reference, unite: l.unite, reste,
          inclus: c ? dejaLigne.has(l.id) : reste > 0, quantite: virgule(c ? (dejaLigne.get(l.id) ?? reste) : reste) };
      }).filter((l) => l.reste > 0 || l.inclus));
      if (c) {
        setChoisis(c.fournisseurs.map((x) => x.fournisseur_id));
        setF({ date_limite: c.date_limite, delai_souhaite: c.delai_souhaite, validite_offre_jours: String(c.validite_offre_jours), conditions_reponse: c.conditions_reponse,
          observations: c.observations, derogation_motif: c.derogation_motif });
      } else {
        // Fournisseurs proposés à la validation : cochés d'office (modifiable).
        setChoisis([...new Set(d.lignes.map((l) => l.fournisseur_id).filter(Boolean))]);
        setF({ date_limite: dansJours(7), delai_souhaite: '', validite_offre_jours: '30', observations: '', derogation_motif: '',
          conditions_reponse: 'Prix unitaires hors taxes, dans l\'unité indiquée, livraison au magasin indiqué. Joindre la facture proforma signée.' });
      }
    })();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const habituels = useMemo(() => new Set((demande?.lignes || []).flatMap((l) => [...(l.fournisseurs_proposes || []).map((x) => x.id), l.fournisseur_id].filter(Boolean))), [demande]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const majLigne = (i, k, v) => setLignes((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const corps = () => ({ ...f, demande_id: demande.id, fournisseur_ids: choisis,
    lignes: lignes.filter((l) => l.inclus).map((l) => ({ demande_ligne_id: l.demande_ligne_id, quantite: l.quantite })) });

  const enregistrer = async (lancer) => {
    const sel = lignes.filter((l) => l.inclus);
    if (!sel.length) { setErreur('Gardez au moins un article à consulter.'); return; }
    const trop = sel.find((l) => { const q = nombreSaisi(l.quantite); return !(q > 0) || q > l.reste + 1e-9; });
    if (trop) { setErreur(`« ${trop.designation} » : quantité entre 0 et ${fmtQte(trop.reste)} ${trop.unite} (reste à commander).`); return; }
    if (lancer && choisis.length < MINIMUM && (f.derogation_motif || '').trim().length < 10) {
      setErreur(`Moins de ${MINIMUM} fournisseurs : justifiez la dérogation (10 caractères au moins) ou ajoutez des fournisseurs.`); return;
    }
    setEnCours(lancer ? 'lancer' : 'brouillon'); setErreur('');
    const r = id ? await api.put(`/commercial/consultations/${id}`, corps()) : await api.post('/commercial/consultations', corps());
    if (r?.error) { setEnCours(''); setErreur(r.error); return; }
    if (lancer) {
      const l = await api.post(`/commercial/consultations/${r.id}/lancement`, { envoyer_emails: true });
      setEnCours('');
      if (l?.error) { setErreur(l.error); if (!id) navigate(`/commercial/consultations/${r.id}/modifier`, { replace: true }); return; }
      const ok = (l.envois || []).filter((e) => e.statut === 'envoye').length;
      toast(`Consultation ${l.numero} lancée${ok ? ` : ${ok} demande${ok > 1 ? 's' : ''} envoyée${ok > 1 ? 's' : ''} par e-mail` : ''}. Transmettez les autres liens vous-même.`, 'success');
    } else { setEnCours(''); toast(`Brouillon ${r.numero} enregistré.`, 'success'); }
    navigate(`/commercial/consultations/${r.id}`);
  };

  if (!demande || !f || !fournisseurs) return <div className="cm-page">{erreur ? <><Link to="/commercial/consultations" className="cm-retour">‹ Consultations</Link><div className="cm-erreur">{erreur}</div></> : <div className="loading-msg">Chargement…</div>}</div>;
  const peutDeroger = can('com.consultations.derogation');
  const options = [...fournisseurs].sort((a, b) => Number(habituels.has(b.id)) - Number(habituels.has(a.id)) || a.nom.localeCompare(b.nom))
    .map((x) => ({ id: x.id, libelle: x.nom, detail: [habituels.has(x.id) ? 'fournisseur habituel de ces articles' : '', delaiTexte(x.delai_livraison_jours, x.delai_type) !== '—' ? `livre en ${delaiTexte(x.delai_livraison_jours, x.delai_type)}` : '', x.email || x.contact_email || 'pas d\'e-mail'].filter(Boolean).join(' · ') }));
  return (
    <div className="cm-page">
      <Link to={id ? `/commercial/consultations/${id}` : `/commercial/demandes/${demande.id}`} className="cm-retour">‹ {id ? numero : `Demande ${demande.numero}`}</Link>
      <div className="cm-fiche-tete">
        <div>
          <h2>{id ? `Modifier la consultation ${numero}` : 'Nouvelle demande de proforma'}</h2>
          <span className="cm-sous">Demande {demande.numero} · {demande.magasin_code} — {demande.magasin_nom}</span>
        </div>
        <div className="cm-actions">
          <button type="button" className="cm-btn cm-secondaire" onClick={() => enregistrer(false)} disabled={Boolean(enCours)}>Enregistrer le brouillon</button>
          <button type="button" className="cm-btn cm-primaire" onClick={() => enregistrer(true)} disabled={Boolean(enCours)}>{enCours === 'lancer' ? 'Lancement…' : 'Lancer la consultation'}</button>
        </div>
      </div>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      <Section titre="Articles à consulter">
        <div className="cm-table-defile">
        <table className="cm-lignes">
          <thead><tr><th /><th>Article</th><th style={{ textAlign: 'right' }}>Reste à commander</th><th style={{ textAlign: 'right' }}>Quantité demandée aux fournisseurs</th></tr></thead>
          <tbody>
            {lignes.map((l, i) => (
              <tr key={l.demande_ligne_id} className={l.inclus ? '' : 'cm-ligne-off'}>
                <td className="cm-l-case"><input type="checkbox" checked={l.inclus} onChange={(e) => majLigne(i, 'inclus', e.target.checked)} aria-label={`Consulter pour ${l.designation}`} /></td>
                <td className="cm-l-article"><strong>{l.designation}</strong><span className="cm-sous">{l.reference}</span></td>
                <td className="cm-num"><span className="cm-l-lib">Reste</span>{fmtQte(l.reste)} {l.unite}</td>
                <td style={{ textAlign: 'right' }}><span className="cm-l-lib">Quantité</span>
                  <input className="cm-qte-input" inputMode="decimal" value={l.quantite} disabled={!l.inclus} onChange={(e) => majLigne(i, 'quantite', e.target.value)} aria-label={`Quantité pour ${l.designation}`} />
                  <span className="cm-sous" style={{ textAlign: 'right' }}>{l.unite}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Section>
      <Section titre={`Fournisseurs consultés (${choisis.length})`}>
        <p className="cm-aide" style={{ marginBottom: 8 }}>
          Au moins {MINIMUM} fournisseurs pour une consultation comparative. Chacun reçoit une demande individuelle et un lien personnel : il ne voit jamais les offres des autres.
        </p>
        <Cases label="Fournisseurs à consulter" options={options} valeurs={choisis} onChange={setChoisis} vide="Aucun fournisseur actif : créez-les dans Configuration → Fournisseurs." />
        {choisis.length > 0 && choisis.length < MINIMUM && (
          <div style={{ marginTop: 12 }}>
            {peutDeroger ? (
              <Champ label={`Dérogation : pourquoi moins de ${MINIMUM} fournisseurs ?`} requis id="cdg" aide="Ex. fournisseur unique sur ce produit, marché captif. Le motif est tracé.">
                <textarea id="cdg" value={f.derogation_motif} onChange={set('derogation_motif')} maxLength={1000} />
              </Champ>
            ) : <div className="cm-note" style={{ background: '#fffbeb', color: '#92400e' }}>Vous n'avez pas le droit de déroger au minimum de {MINIMUM} fournisseurs : ajoutez-en, ou faites lancer la consultation par une personne habilitée.</div>}
          </div>
        )}
      </Section>
      <Section titre="Conditions de la demande">
        <div className="cm-grille">
          <Champ label="Date limite de réponse" requis id="cdl"><input id="cdl" type="date" min={aujourdhui()} value={f.date_limite} onChange={set('date_limite')} /></Champ>
          <Champ label="Délai de livraison souhaité" id="cds"><input id="cds" value={f.delai_souhaite} onChange={set('delai_souhaite')} maxLength={200} placeholder="Ex. sous 10 jours" /></Champ>
          <Champ label="Validité minimale de l'offre (jours)" id="cdv"><input id="cdv" inputMode="numeric" value={f.validite_offre_jours} onChange={(e) => setF((x) => ({ ...x, validite_offre_jours: e.target.value.replace(/[^0-9]/g, '').slice(0, 3) }))} /></Champ>
          <div />
          <Champ label="Conditions de réponse (imprimées sur la demande)" id="cdc" pleine><textarea id="cdc" value={f.conditions_reponse} onChange={set('conditions_reponse')} maxLength={2000} /></Champ>
          <Champ label="Observations internes" id="cdo" pleine><textarea id="cdo" value={f.observations} onChange={set('observations')} maxLength={2000} /></Champ>
        </div>
      </Section>
    </div>
  );
}

// ── Fiche ─────────────────────────────────────────────────────────────────
export function ConsultationPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [c, setC] = useState(null);
  const [erreur, setErreur] = useState('');
  const [tiers, setTiers] = useState([]);
  const [ajout, setAjout] = useState('');
  const [enCours, setEnCours] = useState('');
  const charger = async () => {
    const r = await api.get(`/commercial/consultations/${id}`);
    if (r?.error) { setErreur(r.error); return; }
    setC(r); setErreur('');
  };
  useEffect(() => { charger(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (c?.droits?.envoyer && !tiers.length) api.get('/commercial/tiers?type=fournisseur&actifs=1').then((r) => setTiers(Array.isArray(r) ? r : []));
  }, [c]); // eslint-disable-line react-hooks/exhaustive-deps

  const agir = async (cle, url, corps, message) => {
    setEnCours(cle); setErreur('');
    const r = await api.post(url, corps);
    setEnCours('');
    if (r?.error) { setErreur(r.error); return null; }
    if (message) toast(message, 'success');
    if (r?.id) setC(r);
    return r;
  };
  const lancer = async () => {
    const r = await agir('lancer', `/commercial/consultations/${id}/lancement`, { envoyer_emails: true });
    if (!r) return;
    const ok = (r.envois || []).filter((e) => e.statut === 'envoye').length;
    toast(`Consultation lancée${ok ? ` : ${ok} e-mail${ok > 1 ? 's' : ''} envoyé${ok > 1 ? 's' : ''}` : ''}. Transmettez les autres liens vous-même puis constatez l'envoi.`, 'success');
  };
  const envoyerEmail = (f) => agir(`mail-${f.id}`, `/commercial/consultations/${id}/fournisseurs/${f.id}/envoi`, { mode: 'email', destinataire: f.email }, `Demande envoyée à ${f.fournisseur_nom}.`);
  const constater = (f) => {
    const dest = window.prompt(`Comment le lien a-t-il été transmis à ${f.fournisseur_nom} ?\n(ex. « WhatsApp au 699 00 00 00 », « remis en main propre »)`) || '';
    if (dest.trim().length < 2) return;
    agir(`manuel-${f.id}`, `/commercial/consultations/${id}/fournisseurs/${f.id}/envoi`, { mode: 'manuel', destinataire: dest.trim() }, 'Envoi constaté.');
  };
  const rouvrir = (f) => {
    const motif = window.prompt(`Rouvrir l'offre de ${f.fournisseur_nom} ? Il pourra soumettre une nouvelle version ; l'actuelle reste conservée.\n\nMotif :`) || '';
    if (motif.trim().length < 5) return;
    agir(`rouvrir-${f.id}`, `/commercial/consultations/${id}/fournisseurs/${f.id}/reouverture`, { motif }, 'Offre rouverte : le fournisseur peut répondre de nouveau avec le même lien.');
  };
  const annuler = () => {
    const motif = window.prompt(`Annuler la consultation ${c.numero} ? Les liens des fournisseurs ne permettront plus de répondre.\n\nMotif :`) || '';
    if (motif.trim().length < 3) return;
    agir('annuler', `/commercial/consultations/${id}/annulation`, { motif }, 'Consultation annulée.');
  };
  const ajouter = async () => {
    if (!ajout) return;
    const r = await agir('ajout', `/commercial/consultations/${id}/fournisseurs`, { fournisseur_id: Number(ajout) }, 'Fournisseur ajouté : envoyez-lui sa demande.');
    if (r) setAjout('');
  };
  const copierLien = async (f) => { toast(await copier(f.lien) ? 'Lien copié.' : 'Copie impossible : sélectionnez le lien à la main.', 'success'); };
  const pdf = (f) => ouvrirFichier(api, `/commercial/consultations/${id}/fournisseurs/${f.id}/pdf`, `Demande-proforma-${c.numero}.pdf`, 'application/pdf', toast);

  if (!c) return <div className="cm-page">{erreur ? <><Link to="/commercial/consultations" className="cm-retour">‹ Consultations</Link><div className="cm-erreur">{erreur}</div></> : <div className="loading-msg">Chargement…</div>}</div>;
  const libres = tiers.filter((t) => !c.fournisseurs.some((f) => f.fournisseur_id === t.id));
  return (
    <div className="cm-page">
      <Link to="/commercial/consultations" className="cm-retour">‹ Consultations</Link>
      <div className="cm-fiche-tete">
        <div>
          <h2><span className="cm-code" style={{ fontSize: 15 }}>{c.numero}</span> Demande de proforma <StatutConsultation statut={c.statut} /></h2>
          <span className="cm-sous">Demande <Link to={`/commercial/demandes/${c.demande_id}`}>{c.demande_numero}</Link> · {c.magasin_code} — {c.magasin_nom} · créée le {dateFr(c.cree_le, true)} par {c.cree_par_nom}</span>
        </div>
        <div className="cm-actions">
          {c.droits.annuler && <button type="button" className="cm-btn cm-danger" onClick={annuler} disabled={Boolean(enCours)}>Annuler</button>}
          {c.droits.modifier && <button type="button" className="cm-btn cm-secondaire" onClick={() => navigate(`/commercial/consultations/${id}/modifier`)}>Modifier</button>}
          {['lancee', 'attribuee'].includes(c.statut) && <button type="button" className="cm-btn cm-secondaire" onClick={() => navigate(`/commercial/consultations/${id}/comparatif`)}>{c.statut === 'attribuee' ? 'Voir la comparaison' : 'Comparer les offres'}</button>}
          {c.droits.lancer && <button type="button" className="cm-btn cm-primaire" onClick={lancer} disabled={Boolean(enCours)}>{enCours === 'lancer' ? 'Lancement…' : 'Lancer la consultation'}</button>}
        </div>
      </div>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      {c.statut === 'lancee' && c.expiree && <div className="cm-note">Date limite dépassée : les fournisseurs ne peuvent plus répondre. Comparez les offres reçues et attribuez.</div>}
      {c.statut === 'lancee' && !c.expiree && c.nb_offres > 0 && <div className="cm-note">{c.nb_offres} offre{c.nb_offres > 1 ? 's' : ''} reçue{c.nb_offres > 1 ? 's' : ''} sur {c.nb_fournisseurs}. Vous pouvez comparer dès maintenant ; le choix final vous appartient.</div>}
      {c.derogation_motif && c.fournisseurs.length < c.minimum && <div className="cm-note" style={{ background: '#fffbeb', color: '#92400e' }}><strong>Dérogation</strong> — moins de {c.minimum} fournisseurs : {c.derogation_motif}</div>}

      <Section titre={`Fournisseurs consultés (${c.fournisseurs.length})`}>
        <div className="cm-table-defile">
        <table className="cm-lignes cm-consultes">
          <thead><tr><th>Fournisseur</th><th>Statut</th><th>Envoi</th><th>Lien de réponse</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {c.fournisseurs.map((f) => (
              <tr key={f.id}>
                <td className="cm-l-article"><strong>{f.fournisseur_nom}</strong>
                  <span className="cm-sous">{f.email || 'pas d\'e-mail'}{f.delai_habituel !== null && f.delai_habituel !== undefined ? ` · livre habituellement en ${delaiTexte(f.delai_habituel, f.delai_habituel_type)}` : ''}</span></td>
                <td><StatutFournisseurConsulte statut={f.statut} />{f.nb_versions > 1 && <span className="cm-sous">{f.nb_versions} versions</span>}
                  {f.reouverte && <span className="cm-sous">Rouverte : {f.motif_reouverture}</span>}{f.motif_refus && <span className="cm-sous">« {f.motif_refus} »</span>}</td>
                <td>{f.envoye_le ? <><span>{f.envoi_mode === 'email' ? 'E-mail' : 'Constaté'}</span><span className="cm-sous">{f.envoi_destinataire} · {dateFr(f.envoye_le, true)}</span></> : <span className="cm-sous" style={{ marginTop: 0 }}>—</span>}
                  {f.consulte_le && <span className="cm-sous">Ouvert le {dateFr(f.consulte_le, true)}</span>}
                  {f.reponse_le && <span className="cm-sous">Réponse le {dateFr(f.reponse_le, true)}</span>}</td>
                <td>{f.lien ? <button type="button" className="cm-lien" onClick={() => copierLien(f)} title={f.lien}>Copier le lien</button> : <span className="cm-sous" style={{ marginTop: 0 }}>Créé au lancement</span>}</td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <button type="button" className="cm-lien" onClick={() => pdf(f)}>PDF</button>
                  {c.droits.envoyer && ['a_envoyer', 'envoyee', 'consultee'].includes(f.statut) && <>
                    {f.email && <button type="button" className="cm-lien" style={{ marginLeft: 10 }} onClick={() => envoyerEmail(f)} disabled={Boolean(enCours)}>{f.envoye_le ? 'Renvoyer' : 'Envoyer'} par e-mail</button>}
                    <button type="button" className="cm-lien" style={{ marginLeft: 10 }} onClick={() => constater(f)} disabled={Boolean(enCours)}>Constater l'envoi</button>
                  </>}
                  {c.droits.envoyer && ['offre_recue', 'refusee'].includes(f.statut) && !f.reouverte && <button type="button" className="cm-lien" style={{ marginLeft: 10 }} onClick={() => rouvrir(f)} disabled={Boolean(enCours)}>Rouvrir</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {c.droits.envoyer && (
          <div className="cm-applique-tout" style={{ marginTop: 12 }}>
            <select value={ajout} onChange={(e) => setAjout(e.target.value)} aria-label="Fournisseur à ajouter">
              <option value="">Ajouter un fournisseur…</option>
              {libres.map((t) => <option key={t.id} value={t.id}>{t.nom}</option>)}
            </select>
            <button type="button" className="cm-btn cm-secondaire" style={{ height: 34 }} onClick={ajouter} disabled={!ajout || Boolean(enCours)}>Ajouter</button>
          </div>
        )}
        <p className="cm-aide" style={{ marginTop: 8 }}>
          Chaque lien est personnel : le fournisseur y voit la demande, répond article par article et joint sa facture proforma, sans compte NJ BUSINESS.
          Sans e-mail, copiez le lien (WhatsApp, SMS…) puis « Constater l'envoi ».
        </p>
      </Section>

      <div className="cm-deux">
        <div>
          <Section titre={`Articles (${c.lignes.length})`}>
            <table className="cm-lignes">
              <thead><tr><th>Article</th><th style={{ textAlign: 'right' }}>Quantité demandée</th></tr></thead>
              <tbody>{c.lignes.map((l) => <tr key={l.id}><td className="cm-l-article"><strong>{l.designation}</strong><span className="cm-sous">{l.reference}</span></td><td className="cm-num">{fmtQte(l.quantite)} {l.unite}</td></tr>)}</tbody>
            </table>
          </Section>
          <Section titre="Conditions">
            <dl className="cm-infos">
              <div><dt>Date limite de réponse</dt><dd>{dateFr(c.date_limite)}</dd></div>
              <div><dt>Délai souhaité</dt><dd>{c.delai_souhaite || '—'}</dd></div>
              <div><dt>Validité minimale de l'offre</dt><dd>{c.validite_offre_jours} jours</dd></div>
              <div><dt>Lancée</dt><dd>{c.lancee_le ? `${dateFr(c.lancee_le, true)} par ${c.lancee_par_nom}` : '—'}</dd></div>
            </dl>
            {c.conditions_reponse && <p className="cm-aide" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}><strong>Conditions de réponse :</strong> {c.conditions_reponse}</p>}
            {c.motif_annulation && <p className="cm-aide" style={{ marginTop: 8 }}><strong>Annulée :</strong> {c.motif_annulation}</p>}
          </Section>
        </div>
        <div>
          {c.bons.length > 0 && (
            <Section titre={`Bons de commande générés (${c.bons.length})`}>
              <ul className="cm-pieces">
                {c.bons.map((b) => <li key={b.id}><span className="cm-nom"><Link to={`/commercial/bons/${b.id}`}>{b.statut === 'brouillon' ? 'Brouillon' : b.numero_complet}</Link>
                  <span className="cm-sous">{b.fournisseur_nom} · {fmtMontant(b.total_ttc)} TTC</span></span><StatutBon statut={b.statut} /></li>)}
              </ul>
            </Section>
          )}
          <Section titre="Historique">
            <ol className="cm-fil">
              {c.historique.map((h, i) => (
                <li key={i}><strong>{ACTIONS[h.action] || h.action}</strong>
                  <span className="cm-quand">{dateFr(h.le, true)} · {h.par_nom || (h.action === 'COM_CONSULTATION_OFFRE_RECUE' ? `fournisseur (${h.nouvelle_valeur?.signataire || 'portail'})` : 'système')}</span>
                  {(h.nouvelle_valeur?.fournisseur || h.nouvelle_valeur?.motif) && <div className="cm-mot">{[h.nouvelle_valeur.fournisseur, h.nouvelle_valeur.version ? `version ${h.nouvelle_valeur.version}` : '', h.nouvelle_valeur.motif].filter(Boolean).join(' · ')}</div>}
                </li>
              ))}
            </ol>
            <p className="cm-aide">Cet historique ne peut être ni modifié ni effacé.</p>
          </Section>
        </div>
      </div>
    </div>
  );
}

// ── Comparaison et attribution ────────────────────────────────────────────
export function ComparatifPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [cmp, setCmp] = useState(null);
  const [choix, setChoix] = useState({});   // ligne → { offre_ligne_id, motif }
  const [generer, setGenerer] = useState(true);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  useEffect(() => {
    api.get(`/commercial/consultations/${id}/comparatif`).then((r) => {
      if (r?.error) { setErreur(r.error); return; }
      setCmp(r);
      setChoix(Object.fromEntries(r.lignes.map((l) => [l.id, { offre_ligne_id: l.choix_offre_ligne_id || '', motif: l.choix_motif || '' }])));
    });
  }, [id]);
  if (!cmp) return <div className="cm-page">{erreur ? <><Link to={`/commercial/consultations/${id}`} className="cm-retour">‹ Consultation</Link><div className="cm-erreur">{erreur}</div></> : <div className="loading-msg">Chargement…</div>}</div>;
  const c = cmp.consultation;
  const lecture = !c.droits.attribuer;
  const choisir = (lid, offre) => setChoix((x) => ({ ...x, [lid]: { ...x[lid], offre_ligne_id: offre } }));
  // Raccourcis : ils PRÉ-REMPLISSENT les choix ; rien n'est enregistré sans validation.
  const appliquer = (critere, fournisseurId = null) => setChoix((x) => {
    const n = { ...x };
    for (const l of cmp.lignes) {
      const ok = l.propositions.filter((p) => p.utilisable);
      let p = null;
      if (critere === 'prix') p = ok.find((y) => y.meilleur_prix);
      else if (critere === 'delai') p = ok.filter((y) => y.meilleur_delai).sort((a, b) => a.prix_unitaire - b.prix_unitaire)[0];
      else if (critere === 'fournisseur') p = ok.find((y) => y.fournisseur_id === fournisseurId);
      n[l.id] = { ...n[l.id], offre_ligne_id: p ? p.offre_ligne_id : '' };
    }
    return n;
  });
  const prop = (l) => l.propositions.find((p) => String(p.offre_ligne_id) === String(choix[l.id]?.offre_ligne_id));
  const total = cmp.lignes.reduce((t, l) => { const p = prop(l); return p ? { ht: t.ht + p.montant_ht, ttc: t.ttc + p.montant_ttc } : t; }, { ht: 0, ttc: 0 });
  const fournisseursRetenus = new Set(cmp.lignes.map(prop).filter(Boolean).map((p) => p.fournisseur_id));
  const valider = async () => {
    const manque = cmp.lignes.find((l) => { const p = prop(l); return p && p.prix_unitaire > l.meilleur_prix + 1e-9 && (choix[l.id]?.motif || '').trim().length < 5; });
    if (manque) { setErreur(`« ${manque.designation} » : le fournisseur choisi n'est pas le moins-disant ; justifiez ce choix (délai, conditions, qualité…).`); return; }
    if (!fournisseursRetenus.size) { setErreur('Retenez un fournisseur pour au moins un article.'); return; }
    if (!window.confirm(`Attribuer ces articles à ${fournisseursRetenus.size} fournisseur${fournisseursRetenus.size > 1 ? 's' : ''}${generer ? ` et préparer ${fournisseursRetenus.size} bon${fournisseursRetenus.size > 1 ? 's' : ''} de commande` : ''} ? La consultation sera close.`)) return;
    setEnCours(true); setErreur('');
    const r = await api.post(`/commercial/consultations/${id}/attribution`, { generer_bons: generer && c.droits.generer_bons,
      lignes: cmp.lignes.map((l) => ({ consultation_ligne_id: l.id, offre_ligne_id: choix[l.id]?.offre_ligne_id || null, motif: choix[l.id]?.motif || '' })) });
    setEnCours(false);
    if (r?.error) { setErreur(r.error); return; }
    toast(r.bons_crees?.length ? `${r.bons_crees.length} bon${r.bons_crees.length > 1 ? 's' : ''} de commande préparé${r.bons_crees.length > 1 ? 's' : ''} (brouillons à vérifier puis émettre).` : 'Attribution enregistrée.', 'success');
    navigate(`/commercial/consultations/${id}`);
  };
  return (
    <div className="cm-page">
      <Link to={`/commercial/consultations/${id}`} className="cm-retour">‹ {c.numero}</Link>
      <div className="cm-fiche-tete">
        <div>
          <h2>Comparaison des offres <StatutConsultation statut={c.statut} /></h2>
          <span className="cm-sous">{cmp.offres.length} offre{cmp.offres.length > 1 ? 's' : ''} reçue{cmp.offres.length > 1 ? 's' : ''} sur {c.fournisseurs.length} fournisseur{c.fournisseurs.length > 1 ? 's' : ''} consulté{c.fournisseurs.length > 1 ? 's' : ''} · demande {c.demande_numero}</span>
        </div>
        {!lecture && <div className="cm-actions"><button type="button" className="cm-btn cm-primaire" onClick={valider} disabled={enCours}>{enCours ? 'Attribution…' : 'Valider l\'attribution'}</button></div>}
      </div>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      <Section titre="Synthèse par fournisseur">
        {cmp.offres.length === 0 ? <p className="cm-aide">Aucune offre reçue pour l'instant.</p> : (
          <div className="cm-table-defile">
          <table className="cm-lignes">
            <thead><tr><th>Fournisseur</th><th style={{ textAlign: 'right' }}>Articles proposés</th><th style={{ textAlign: 'right' }}>Total HT</th><th style={{ textAlign: 'right' }}>Taxes</th><th style={{ textAlign: 'right' }}>Total TTC</th><th>Délai</th><th>Paiement</th><th>Validité</th><th /></tr></thead>
            <tbody>
              {cmp.offres.map((o) => (
                <tr key={o.id}>
                  <td className="cm-l-article"><strong>{o.fournisseur_nom}</strong><span className="cm-sous">Version {o.version} · reçue le {dateFr(o.soumise_le, true)} · {o.signataire}</span></td>
                  <td className="cm-num"><span className="cm-l-lib">Articles</span>{o.nb_lignes} / {cmp.lignes.length}</td>
                  <td className="cm-num"><span className="cm-l-lib">HT</span>{fmtMontant(o.total_ht, '')}</td>
                  <td className="cm-num"><span className="cm-l-lib">Taxes</span>{fmtMontant(o.total_taxes, '')}</td>
                  <td className="cm-num"><span className="cm-l-lib">TTC</span><strong>{fmtMontant(o.total_ttc, '')}</strong></td>
                  <td><span className="cm-l-lib">Délai</span>{delaiTexte(o.delai_livraison_jours, o.delai_type)}</td>
                  <td><span className="cm-l-lib">Paiement</span>{o.conditions_paiement || '—'}</td>
                  <td><span className="cm-l-lib">Validité</span>{o.validite_jours ? `${o.validite_jours} j` : '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{o.document_id && <button type="button" className="cm-lien" onClick={() => ouvrirFichier(api, `/commercial/consultations/${id}/offres/${o.id}/proforma`, `proforma-${o.fournisseur_nom}.pdf`, 'application/pdf', toast)}>Proforma</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        <p className="cm-aide" style={{ marginTop: 8 }}>Les totaux d'une offre ne couvrent que les articles qu'elle propose : comparez article par article ci-dessous.</p>
      </Section>
      {!lecture && cmp.offres.length > 0 && (
        <div className="cm-applique-tout">
          <strong>Pré-remplir les choix :</strong>
          <button type="button" className="cm-btn cm-secondaire" style={{ height: 34 }} onClick={() => appliquer('prix')}>Le moins cher par article</button>
          <button type="button" className="cm-btn cm-secondaire" style={{ height: 34 }} onClick={() => appliquer('delai')}>Le meilleur délai par article</button>
          <select defaultValue="" onChange={(e) => { if (e.target.value) appliquer('fournisseur', Number(e.target.value)); e.target.value = ''; }} aria-label="Tout chez un fournisseur">
            <option value="">Tout chez un fournisseur…</option>
            {cmp.offres.map((o) => <option key={o.fournisseur_id} value={o.fournisseur_id}>{o.fournisseur_nom}</option>)}
          </select>
          <span className="cm-aide">Rien n'est retenu d'office : vérifiez chaque article avant de valider.</span>
        </div>
      )}
      {cmp.lignes.map((l) => {
        const p = prop(l);
        const horsMoinsDisant = p && l.meilleur_prix !== null && p.prix_unitaire > l.meilleur_prix + 1e-9;
        return (
          <Section key={l.id} titre={`${l.designation} — ${fmtQte(l.quantite)} ${l.unite}`}>
            {l.propositions.length === 0 ? <p className="cm-aide">Aucune offre pour cet article.</p> : (
              <div className="cm-table-defile">
              <table className="cm-lignes cm-comparatif">
                <thead><tr>{!lecture && <th aria-label="Choix" />}<th>Fournisseur</th><th>Disponibilité</th><th style={{ textAlign: 'right' }}>Prix unitaire HT</th><th style={{ textAlign: 'right' }}>Total HT</th><th style={{ textAlign: 'right' }}>Taxe</th><th style={{ textAlign: 'right' }}>Total TTC</th><th>Délai</th><th>Paiement</th></tr></thead>
                <tbody>
                  {l.propositions.map((x) => {
                    const retenu = String(choix[l.id]?.offre_ligne_id) === String(x.offre_ligne_id);
                    return (
                      <tr key={x.offre_ligne_id} className={(retenu ? 'cm-retenu ' : '') + (x.utilisable ? '' : 'cm-ligne-off')}>
                        {!lecture && <td className="cm-l-case"><input type="radio" name={`l-${l.id}`} checked={retenu} disabled={!x.utilisable} onChange={() => choisir(l.id, x.offre_ligne_id)} aria-label={`Retenir ${x.fournisseur_nom}`} /></td>}
                        <td className="cm-l-article"><strong>{x.fournisseur_nom}</strong>{lecture && retenu && <span className="cm-pastille cm-ok" style={{ marginLeft: 6 }}>Retenu</span>}{x.observation && <span className="cm-sous">{x.observation}</span>}</td>
                        <td><span className="cm-l-lib">Disponibilité</span>{x.disponibilite_libelle}{x.disponibilite === 'partielle' && <span className="cm-sous">{fmtQte(x.quantite_proposee)} {l.unite}</span>}</td>
                        <td className="cm-num"><span className="cm-l-lib">Prix HT</span>{x.prix_unitaire === null ? '—' : <strong>{fmtMontant(x.prix_unitaire, '')}</strong>}{x.meilleur_prix && <span className="cm-badge cm-badge-prix">Meilleur prix</span>}</td>
                        <td className="cm-num"><span className="cm-l-lib">Total HT</span>{x.utilisable ? fmtMontant(x.montant_ht, '') : '—'}</td>
                        <td className="cm-num"><span className="cm-l-lib">Taxe</span>{x.utilisable ? `${fmtQte(x.taux_taxe)} %` : '—'}</td>
                        <td className="cm-num"><span className="cm-l-lib">TTC</span>{x.utilisable ? fmtMontant(x.montant_ttc, '') : '—'}</td>
                        <td><span className="cm-l-lib">Délai</span>{delaiTexte(x.delai_livraison_jours, x.delai_type)}{x.meilleur_delai && <span className="cm-badge cm-badge-delai">Meilleur délai</span>}</td>
                        <td><span className="cm-l-lib">Paiement</span>{x.conditions_paiement || '—'}</td>
                      </tr>
                    );
                  })}
                  {!lecture && (
                    <tr className={choix[l.id]?.offre_ligne_id ? '' : 'cm-retenu'}>
                      <td className="cm-l-case"><input type="radio" name={`l-${l.id}`} checked={!choix[l.id]?.offre_ligne_id} onChange={() => choisir(l.id, '')} aria-label="Ne pas retenir cet article" /></td>
                      <td colSpan={8} className="cm-sous" style={{ marginTop: 0 }}>Ne pas retenir cet article pour l'instant</td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
            )}
            {!lecture && p && (
              <Champ label={horsMoinsDisant ? 'Justification du choix (obligatoire : ce n\'est pas le moins-disant)' : 'Justification du choix (facultative)'} requis={horsMoinsDisant} id={`m-${l.id}`}>
                <input id={`m-${l.id}`} value={choix[l.id]?.motif || ''} onChange={(e) => setChoix((x) => ({ ...x, [l.id]: { ...x[l.id], motif: e.target.value } }))} maxLength={500}
                  placeholder={horsMoinsDisant ? 'Ex. meilleur délai, conditions de paiement, qualité constatée' : ''} />
              </Champ>
            )}
            {lecture && l.choix_motif && <p className="cm-aide" style={{ marginTop: 8 }}><strong>Motif du choix :</strong> {l.choix_motif}</p>}
          </Section>
        );
      })}
      {!lecture && (
        <Section titre="Attribution">
          <dl className="cm-infos">
            <div><dt>Fournisseurs retenus</dt><dd>{fournisseursRetenus.size}</dd></div>
            <div><dt>Montant retenu HT</dt><dd>{fmtMontant(Math.round(total.ht * 100) / 100)}</dd></div>
            <div><dt>Montant retenu TTC</dt><dd>{fmtMontant(Math.round(total.ttc * 100) / 100)}</dd></div>
          </dl>
          {c.droits.generer_bons ? (
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, fontSize: 13.5 }}>
              <input type="checkbox" checked={generer} onChange={(e) => setGenerer(e.target.checked)} />
              Préparer un bon de commande par fournisseur retenu ({fournisseursRetenus.size}), lié à la demande d'origine
            </label>
          ) : <p className="cm-aide" style={{ marginTop: 10 }}>Les bons de commande seront préparés par une personne habilitée, depuis la demande.</p>}
          <p className="cm-aide" style={{ marginTop: 8 }}>Les bons sont créés en brouillon, aux prix des offres retenues : vérifiez-les puis émettez-les. Le reliquat non commandé reste visible sur la demande.</p>
        </Section>
      )}
    </div>
  );
}
