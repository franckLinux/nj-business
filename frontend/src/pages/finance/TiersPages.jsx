// NJ FINANCE — Clients et fournisseurs (lot F4, migration 078).
// Liste, fiche (relevé de compte, mouvements de caisse, conditions), états des
// créances clients et des dettes fournisseurs. Tout est calculé à partir des
// écritures (comptes 40 et 41 portant le tiers) et du journal de caisse.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { Champ, Tiroir, useDiffere } from '@/components/commercial/ui';
import { exporterExcel } from '@/lib/export';
import { Erreur, fmtCompta, fmtDate } from '@/pages/comptabilite/commun';

const TYPES = { client: 'Client', fournisseur: 'Fournisseur', mixte: 'Client et fournisseur' };
const MODES = { '': '—', especes: 'Espèces', cheque: 'Chèque', virement: 'Virement', mobile_money: 'Mobile money', carte: 'Carte', compensation: 'Compensation' };
const estClient = (t) => t === 'client' || t === 'mixte';
const estFournisseur = (t) => t === 'fournisseur' || t === 'mixte';

function Kpi({ libelle, valeur, aide, ton = '' }) {
  return <div className={`fin-kpi ${ton}`}><span>{libelle}</span><b>{valeur}</b>{aide && <small>{aide}</small>}</div>;
}
function BadgeType({ type }) {
  return <span className={`fin-type fin-type-${type}`}>{TYPES[type] || type}</span>;
}

// ── Formulaire (création / modification) ────────────────────────────────────
const vide = { type: 'client', nom: '', nui: '', rccm: '', telephone: '', email: '', adresse: '', compte_tiers: '', delai_paiement_jours: 30, mode_reglement: '', observations: '' };

function FormulaireTiers({ initial, onFermer, onEnregistre }) {
  const toast = useToast();
  const [f, setF] = useState({ ...vide, ...initial });
  const [erreur, setErreur] = useState('');
  const [doublon, setDoublon] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const enregistrer = async (confirmer = false) => {
    setErreur(''); setEnCours(true);
    const corps = { ...f, delai_paiement_jours: Number(f.delai_paiement_jours), ...(confirmer ? { confirmer_doublon: true } : {}) };
    const r = f.id ? await api.put(`/finance/tiers/${f.id}`, corps) : await api.post('/finance/tiers', corps);
    setEnCours(false);
    if (r?.error) { setErreur(r.error); setDoublon(r.doublon || null); return; }
    toast(f.id ? 'Fiche enregistrée.' : `${TYPES[r.type]} ${r.nom} créé.`, 'success');
    onEnregistre(r);
  };
  return (
    <Tiroir titre={f.id ? `Modifier — ${initial.nom}` : 'Nouveau client ou fournisseur'} sousTitre="Fiche unique, partagée avec le registre des tiers et NJ COMMERCIAL" onFermer={onFermer}
      pied={<>
        <button type="button" className="cm-btn cm-secondaire" onClick={onFermer}>Annuler</button>
        {doublon && <button type="button" className="cm-btn cm-secondaire" disabled={enCours} onClick={() => enregistrer(true)}>C'est un autre tiers : créer</button>}
        <button type="button" className="cm-btn cm-primaire" disabled={enCours} onClick={() => enregistrer(false)}>Enregistrer</button>
      </>}>
      <Erreur message={erreur} />
      {doublon && <div className="fin-bandeau">Fiche existante : <Link to={`/finance/tiers/${doublon.id}`} onClick={onFermer}>{doublon.nom}</Link></div>}
      <h4 className="fin-sous-titre">Identité</h4>
      <div className="cm-grille">
        <Champ label="Nature" requis id="t-type">
          <select id="t-type" value={f.type} onChange={set('type')}>
            <option value="client">Client</option><option value="fournisseur">Fournisseur</option><option value="mixte">Client et fournisseur</option>
          </select>
        </Champ>
        <Champ label="Code / compte individuel" id="t-compte" aide="Ex. 411ALPHA ou 401SNEC (facultatif)">
          <input id="t-compte" value={f.compte_tiers} maxLength={17} onChange={(e) => setF((x) => ({ ...x, compte_tiers: e.target.value.toUpperCase() }))} />
        </Champ>
        <Champ label="Nom ou raison sociale" requis pleine id="t-nom"><input id="t-nom" value={f.nom} maxLength={200} onChange={set('nom')} /></Champ>
        <Champ label="NIU (identifiant fiscal)" id="t-nui"><input id="t-nui" value={f.nui} maxLength={30} onChange={(e) => setF((x) => ({ ...x, nui: e.target.value.toUpperCase() }))} /></Champ>
        <Champ label="RCCM" id="t-rccm"><input id="t-rccm" value={f.rccm} maxLength={60} onChange={set('rccm')} /></Champ>
        <Champ label="Téléphone" id="t-tel"><input id="t-tel" value={f.telephone} maxLength={40} onChange={set('telephone')} /></Champ>
        <Champ label="E-mail" id="t-mail"><input id="t-mail" type="email" value={f.email} maxLength={120} onChange={set('email')} /></Champ>
        <Champ label="Adresse" pleine id="t-adr"><input id="t-adr" value={f.adresse} maxLength={300} onChange={set('adresse')} /></Champ>
      </div>
      <h4 className="fin-sous-titre">Conditions financières</h4>
      <div className="cm-grille">
        <Champ label="Délai de paiement (jours)" id="t-delai"><input id="t-delai" type="number" min={0} max={365} value={f.delai_paiement_jours} onChange={set('delai_paiement_jours')} /></Champ>
        <Champ label="Mode de règlement habituel" id="t-mode">
          <select id="t-mode" value={f.mode_reglement} onChange={set('mode_reglement')}>{Object.entries(MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Champ>
        <Champ label="Observations" pleine id="t-obs"><textarea id="t-obs" rows={3} maxLength={2000} value={f.observations} onChange={set('observations')} /></Champ>
      </div>
    </Tiroir>
  );
}

// ── Liste ───────────────────────────────────────────────────────────────────
// `sens` (menu réorganisé le 25/11/2026) : la liste s'ouvre dans Configuration →
// Clients ou → Fournisseurs, sans les onglets ; sans `sens`, liste complète.
export function TiersListePage({ sens = null }) {
  const { can } = useApp();
  const navigate = useNavigate();
  const [onglet, setOnglet] = useState(sens || 'client');
  const [recherche, setRecherche] = useState('');
  const [brouillard, setBrouillard] = useState(false);
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState('');
  const [form, setForm] = useState(null);
  const rech = useDiffere(recherche, 300);
  const charger = useCallback(async () => {
    const q = new URLSearchParams({ sens: onglet === 'tous' ? '' : onglet, recherche: rech, brouillard: String(brouillard) });
    const r = await api.get(`/finance/tiers?${q}`);
    if (r?.error) { setErreur(r.error); return; }
    setErreur(''); setD(r);
  }, [onglet, rech, brouillard]);
  useEffect(() => { charger(); }, [charger]);
  const gere = can('finance.tiers.gerer');
  const exporter = () => exporterExcel(`Tiers_${onglet}`, ['Code', 'Nom', 'Nature', 'NIU', 'Téléphone', 'Créance', 'Dette', 'Délai (j)', 'Dernier mouvement'],
    d.tiers.map((t) => [t.compte_tiers, t.nom, t.type_libelle, t.nui, t.telephone, +t.creance, +t.dette, t.delai_paiement_jours, t.dernier_mouvement || '']));
  return (
    <div className="cm-page fin-page">
      <div className="cm-entete">
        <div>
          <h2>{sens === 'client' ? 'Clients' : sens === 'fournisseur' ? 'Fournisseurs' : 'Clients et fournisseurs'}</h2>
          <p>Fiche unique par tiers, partagée avec le registre des bénéficiaires et NJ COMMERCIAL. Les soldes viennent des écritures validées des comptes 40, 41 et 481.
            {sens === 'client' && ' Un tiers à la fois client et fournisseur apparaît dans les deux listes.'}</p>
        </div>
        <div className="cm-actions">
          <button type="button" className="cm-btn cm-secondaire" disabled={!d?.tiers?.length} onClick={exporter}>Exporter</button>
          {gere && <button type="button" className="cm-btn cm-primaire" onClick={() => setForm({ ...vide, type: onglet === 'fournisseur' ? 'fournisseur' : 'client' })}>+ Nouveau</button>}
        </div>
      </div>
      {d && (
        <div className="fin-kpis">
          {sens !== 'fournisseur' && <Kpi libelle="Clients" valeur={d.totaux.clients.toLocaleString('fr-FR')} />}
          {sens !== 'fournisseur' && <Kpi libelle="Créances clients" valeur={fmtCompta(d.totaux.creances, { zero: '0' })} ton={Number(d.totaux.creances) > 0 ? 'alerte' : ''} aide={<Link to="/finance/creances">Voir l'état</Link>} />}
          {sens !== 'client' && <Kpi libelle="Fournisseurs" valeur={d.totaux.fournisseurs.toLocaleString('fr-FR')} />}
          {sens !== 'client' && <Kpi libelle="Dettes fournisseurs" valeur={fmtCompta(d.totaux.dettes, { zero: '0' })} ton={Number(d.totaux.dettes) > 0 ? 'alerte' : ''} aide={<Link to="/finance/dettes">Voir l'état</Link>} />}
        </div>
      )}
      {!sens && (
        <div className="fin-onglets" role="tablist">
          {[['client', 'Clients'], ['fournisseur', 'Fournisseurs'], ['tous', 'Tous']].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={onglet === k} className={onglet === k ? 'actif' : ''} onClick={() => setOnglet(k)}>{l}</button>
          ))}
        </div>
      )}
      <div className="fin-filtres">
        <input type="search" className="fin-recherche" placeholder="Nom, NIU, code, téléphone…" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
        <label className="fin-case"><input type="checkbox" checked={brouillard} onChange={(e) => setBrouillard(e.target.checked)} /> Inclure le brouillard</label>
      </div>
      <Erreur message={erreur} />
      {d && (d.tiers.length === 0 ? (
        <div className="fin-vide"><div className="fin-vide-icone" aria-hidden="true">👥</div><h3>Aucun tiers</h3>
          <p>{gere ? 'Créez une fiche avec « Nouveau ». Les bénéficiaires saisis en caisse apparaissent aussi ici.' : 'Aucun tiers ne correspond.'}</p></div>
      ) : (
        <div className="cm-table-wrap">
          <table className="cm-table fin-table">
            <thead><tr><th>Code</th><th>Nom</th><th>Nature</th><th>Téléphone</th>
              {onglet !== 'fournisseur' && <th className="fin-num">Créance</th>}{onglet !== 'client' && <th className="fin-num">Dette</th>}
              <th className="fin-num">Délai</th><th>Dernier mouvement</th></tr></thead>
            <tbody>
              {d.tiers.map((t) => (
                <tr key={t.id} className="cm-cliquable" tabIndex={0} onClick={() => navigate(`/finance/tiers/${t.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/finance/tiers/${t.id}`); }}>
                  <td className="fin-mono">{t.compte_tiers || <span className="cm-sous">—</span>}</td>
                  <td><b>{t.nom}</b>{t.nui && <div className="cm-sous">NIU {t.nui}{!t.nui_format_ok && ' ⚠'}</div>}</td>
                  <td><BadgeType type={t.type} /></td>
                  <td>{t.telephone || '—'}</td>
                  {onglet !== 'fournisseur' && <td className="fin-num fin-fort">{estClient(t.type) ? fmtCompta(t.creance, { zero: '0' }) : '—'}</td>}
                  {onglet !== 'client' && <td className="fin-num fin-fort">{estFournisseur(t.type) ? fmtCompta(t.dette, { zero: '0' }) : '—'}</td>}
                  <td className="fin-num">{t.delai_paiement_jours} j</td>
                  <td>{fmtDate(t.dernier_mouvement)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {form && <FormulaireTiers initial={form} onFermer={() => setForm(null)} onEnregistre={(t) => { setForm(null); navigate(`/finance/tiers/${t.id}`); }} />}
    </div>
  );
}

// ── Fiche ───────────────────────────────────────────────────────────────────
export function TiersFichePage() {
  const { id } = useParams();
  const { can } = useApp();
  const [t, setT] = useState(null);
  const [erreur, setErreur] = useState('');
  const [onglet, setOnglet] = useState('releve');
  const [brouillard, setBrouillard] = useState(false);
  const [form, setForm] = useState(null);
  const charger = useCallback(async () => {
    const r = await api.get(`/finance/tiers/${id}?brouillard=${brouillard}`);
    if (r?.error) { setErreur(r.error); return; }
    setErreur(''); setT(r);
  }, [id, brouillard]);
  useEffect(() => { charger(); }, [charger]);
  if (erreur) return <div className="cm-page"><Link to="/config" state={{ onglet: 'clients' }} className="fin-lien">‹ Configuration</Link><Erreur message={erreur} /></div>;
  if (!t) return <div className="loading-msg">Chargement…</div>;
  return (
    <div className="cm-page fin-page">
      <Link to="/config" state={{ onglet: estClient(t.type) ? 'clients' : 'fournisseurs' }} className="fin-lien">‹ Configuration — {estClient(t.type) ? 'Clients' : 'Fournisseurs'}</Link>
      <div className="fin-fiche-tete">
        <div className="fin-avatar" aria-hidden="true">{t.nom.slice(0, 2).toUpperCase()}</div>
        <div className="fin-fiche-id">
          <h2>{t.nom} {!t.actif && <span className="fin-badge fin-badge-brouillard">Inactif</span>}</h2>
          <div className="fin-fiche-meta">
            <BadgeType type={t.type} />
            {t.compte_tiers && <span className="fin-mono">{t.compte_tiers}</span>}
            {t.nui && <span>NIU {t.nui}{t.verifie ? ' · vérifié sur pièce ✓' : ''}</span>}
            {t.telephone && <span>☎ {t.telephone}</span>}
            {t.email && <span>✉ {t.email}</span>}
          </div>
        </div>
        {can('finance.tiers.gerer') && <button type="button" className="cm-btn cm-secondaire" onClick={() => setForm(t)}>Modifier la fiche</button>}
      </div>
      <div className="fin-kpis">
        {estClient(t.type) && <Kpi libelle="Solde client (créance)" valeur={fmtCompta(t.creance, { zero: '0' })} ton={Number(t.creance) > 0 ? 'alerte' : 'ok'}
          aide={`Facturé ${fmtCompta(t.total_facture_client, { zero: '0' })} · réglé ${fmtCompta(t.total_regle_client, { zero: '0' })}`} />}
        {estFournisseur(t.type) && <Kpi libelle="Solde fournisseur (dette)" valeur={fmtCompta(t.dette, { zero: '0' })} ton={Number(t.dette) > 0 ? 'alerte' : 'ok'}
          aide={`Achats ${fmtCompta(t.total_achats, { zero: '0' })} · payé ${fmtCompta(t.total_paye_fournisseur, { zero: '0' })}`} />}
        <Kpi libelle="Caisse : payé au tiers" valeur={fmtCompta(t.caisse_paye, { zero: '0' })} aide={`${t.caisse_nb} mouvement(s) de caisse`} />
        <Kpi libelle="Caisse : encaissé du tiers" valeur={fmtCompta(t.caisse_encaisse, { zero: '0' })} />
        <Kpi libelle="Conditions" valeur={`${t.delai_paiement_jours} j`} aide={t.mode_reglement_libelle !== '—' ? t.mode_reglement_libelle : 'Mode de règlement non précisé'} />
      </div>
      {t.nb_ecritures_brouillard > 0 && !brouillard && (
        <div className="fin-bandeau">{t.nb_ecritures_brouillard} écriture(s) au brouillard sur ce tiers ne sont pas comptées.
          <button type="button" className="fin-lien" onClick={() => setBrouillard(true)}>Les inclure</button></div>
      )}
      <div className="fin-onglets" role="tablist">
        {[['releve', 'Relevé de compte'], ['caisse', 'Mouvements de caisse'], ['fiche', 'Fiche']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={onglet === k} className={onglet === k ? 'actif' : ''} onClick={() => setOnglet(k)}>{l}</button>
        ))}
      </div>
      {onglet === 'releve' && <Releve id={id} brouillard={brouillard} setBrouillard={setBrouillard} nom={t.nom} />}
      {onglet === 'caisse' && <CaisseTiers id={id} />}
      {onglet === 'fiche' && <DetailFiche t={t} />}
      {form && <FormulaireTiers initial={form} onFermer={() => setForm(null)} onEnregistre={() => { setForm(null); charger(); }} />}
    </div>
  );
}

function Releve({ id, brouillard, setBrouillard, nom }) {
  const [f, setF] = useState({ date_du: '', date_au: '' });
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState('');
  useEffect(() => {
    (async () => {
      const q = new URLSearchParams({ brouillard: String(brouillard), ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) });
      const r = await api.get(`/finance/tiers/${id}/releve?${q}`);
      if (r?.error) { setErreur(r.error); return; }
      setErreur(''); setD(r);
    })();
  }, [id, brouillard, f]);
  const libSolde = d?.sens === 'dette' ? 'Nous devons' : 'Le tiers doit';
  const exporter = () => exporterExcel(`Releve_${nom}`, ['Date', 'Journal', 'N°', 'Pièce', 'Libellé', 'Compte', 'Échéance', 'Débit', 'Crédit', 'Solde'],
    [['', '', '', '', 'Report', '', '', '', '', +d.report], ...d.lignes.map((l) => [l.date, l.journal_code, l.numero_affiche || 'brouillard', l.reference_piece, l.libelle, l.compte, l.echeance || '', +l.debit, +l.credit, +l.solde])],
    [`Relevé de compte — ${nom}`, `${d.date_du ? `Du ${fmtDate(d.date_du)} ` : ''}${d.date_au ? `au ${fmtDate(d.date_au)}` : ''}`]);
  return (
    <section>
      <div className="fin-filtres">
        <input type="date" aria-label="Du" value={f.date_du} onChange={(e) => setF({ ...f, date_du: e.target.value })} />
        <input type="date" aria-label="Au" value={f.date_au} onChange={(e) => setF({ ...f, date_au: e.target.value })} />
        <label className="fin-case"><input type="checkbox" checked={brouillard} onChange={(e) => setBrouillard(e.target.checked)} /> Inclure le brouillard</label>
        <button type="button" className="cm-btn cm-secondaire" style={{ marginLeft: 'auto' }} disabled={!d?.lignes?.length} onClick={exporter}>Exporter le relevé</button>
      </div>
      <Erreur message={erreur} />
      {d && (d.lignes.length === 0 && Number(d.report) === 0 ? (
        <div className="fin-vide"><div className="fin-vide-icone" aria-hidden="true">📄</div><h3>Aucune écriture sur ce tiers</h3>
          <p>Le relevé se remplit avec les écritures des comptes 40 et 41 qui portent ce tiers (factures, règlements, opérations diverses).</p></div>
      ) : (
        <div className="cm-table-wrap">
          <table className="cm-table fin-table">
            <thead><tr><th>Date</th><th>Journal</th><th>N°</th><th>Pièce</th><th>Libellé</th><th>Échéance</th><th className="fin-num">Débit</th><th className="fin-num">Crédit</th><th className="fin-num">{libSolde}</th></tr></thead>
            <tbody>
              {(d.date_du || Number(d.report) !== 0) && (
                <tr className="fin-report"><td colSpan={8}>Report{d.date_du ? ` au ${fmtDate(d.date_du)}` : ''}</td><td className="fin-num">{fmtCompta(d.report, { zero: '0' })}</td></tr>
              )}
              {d.lignes.map((l, i) => (
                <tr key={i} className={l.statut === 'brouillard' ? 'fin-ligne-brouillard' : ''}>
                  <td>{fmtDate(l.date)}</td><td><span className="cm-code">{l.journal_code}</span></td>
                  <td className="fin-mono">{l.numero_affiche || 'brouillard'}</td><td>{l.reference_piece || '—'}</td>
                  <td className="fin-libelle">{l.libelle}</td><td>{l.echeance ? fmtDate(l.echeance) : '—'}</td>
                  <td className="fin-num">{fmtCompta(l.debit)}</td><td className="fin-num">{fmtCompta(l.credit)}</td><td className="fin-num fin-fort">{fmtCompta(l.solde, { zero: '0' })}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={6}>Totaux et solde</td><td className="fin-num">{fmtCompta(d.total_debit, { zero: '0' })}</td><td className="fin-num">{fmtCompta(d.total_credit, { zero: '0' })}</td><td className="fin-num">{fmtCompta(d.solde, { zero: '0' })}</td></tr></tfoot>
          </table>
        </div>
      ))}
    </section>
  );
}

function CaisseTiers({ id }) {
  const [l, setL] = useState(null);
  const [erreur, setErreur] = useState('');
  useEffect(() => { (async () => { const r = await api.get(`/finance/tiers/${id}/caisse`); if (r?.error) setErreur(r.error); else setL(r); })(); }, [id]);
  const tot = useMemo(() => (l || []).reduce((a, m) => ({ e: a.e + Number(m.entree), s: a.s + Number(m.sortie) }), { e: 0, s: 0 }), [l]);
  if (erreur) return <Erreur message={erreur} />;
  if (!l) return <div className="loading-msg">Chargement…</div>;
  if (!l.length) return <div className="fin-vide"><div className="fin-vide-icone" aria-hidden="true">💵</div><h3>Aucun mouvement de caisse</h3><p>Les paiements et encaissements saisis en caisse avec ce bénéficiaire apparaîtront ici.</p></div>;
  return (
    <div className="cm-table-wrap">
      <table className="cm-table fin-table">
        <thead><tr><th>Date</th><th>Pièce</th><th>Rubrique</th><th>Libellé</th><th>Activité</th><th className="fin-num">Encaissé</th><th className="fin-num">Payé</th></tr></thead>
        <tbody>
          {l.map((m) => (
            <tr key={m.id} className={m.annule || m.contre_passation ? 'fin-ligne-brouillard' : ''}>
              <td>{fmtDate(m.date)}</td><td className="fin-mono">{m.journal_code}-{m.numero}</td><td>{m.rubrique || m.rubrique_code}</td>
              <td className="fin-libelle">{m.intitule}{m.annule && <span className="fin-origine">annulé</span>}{m.contre_passation && <span className="fin-origine">contre-passation</span>}</td>
              <td>{m.activite || '—'}</td><td className="fin-num">{fmtCompta(m.entree)}</td><td className="fin-num">{fmtCompta(m.sortie)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={5}>Totaux</td><td className="fin-num">{fmtCompta(tot.e, { zero: '0' })}</td><td className="fin-num">{fmtCompta(tot.s, { zero: '0' })}</td></tr></tfoot>
      </table>
    </div>
  );
}

function DetailFiche({ t }) {
  const L = ({ k, v }) => <div className="fin-def"><span>{k}</span><b>{v || '—'}</b></div>;
  return (
    <div className="fin-fiche-grille">
      <section className="fin-carte"><h3>Identité</h3>
        <L k="Nature" v={t.type_libelle} /><L k="Code / compte individuel" v={t.compte_tiers} /><L k="Compte collectif" v={t.compte_collectif} />
        <L k="NIU" v={t.nui ? `${t.nui}${t.nui_format_ok ? '' : ' (format inhabituel)'}` : ''} /><L k="RCCM" v={t.rccm} />
        <L k="Vérification sur pièce" v={t.verifie ? 'Vérifié (contrôle comptable)' : 'Non vérifié'} />
      </section>
      <section className="fin-carte"><h3>Coordonnées</h3>
        <L k="Téléphone" v={t.telephone} /><L k="E-mail" v={t.email} /><L k="Adresse" v={t.adresse} />
        {(t.ville || t.pays) && <L k="Ville / pays (NJ COMMERCIAL)" v={[t.ville, t.pays].filter(Boolean).join(', ')} />}
        {t.contact_nom && <L k="Contact (NJ COMMERCIAL)" v={[t.contact_nom, t.contact_telephone, t.contact_email].filter(Boolean).join(' · ')} />}
      </section>
      <section className="fin-carte"><h3>Conditions financières</h3>
        <L k="Délai de paiement" v={`${t.delai_paiement_jours} jours`} /><L k="Mode de règlement habituel" v={t.mode_reglement_libelle} />
        {t.conditions_paiement && <L k="Conditions (NJ COMMERCIAL)" v={t.conditions_paiement} />}
        <L k="Observations" v={t.observations} />
      </section>
    </div>
  );
}

// ── États : créances clients / dettes fournisseurs ──────────────────────────
export function EtatTiersPage({ sens }) {
  const navigate = useNavigate();
  const [f, setF] = useState({ date_au: '', brouillard: false });
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState('');
  const url = sens === 'client' ? '/finance/creances' : '/finance/dettes';
  useEffect(() => {
    (async () => {
      const q = new URLSearchParams({ brouillard: String(f.brouillard), ...(f.date_au ? { date_au: f.date_au } : {}) });
      const r = await api.get(`${url}?${q}`);
      if (r?.error) { setErreur(r.error); return; }
      setErreur(''); setD(r);
    })();
  }, [url, f]);
  const titre = sens === 'client' ? 'Créances clients' : 'Dettes fournisseurs';
  const exporter = () => exporterExcel(titre.replace(' ', '_'), ['Tiers', 'Code', 'NIU', 'Délai (j)', 'Débit', 'Crédit', 'Solde', 'Dernier mouvement'],
    d.lignes.map((l) => [l.nom, l.compte_tiers, l.nui, l.delai_paiement_jours, +l.debit, +l.credit, +l.solde, l.dernier || '']), [`${titre} au ${fmtDate(d.date_au)}`]);
  return (
    <div className="cm-page fin-page">
      <div className="cm-entete">
        <div>
          <h2>{titre}</h2>
          <p>{sens === 'client' ? 'Ce que chaque client doit à l\'entité, d\'après les écritures des comptes 41.' : 'Ce que l\'entité doit à chaque fournisseur, d\'après les écritures des comptes 40.'} Solde à la date choisie.</p>
        </div>
        <div className="cm-actions"><button type="button" className="cm-btn cm-secondaire" disabled={!d?.lignes?.length} onClick={exporter}>Exporter</button></div>
      </div>
      <div className="fin-filtres">
        <label className="fin-case">Au <input type="date" value={f.date_au} onChange={(e) => setF({ ...f, date_au: e.target.value })} /></label>
        <label className="fin-case"><input type="checkbox" checked={f.brouillard} onChange={(e) => setF({ ...f, brouillard: e.target.checked })} /> Inclure le brouillard</label>
      </div>
      <Erreur message={erreur} />
      {d && <>
        <div className="fin-kpis">
          <Kpi libelle={`Total au ${fmtDate(d.date_au)}`} valeur={fmtCompta(d.total, { zero: '0' })} ton={Number(d.total) > 0 ? 'alerte' : 'ok'} aide={`${d.lignes.filter((l) => Number(l.solde) > 0).length} tiers concerné(s)`} />
          {Number(d.avances) > 0 && <Kpi libelle={sens === 'client' ? 'Avances reçues des clients' : 'Avances versées aux fournisseurs'} valeur={fmtCompta(d.avances)} aide="Soldes inversés" />}
          {!d.inclut_brouillard && d.nb_brouillard > 0 && <Kpi libelle="Écritures au brouillard" valeur={d.nb_brouillard.toLocaleString('fr-FR')} aide="Non prises en compte" />}
        </div>
        {d.lignes.length === 0 ? (
          <div className="fin-vide"><div className="fin-vide-icone" aria-hidden="true">✓</div><h3>Rien à signaler</h3><p>Aucune écriture {sens === 'client' ? 'client' : 'fournisseur'} à cette date.</p></div>
        ) : (
          <div className="cm-table-wrap">
            <table className="cm-table fin-table">
              <thead><tr><th>Tiers</th><th>Code</th><th className="fin-num">Délai</th><th className="fin-num">Débit</th><th className="fin-num">Crédit</th><th className="fin-num">Solde</th><th>Dernier mouvement</th></tr></thead>
              <tbody>
                {d.lignes.map((l) => (
                  <tr key={l.id} className="cm-cliquable" tabIndex={0} onClick={() => navigate(`/finance/tiers/${l.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/finance/tiers/${l.id}`); }}>
                    <td><b>{l.nom}</b>{l.nui && <div className="cm-sous">NIU {l.nui}</div>}</td><td className="fin-mono">{l.compte_tiers || '—'}</td>
                    <td className="fin-num">{l.delai_paiement_jours} j</td><td className="fin-num">{fmtCompta(l.debit)}</td><td className="fin-num">{fmtCompta(l.credit)}</td>
                    <td className="fin-num fin-fort">{fmtCompta(l.solde, { zero: '0' })}</td><td>{fmtDate(l.dernier)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={5}>Total</td><td className="fin-num">{fmtCompta(d.total, { zero: '0' })}</td><td /></tr></tfoot>
            </table>
          </div>
        )}
      </>}
    </div>
  );
}
