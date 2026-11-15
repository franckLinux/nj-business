import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { fmt } from '@/lib/format';
import { exporterExcel, num, STYLE_BOUTON_EXPORT } from '@/lib/export';

// Contrôle comptable → « Écarts de caisse » (migration 061, 09/11/2026).
//
// 1. Constat : le comptable confronte le solde théorique d'un journal au solde
//    compté (arrêté de caisse, inventaire validé ou comptage). Une écriture
//    ECP (excédent) / ECN (manquant) est passée au journal.
// 2. Affectation : où est allé l'écart (caissier, tiers, charge, attente /
//    produit, restitution, attente), avec le compte de destination et le
//    reclassement comptable à passer (471 → destination).
// 3. Régularisation : recouvrement, restitution, issue de l'investigation.
// Annulation : contre-passation de l'écriture, motif obligatoire.

const MOIS = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
const STATUTS = {
  constate: { lib: 'À affecter', bg: '#fef3c7', fg: '#92400e' },
  affecte: { lib: 'À suivre', bg: '#dbeafe', fg: '#1d4ed8' },
  solde: { lib: 'Soldé', bg: '#dcfce7', fg: '#166534' },
  annule: { lib: 'Annulé', bg: '#f1f5f9', fg: '#64748b' },
};
const ORIGINES = { arret: '🔒 Arrêté', inventaire: '📦 Inventaire', comptage: '🧮 Comptage' };
const MODES_REGUL = ['Remboursement en espèces', 'Retenue sur salaire', 'Restitution au tiers', 'Virement / mobile money', 'Erreur identifiée et corrigée', 'Autre'];
const dateFr = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const dateHeure = (d) => (d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const aujourdhui = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const lireMontant = (v) => {
  const t = String(v ?? '').replace(/[\s  ]/g, '').replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

const CSS = `
.ec-tete{display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap;margin-bottom:16px}
.ec-tete h2{font-size:20px;font-weight:800;margin:0;color:var(--text)}
.ec-tete p{margin:3px 0 0;font-size:13px;color:var(--text-muted);max-width:640px}
.ec-actions{margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.ec-sel{padding:8px 10px;border:1.5px solid var(--border);border-radius:9px;font-size:13px;background:#fff}
.ec-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:14px}
.ec-kpi{background:#fff;border:1px solid var(--border);border-top:3px solid;border-radius:12px;padding:12px 14px;text-align:left;cursor:pointer;min-width:0;transition:box-shadow .15s,transform .15s}
.ec-kpi:hover{box-shadow:0 4px 14px rgba(15,23,42,.08);transform:translateY(-1px)}
.ec-kpi.on{box-shadow:0 0 0 2px #2563eb inset}
.ec-kpi-t{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted)}
.ec-kpi-v{font-size:22px;font-weight:800;line-height:1.2;margin-top:4px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ec-kpi-s{font-size:11.5px;color:var(--text-muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ec-grille{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:14px;margin-bottom:14px}
.ec-carte{background:#fff;border:1px solid var(--border);border-radius:14px;overflow:hidden;box-shadow:0 1px 8px rgba(0,0,0,.04)}
.ec-carte-t{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border);font-size:13px;font-weight:800;color:var(--text)}
.ec-carte-t small{font-weight:500;color:var(--text-muted);font-size:11.5px}
.ec-detecte{display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid #fef3c7}
.ec-detecte:last-child{border-bottom:0}
.ec-dest{display:grid;gap:10px;padding:14px 16px}
.ec-dest-l{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:8px;align-items:center;font-size:12.5px}
.ec-barre{height:6px;border-radius:3px;background:#f1f5f9;overflow:hidden;margin-top:4px}
.ec-barre i{display:block;height:100%;border-radius:3px}
.ec-filtres{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:10px 16px;border-bottom:1px solid var(--border);background:#fafafa}
.ec-puce{border:1px solid var(--border);background:#fff;border-radius:999px;padding:4px 11px;font-size:12px;font-weight:600;color:#475569;cursor:pointer}
.ec-puce.on{background:#1e293b;border-color:#1e293b;color:#fff}
.ec-table{width:100%;border-collapse:collapse;font-size:13px}
.ec-table th{padding:9px 12px;text-align:left;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--text-muted);border-bottom:1px solid var(--border);background:#fff;white-space:nowrap}
.ec-table td{padding:10px 12px;border-bottom:1px solid #f1f5f9;vertical-align:top}
.ec-table tr.cl{cursor:pointer}
.ec-table tr.cl:hover td{background:#f8fafc}
.ec-table .n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.ec-sens{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:800;white-space:nowrap}
.ec-sens.manquant{background:#fef2f2;color:#b91c1c}
.ec-sens.excedent{background:#ecfdf5;color:#047857}
.ec-mono{font-family:'JetBrains Mono',ui-monospace,monospace}
.ec-muted{color:var(--text-muted)}
.ec-lbl{display:block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.45px;color:var(--text-muted);margin-bottom:5px}
.ec-in{width:100%;padding:9px 11px;border:1.5px solid var(--border);border-radius:9px;font-size:13px;color:var(--text);background:#fff}
.ec-in:focus{outline:none;border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.14)}
.ec-in:disabled{background:#f1f5f9;color:var(--text-muted)}
.ec-2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
.ec-ecart{display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:12px;border:1px solid}
.ec-ecart.manquant{background:linear-gradient(135deg,#fff1f2,#fee2e2);border-color:#fecaca}
.ec-ecart.excedent{background:linear-gradient(135deg,#ecfdf5,#d1fae5);border-color:#a7f3d0}
.ec-ecart.nul{background:#f8fafc;border-color:var(--border)}
.ec-ecart-v{font-size:24px;font-weight:900;font-variant-numeric:tabular-nums}
.ec-choix{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.ec-option{display:flex;gap:10px;align-items:flex-start;text-align:left;padding:12px;border:1.5px solid var(--border);border-radius:12px;background:#fff;cursor:pointer;transition:border-color .15s,box-shadow .15s}
.ec-option:hover{border-color:#94a3b8}
.ec-option.on{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.12);background:#f8fbff}
.ec-option b{display:block;font-size:13px;color:var(--text)}
.ec-option span.d{display:block;font-size:11.5px;color:var(--text-muted);margin-top:2px;line-height:1.4}
.ec-option .cpt{display:inline-block;margin-top:6px;font-size:10.5px;font-weight:800;color:#475569;background:#f1f5f9;border-radius:5px;padding:1px 6px}
.ec-od{width:100%;border-collapse:collapse;font-size:12.5px;border:1px solid var(--border);border-radius:10px;overflow:hidden}
.ec-od th,.ec-od td{padding:7px 10px;border-bottom:1px solid #f1f5f9;text-align:left}
.ec-od th{background:#f8fafc;font-size:10.5px;text-transform:uppercase;letter-spacing:.4px;color:var(--text-muted)}
.ec-etapes{display:flex;align-items:center;gap:0;margin:2px 0 4px}
.ec-etape{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:#94a3b8}
.ec-etape i{width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-style:normal;font-size:11px;background:#e2e8f0;color:#64748b}
.ec-etape.fait{color:#166534}.ec-etape.fait i{background:#16a34a;color:#fff}
.ec-etape.cours{color:#1d4ed8}.ec-etape.cours i{background:#2563eb;color:#fff}
.ec-trait{flex:1;height:2px;background:#e2e8f0;margin:0 8px;min-width:18px}
.ec-trait.fait{background:#16a34a}
.ec-kv{display:grid;grid-template-columns:150px minmax(0,1fr);gap:6px 12px;font-size:13px}
.ec-kv span{color:var(--text-muted)}
@media (max-width:1100px){.ec-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}.ec-grille{grid-template-columns:1fr}}
@media (max-width:640px){.ec-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.ec-2,.ec-choix{grid-template-columns:1fr}.ec-kv{grid-template-columns:1fr}.ec-actions{margin-left:0;width:100%}}
`;

function Montant({ v, devise, signe = false, fort = false }) {
  if (v === null || v === undefined || Number.isNaN(v)) return <span className="ec-muted">—</span>;
  const c = signe ? (v < 0 ? '#b91c1c' : v > 0 ? '#047857' : '#475569') : undefined;
  return (
    <span style={{ color: c, fontWeight: fort || signe ? 800 : 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
      {v < 0 ? '− ' : signe && v > 0 ? '+ ' : ''}{fmt(Math.abs(v), devise)}
    </span>
  );
}
function Sens({ sens }) {
  return <span className={`ec-sens ${sens}`}>{sens === 'manquant' ? '▼ Manquant' : '▲ Excédent'}</span>;
}
function Statut({ s }) {
  const st = STATUTS[s] || STATUTS.constate;
  return <span className="rpc-statut" style={{ background: st.bg, color: st.fg }}>{st.lib}</span>;
}
function Modale({ titre, couleur, largeur = 620, onFermer, enCours, pied, children }) {
  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget && !enCours) onFermer(); }}>
      <div className="modal-box" style={{ maxWidth: largeur }} role="dialog" aria-label={titre}>
        <div className="modal-head" style={couleur ? { background: couleur } : undefined}>
          <h3 style={couleur ? { color: 'white' } : undefined}>{titre}</h3>
          <button type="button" className="modal-close" style={couleur ? { color: 'white', opacity: 0.85 } : undefined} onClick={onFermer} disabled={enCours}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'grid', gap: 14 }}>{children}</div>
        <div className="modal-foot">{pied}</div>
      </div>
    </div>
  );
}

// ══ Constat ═════════════════════════════════════════════════════════════════
function ModaleConstat({ source, journaux, devise, onFermer, onCree }) {
  const toast = useToast();
  // source : null (comptage libre) ou un écart détecté { origine, origine_id, journal_id, … }
  const [journalId, setJournalId] = useState(source?.journal_id || journaux[0]?.id || '');
  const [dateConstat, setDateConstat] = useState(aujourdhui());
  const [dateEcriture, setDateEcriture] = useState('');
  const [compte, setCompte] = useState('');
  const [cause, setCause] = useState(source?.cause || '');
  const [theo, setTheo] = useState(source ? source.solde_theorique : null);
  const [chargement, setChargement] = useState(false);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (source || !journalId || !dateConstat) return undefined;
    let annule = false;
    setChargement(true);
    api.get(`/controle/ecarts/solde-theorique?journal_id=${journalId}&date=${dateConstat}`).then((r) => {
      if (annule) return;
      setChargement(false);
      if (r.error) { setTheo(null); toast(r.error, 'error', 6000); return; }
      setTheo(r.solde_theorique);
    });
    return () => { annule = true; };
  }, [source, journalId, dateConstat, toast]);

  const constate = source ? source.solde_constate : lireMontant(compte);
  const ecart = theo === null || constate === null || Number.isNaN(constate) ? null : Math.round((constate - theo) * 100) / 100;
  const sens = ecart === null || Math.abs(ecart) < 0.005 ? null : ecart > 0 ? 'excedent' : 'manquant';
  const journal = journaux.find((j) => String(j.id) === String(journalId));
  const valide = sens && cause.trim().length >= 5 && !enCours;

  const envoyer = async () => {
    setEnCours(true);
    const r = await api.post('/controle/ecarts', {
      origine: source?.origine || 'comptage', origine_id: source?.origine_id,
      journal_id: journalId, date_constat: dateConstat, date_ecriture: dateEcriture || undefined,
      solde_constate: source ? undefined : compte, cause,
    });
    setEnCours(false);
    if (r.error) { toast(r.error, 'error', 10000); return; }
    toast(r.message, 'success', 6000);
    onCree(r.ecart);
  };

  return (
    <Modale titre={source ? '⚖️ Constater l\'écart détecté' : '⚖️ Constater un écart de caisse'} couleur="linear-gradient(135deg,#0f172a,#334155)"
      enCours={enCours} onFermer={onFermer}
      pied={<>
        <button type="button" className="btn-ghost" onClick={onFermer} disabled={enCours}>Annuler</button>
        <button type="button" className="btn-primary" style={{ width: 'auto', marginTop: 0, opacity: valide ? 1 : 0.5 }} disabled={!valide} onClick={envoyer}>
          {enCours ? 'Enregistrement…' : 'Constater et passer l\'écriture'}</button>
      </>}>
      {source && (
        <div className="ctl-alerte bleue" style={{ margin: 0 }}>
          {source.origine === 'arret'
            ? <>Écart issu de l'<b>arrêté {source.periode?.mois} {source.periode?.annee}</b> du journal {source.journal_code} ({source.etat_origine === 'validee' ? 'validé' : 'en attente de validation'}). Les soldes viennent de l'arrêté.</>
            : <>Écart issu de l'<b>inventaire du {dateFr(source.date_ref)}</b>{source.libelle ? ` (${source.libelle})` : ''}. Les soldes sont ceux figés à la validation.</>}
        </div>
      )}
      <div className="ec-2">
        <div>
          <label className="ec-lbl" htmlFor="ec-j">Journal</label>
          <select id="ec-j" className="ec-in" value={journalId} disabled={Boolean(source) || enCours} onChange={(e) => setJournalId(e.target.value)}>
            {journaux.map((j) => <option key={j.id} value={j.id}>{j.code} — {j.nom}</option>)}
          </select>
        </div>
        <div>
          <label className="ec-lbl" htmlFor="ec-d">Date du constat</label>
          <input id="ec-d" type="date" className="ec-in" value={dateConstat} max={aujourdhui()} disabled={enCours} onChange={(e) => setDateConstat(e.target.value)} />
        </div>
      </div>
      <div className="ec-2">
        <div>
          <span className="ec-lbl">Solde théorique {source ? '' : `au ${dateFr(dateConstat)}`}</span>
          <div className="ec-in" style={{ background: '#f8fafc', fontWeight: 700 }}>{chargement ? 'Calcul…' : <Montant v={theo} devise={devise} />}</div>
        </div>
        <div>
          <label className="ec-lbl" htmlFor="ec-c">Solde réellement compté</label>
          {source
            ? <div className="ec-in" style={{ background: '#f8fafc', fontWeight: 700 }}><Montant v={source.solde_constate} devise={devise} /></div>
            : <input id="ec-c" className="ec-in" inputMode="decimal" placeholder="Ex. 622 500" value={compte} disabled={enCours} onChange={(e) => setCompte(e.target.value)} autoFocus />}
        </div>
      </div>
      <div className={`ec-ecart ${sens || 'nul'}`} aria-live="polite">
        <span style={{ fontSize: 26 }} aria-hidden>{sens === 'manquant' ? '📉' : sens === 'excedent' ? '📈' : '⚖️'}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: sens === 'manquant' ? '#b91c1c' : sens === 'excedent' ? '#047857' : '#64748b' }}>
            {sens === 'manquant' ? 'Manquant de caisse (écart négatif)' : sens === 'excedent' ? 'Excédent de caisse (écart positif)' : 'Écart (compté − théorique)'}
          </div>
          <div className="ec-ecart-v"><Montant v={ecart} devise={devise} signe /></div>
        </div>
      </div>
      <div>
        <label className="ec-lbl" htmlFor="ec-cause">Cause constatée <span style={{ color: '#b91c1c' }}>*</span></label>
        <textarea id="ec-cause" className="ec-in" rows={3} maxLength={2000} value={cause} disabled={enCours} onChange={(e) => setCause(e.target.value)}
          placeholder="Ex. Billetage de fin de journée : il manque un billet de 5 000 ; caissier présent au comptage." />
      </div>
      <details>
        <summary style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 700, color: '#475569' }}>Date de l'écriture au journal (par défaut : date du constat)</summary>
        <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
          <input type="date" className="ec-in" style={{ maxWidth: 220 }} value={dateEcriture} min={dateConstat} max={aujourdhui()} disabled={enCours} onChange={(e) => setDateEcriture(e.target.value)} />
          <span className="ec-muted" style={{ fontSize: 11.5 }}>Le mois de l'écriture doit être ouvert (non arrêté). Pour l'écart d'un arrêté clos, l'écriture se passe dans la période suivante.</span>
        </div>
      </details>
      {sens && journal && (
        <div style={{ fontSize: 12.5, color: '#334155', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 10, padding: '10px 12px' }}>
          📝 Une <b>{sens === 'manquant' ? 'sortie' : 'entrée'}</b> de <b><Montant v={Math.abs(ecart)} devise={devise} /></b> sera passée au journal <b>{journal.code}</b> le {dateFr(dateEcriture || dateConstat)},
          rubrique <b className="ec-mono">{sens === 'manquant' ? 'ECN' : 'ECP'}</b> (compte d'attente 471) : le solde du journal rejoindra le solde compté. Vous choisirez ensuite la destination de l'écart.
        </div>
      )}
    </Modale>
  );
}

// ══ Affectation ═════════════════════════════════════════════════════════════
function ModaleAffectation({ ecart, destinations, devise, onFermer, onMaj }) {
  const toast = useToast();
  const options = destinations[ecart.sens] || [];
  const [code, setCode] = useState(ecart.destination || '');
  const opt = options.find((o) => o.code === code);
  const [compte, setCompte] = useState(ecart.compte_destination || '');
  const [responsable, setResponsable] = useState(ecart.responsable || '');
  const [observation, setObservation] = useState(ecart.observation || '');
  const [enCours, setEnCours] = useState(false);
  const choisir = (o) => { setCode(o.code); setCompte(o.compte); };
  const attente = ecart.compte_attente || '471';
  const od = opt && compte && compte !== attente
    ? (ecart.sens === 'manquant' ? [[compte, opt.libelle, Math.abs(ecart.montant), ''], [attente, 'Comptes d\'attente (écart ECN)', '', Math.abs(ecart.montant)]]
      : [[attente, 'Comptes d\'attente (écart ECP)', Math.abs(ecart.montant), ''], [compte, opt.libelle, '', Math.abs(ecart.montant)]])
    : null;
  const manque = !opt ? 'Choisissez une destination' : opt.responsable === 'obligatoire' && !responsable.trim() ? (opt.code === 'caissier' ? 'Indiquez le caissier' : 'Indiquez le tiers') : '';

  const envoyer = async () => {
    setEnCours(true);
    const r = await api.post(`/controle/ecarts/${ecart.id}/affectation`, { destination: code, compte_destination: compte, responsable_nom: responsable, observation });
    setEnCours(false);
    if (r.error) { toast(r.error, 'error', 9000); return; }
    toast(r.message, 'success', 5000);
    onMaj(r.ecart);
  };

  return (
    <Modale titre={`🧭 Où est allé l'écart ${ecart.numero} ?`} largeur={680} enCours={enCours} onFermer={onFermer}
      couleur={ecart.sens === 'manquant' ? 'linear-gradient(135deg,#b91c1c,#dc2626)' : 'linear-gradient(135deg,#047857,#059669)'}
      pied={<>
        <button type="button" className="btn-ghost" onClick={onFermer} disabled={enCours}>Annuler</button>
        <button type="button" className="btn-primary" style={{ width: 'auto', marginTop: 0, opacity: manque || enCours ? 0.5 : 1 }} disabled={Boolean(manque) || enCours} onClick={envoyer}
          title={manque}>{enCours ? 'Enregistrement…' : opt && !opt.suivi ? 'Affecter et solder l\'écart' : 'Affecter l\'écart'}</button>
      </>}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Sens sens={ecart.sens} /><Montant v={ecart.montant} devise={devise} signe fort />
        <span className="ec-muted" style={{ fontSize: 12.5 }}>· {ecart.journal_code} · constaté le {dateFr(ecart.date_constat)}</span>
      </div>
      <div className="ec-choix" role="radiogroup" aria-label="Destination de l'écart">
        {options.map((o) => (
          <button key={o.code} type="button" role="radio" aria-checked={code === o.code} className={`ec-option${code === o.code ? ' on' : ''}`} onClick={() => choisir(o)} disabled={enCours}>
            <span style={{ fontSize: 22 }} aria-hidden>{o.icone}</span>
            <span><b>{o.libelle}</b><span className="d">{o.description}</span>
              <span className="cpt ec-mono">compte {o.compte}</span>{o.suivi && <span className="cpt" style={{ marginLeft: 6, background: '#dbeafe', color: '#1d4ed8' }}>suivi jusqu'à régularisation</span>}</span>
          </button>
        ))}
      </div>
      {opt && (
        <>
          <div className="ec-2">
            <div>
              <label className="ec-lbl" htmlFor="ec-cpt">Compte de destination</label>
              <input id="ec-cpt" className="ec-in ec-mono" value={compte} maxLength={20} disabled={enCours} onChange={(e) => setCompte(e.target.value.trim())} />
            </div>
            <div>
              <label className="ec-lbl" htmlFor="ec-resp">{opt.code === 'caissier' ? 'Caissier concerné' : opt.code === 'restitution' || opt.code === 'tiers' ? 'Tiers concerné' : 'Responsable / décideur'}{opt.responsable === 'obligatoire' && <span style={{ color: '#b91c1c' }}> *</span>}</label>
              <input id="ec-resp" className="ec-in" maxLength={200} value={responsable} disabled={enCours} onChange={(e) => setResponsable(e.target.value)}
                placeholder={opt.code === 'caissier' ? 'Nom du caissier' : opt.code === 'charge' ? 'Ex. décision du directeur du …' : 'Nom, téléphone…'} />
            </div>
          </div>
          <div>
            <label className="ec-lbl" htmlFor="ec-obs">Observation</label>
            <textarea id="ec-obs" className="ec-in" rows={2} maxLength={2000} value={observation} disabled={enCours} onChange={(e) => setObservation(e.target.value)}
              placeholder={opt.code === 'caissier' ? 'Ex. retenue sur le salaire de novembre, accord signé du caissier' : 'Précisions utiles au suivi'} />
          </div>
          {od && (
            <div>
              <span className="ec-lbl">Reclassement à passer en comptabilité</span>
              <table className="ec-od">
                <thead><tr><th>Compte</th><th>Libellé</th><th style={{ textAlign: 'right' }}>Débit</th><th style={{ textAlign: 'right' }}>Crédit</th></tr></thead>
                <tbody>{od.map(([c, l, d, cr]) => (
                  <tr key={c + l}><td className="ec-mono" style={{ fontWeight: 800 }}>{c}</td><td>{l}</td>
                    <td style={{ textAlign: 'right' }}>{d !== '' && <Montant v={d} devise={devise} />}</td><td style={{ textAlign: 'right' }}>{cr !== '' && <Montant v={cr} devise={devise} />}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Modale>
  );
}

// ══ Régularisation & annulation ═════════════════════════════════════════════
function ModaleRegularisation({ ecart, devise, onFermer, onMaj }) {
  const toast = useToast();
  const [date, setDate] = useState(aujourdhui());
  const [mode, setMode] = useState(ecart.destination === 'restitution' ? 'Restitution au tiers' : ecart.destination === 'caissier' ? 'Retenue sur salaire' : '');
  const [reference, setReference] = useState('');
  const [observation, setObservation] = useState('');
  const [enCours, setEnCours] = useState(false);
  const envoyer = async () => {
    setEnCours(true);
    const r = await api.post(`/controle/ecarts/${ecart.id}/regularisation`, { date, mode, reference, observation });
    setEnCours(false);
    if (r.error) { toast(r.error, 'error', 9000); return; }
    toast(r.message, 'success', 4000);
    onMaj(r.ecart);
  };
  return (
    <Modale titre={`✅ Régulariser l'écart ${ecart.numero}`} largeur={520} enCours={enCours} onFermer={onFermer}
      pied={<>
        <button type="button" className="btn-ghost" onClick={onFermer} disabled={enCours}>Annuler</button>
        <button type="button" className="btn-primary" style={{ width: 'auto', marginTop: 0, opacity: !mode || enCours ? 0.5 : 1 }} disabled={!mode || enCours} onClick={envoyer}>Solder l'écart</button>
      </>}>
      <div style={{ fontSize: 13 }}>{ecart.destination_icone} <b>{ecart.destination_libelle}</b>{ecart.responsable ? ` — ${ecart.responsable}` : ''} · <Montant v={Math.abs(ecart.montant)} devise={devise} fort /></div>
      <div className="ec-2">
        <div><label className="ec-lbl" htmlFor="rg-d">Date</label>
          <input id="rg-d" type="date" className="ec-in" value={date} max={aujourdhui()} onChange={(e) => setDate(e.target.value)} /></div>
        <div><label className="ec-lbl" htmlFor="rg-m">Mode de régularisation *</label>
          <select id="rg-m" className="ec-in" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="">— Choisir —</option>{MODES_REGUL.map((m) => <option key={m}>{m}</option>)}
          </select></div>
      </div>
      <div><label className="ec-lbl" htmlFor="rg-r">Référence (reçu, bulletin de paie, n° de transaction…)</label>
        <input id="rg-r" className="ec-in" maxLength={200} value={reference} onChange={(e) => setReference(e.target.value)} /></div>
      <div><label className="ec-lbl" htmlFor="rg-o">Observation</label>
        <textarea id="rg-o" className="ec-in" rows={2} maxLength={1000} value={observation} onChange={(e) => setObservation(e.target.value)} /></div>
      {mode === 'Remboursement en espèces' && <div className="ctl-alerte bleue" style={{ margin: 0 }}>Le remboursement en espèces est une recette à saisir au journal par le caissier (rubrique de recette habituelle).</div>}
    </Modale>
  );
}

function ModaleAnnulation({ ecart, onFermer, onMaj }) {
  const toast = useToast();
  const [motif, setMotif] = useState('');
  const [enCours, setEnCours] = useState(false);
  const envoyer = async () => {
    setEnCours(true);
    const r = await api.post(`/controle/ecarts/${ecart.id}/annulation`, { motif });
    setEnCours(false);
    if (r.error) { toast(r.error, 'error', 10000); return; }
    toast(r.message, 'success', 4000);
    onMaj(r.ecart);
  };
  return (
    <Modale titre={`↺ Annuler l'écart ${ecart.numero}`} largeur={500} enCours={enCours} onFermer={onFermer}
      pied={<>
        <button type="button" className="btn-ghost" onClick={onFermer} disabled={enCours}>Fermer</button>
        <button type="button" className="ctl-btn rouge" disabled={motif.trim().length < 5 || enCours} onClick={envoyer}>Confirmer l'annulation</button>
      </>}>
      <div className="ctl-alerte rouge" style={{ margin: 0 }}>L'écriture d'écart n°{ecart.ecriture?.numero} sera <b>contre-passée</b> au journal {ecart.journal_code} (sa période doit être ouverte). L'écart reste au registre, marqué annulé.</div>
      <div><label className="ec-lbl" htmlFor="an-m">Motif (obligatoire, tracé)</label>
        <textarea id="an-m" className="ec-in" rows={3} maxLength={500} value={motif} onChange={(e) => setMotif(e.target.value)} autoFocus
          placeholder="Ex. erreur de comptage : billet compté deux fois" /></div>
    </Modale>
  );
}

// ══ Fiche ═══════════════════════════════════════════════════════════════════
function Etapes({ e }) {
  const n = e.statut === 'annule' ? -1 : { constate: 1, affecte: 2, solde: 3 }[e.statut];
  const etapes = ['Constaté', 'Affecté', 'Soldé'];
  if (n === -1) return <div className="ctl-alerte" style={{ margin: 0, background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0' }}>Écart annulé le {dateHeure(e.traces.annulation?.le)} par {e.traces.annulation?.par || '?'} : « {e.traces.annulation?.motif} »</div>;
  return (
    <div className="ec-etapes">
      {etapes.map((lib, i) => (
        <span key={lib} style={{ display: 'contents' }}>
          {i > 0 && <span className={`ec-trait${i < n ? ' fait' : ''}`} />}
          <span className={`ec-etape${i < n ? ' fait' : i === n ? ' cours' : ''}`}><i>{i < n ? '✓' : i + 1}</i>{lib}</span>
        </span>
      ))}
    </div>
  );
}

function FicheEcart({ e, devise, peutSaisir, peutAnnuler, onFermer, onAction }) {
  return (
    <Modale titre={`⚖️ Écart ${e.numero}`} largeur={660} onFermer={onFermer}
      pied={<>
        <button type="button" className="btn-ghost" onClick={onFermer}>Fermer</button>
        {peutAnnuler && e.statut !== 'annule' && <button type="button" className="ctl-btn rouge" onClick={() => onAction('annuler', e)}>↺ Annuler</button>}
        {peutSaisir && ['constate', 'affecte'].includes(e.statut) && <button type="button" className="ctl-btn" onClick={() => onAction('affecter', e)}>{e.statut === 'constate' ? '🧭 Affecter' : '✎ Modifier l\'affectation'}</button>}
        {peutSaisir && e.statut === 'affecte' && <button type="button" className="ctl-btn vert" onClick={() => onAction('regulariser', e)}>✅ Régulariser</button>}
      </>}>
      <Etapes e={e} />
      <div className={`ec-ecart ${e.sens}`}>
        <span style={{ fontSize: 26 }} aria-hidden>{e.sens === 'manquant' ? '📉' : '📈'}</span>
        <div style={{ flex: 1 }}><Sens sens={e.sens} /><div className="ec-ecart-v"><Montant v={e.montant} devise={devise} signe /></div></div>
        <div style={{ textAlign: 'right', fontSize: 12, color: '#475569' }}>
          Théorique <Montant v={e.solde_theorique} devise={devise} /><br />Compté <Montant v={e.solde_constate} devise={devise} />
        </div>
      </div>
      <div className="ec-kv">
        <span>Journal</span><b>{e.journal_code} — {e.journal_nom}</b>
        <span>Origine</span><b>{ORIGINES[e.origine]}{e.periode ? ` ${e.periode.mois} ${e.periode.annee}` : ''}</b>
        <span>Constaté</span><b>le {dateFr(e.date_constat)} par {e.traces.constat.par || '?'}</b>
        <span>Écriture au journal</span><b>{e.ecriture ? <>n°{e.ecriture.numero} du {dateFr(e.date_ecriture)} — rubrique <span className="ec-mono">{e.sens === 'manquant' ? 'ECN' : 'ECP'}</span>{e.ecriture.annulee && ' (contre-passée)'}</> : '—'}</b>
        <span>Cause</span><span style={{ color: 'var(--text)' }}>{e.cause}</span>
        <span>Destination</span><b>{e.destination ? <>{e.destination_icone} {e.destination_libelle} — compte <span className="ec-mono">{e.compte_destination}</span></> : <span style={{ color: '#b45309' }}>à définir</span>}</b>
        {e.responsable && <><span>Responsable / tiers</span><b>{e.responsable}</b></>}
        {e.observation && <><span>Observation</span><span style={{ color: 'var(--text)' }}>{e.observation}</span></>}
        {e.traces.affectation && <><span>Affecté</span><b>le {dateHeure(e.traces.affectation.le)} par {e.traces.affectation.par || '?'}</b></>}
        {e.regularisation && <><span>Régularisation</span><b>{dateFr(e.regularisation.date)} — {e.regularisation.mode}{e.regularisation.reference ? ` (réf. ${e.regularisation.reference})` : ''}</b></>}
      </div>
      {e.reclassement && (
        <div>
          <span className="ec-lbl">Reclassement comptable</span>
          <table className="ec-od">
            <thead><tr><th>Débit</th><th>Crédit</th><th style={{ textAlign: 'right' }}>Montant</th></tr></thead>
            <tbody><tr><td className="ec-mono" style={{ fontWeight: 800 }}>{e.reclassement.debit}</td><td className="ec-mono" style={{ fontWeight: 800 }}>{e.reclassement.credit}</td><td style={{ textAlign: 'right' }}><Montant v={e.reclassement.montant} devise={devise} /></td></tr></tbody>
          </table>
        </div>
      )}
    </Modale>
  );
}

// ══ Page ════════════════════════════════════════════════════════════════════
export default function EcartsCaissePage() {
  const { annee: anneeGlobale, devise, can, journauxGrouped } = useApp();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [annee, setAnnee] = useState(Number(anneeGlobale) || new Date().getFullYear());
  const [mois, setMois] = useState('');
  const [data, setData] = useState(null);
  const [erreur, setErreur] = useState('');
  const [destinations, setDestinations] = useState({ manquant: [], excedent: [] });
  const [filtre, setFiltre] = useState({ statut: '', sens: '' });
  const [modale, setModale] = useState(null); // { type, ecart?, source? }
  const peutSaisir = can('controle.saisir');
  const peutAnnuler = can('controle.reouvrir');
  const journaux = useMemo(() => Object.values(journauxGrouped || {}).flat().filter((j) => j.actif !== false)
    .sort((a, b) => String(a.code).localeCompare(String(b.code))), [journauxGrouped]);

  const charger = useCallback(async () => {
    const r = await api.get(`/controle/ecarts?annee=${annee}${mois ? `&mois=${encodeURIComponent(mois)}` : ''}`);
    if (r.error) { setErreur(r.error); setData(null); return; }
    setErreur(''); setData(r);
  }, [annee, mois]);
  useEffect(() => { charger(); }, [charger]);
  useEffect(() => { api.get('/controle/ecarts/parametres').then((r) => { if (!r.error) setDestinations(r.destinations); }); }, []);

  // Arrivée depuis « Arrêtés & inventaires » : ?constater=arret&origine_id=…
  useEffect(() => {
    if (!data || !params.get('constater')) return;
    const src = data.a_constater.find((d) => d.origine === params.get('constater') && String(d.origine_id) === params.get('origine_id'));
    if (src && peutSaisir) setModale({ type: 'constater', source: src });
    else if (!src) toast('Cet écart est déjà constaté au registre, ou n\'existe plus.', 'warning', 6000);
    setParams({}, { replace: true });
  }, [data, params, setParams, peutSaisir, toast]);

  const majEcart = (e) => { setModale(e ? { type: 'fiche', ecart: e } : null); charger(); };
  const action = (type, e) => setModale({ type, ecart: e });

  if (erreur) return <div className="alert-err">{erreur}</div>;
  const r = data?.resume;
  const lignes = (data?.lignes || []).filter((l) => (!filtre.statut || l.statut === filtre.statut) && (!filtre.sens || l.sens === filtre.sens));
  const maxDest = Math.max(1, ...(r?.par_destination || []).map((d) => d.montant));
  const exporter = () => exporterExcel(`Ecarts_caisse_${mois || 'annee'}_${annee}`,
    ['N°', 'Date constat', 'Journal', 'Origine', 'Sens', `Théorique (${devise})`, `Compté (${devise})`, `Écart (${devise})`, 'Cause', 'Destination', 'Compte', 'Responsable / tiers', 'Statut', 'Régularisation'],
    lignes.map((l) => [l.numero, dateFr(l.date_constat), l.journal_code, ORIGINES[l.origine].replace(/^\S+ /, ''), l.sens === 'manquant' ? 'Manquant' : 'Excédent',
      num(l.solde_theorique), num(l.solde_constate), num(l.montant), l.cause, l.destination_libelle || '', l.compte_destination, l.responsable, STATUTS[l.statut].lib,
      l.regularisation ? `${dateFr(l.regularisation.date)} — ${l.regularisation.mode}` : '']),
    [`Registre des écarts de caisse — ${mois ? `${mois} ` : ''}${annee}`]);

  return (
    <div>
      <style>{CSS}</style>
      <div className="ec-tete">
        <div>
          <h2>⚖️ Registre des écarts de caisse</h2>
          <p>Le comptable constate chaque écart entre le solde du journal et la caisse comptée, l'inscrit au journal (rubriques ECP / ECN), puis en trace la destination jusqu'à sa régularisation.</p>
        </div>
        <div className="ec-actions">
          <select className="ec-sel" value={mois} onChange={(e) => setMois(e.target.value)} aria-label="Mois">
            <option value="">Toute l'année</option>{MOIS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select className="ec-sel" value={annee} onChange={(e) => setAnnee(Number(e.target.value))} aria-label="Année">
            {[0, 1, 2, 3].map((d) => { const a = new Date().getFullYear() - d; return <option key={a} value={a}>{a}</option>; })}
          </select>
          {can('rapport.export') && data && <button type="button" style={STYLE_BOUTON_EXPORT} onClick={exporter}>📊 Excel</button>}
          {peutSaisir && <button type="button" className="ctl-btn vert" onClick={() => setModale({ type: 'constater', source: null })} disabled={!journaux.length}>+ Constater un écart</button>}
        </div>
      </div>

      {!data ? <div className="loading-msg">Chargement…</div> : (
        <>
          <div className="ec-kpis">
            {[
              ['', '', 'Écarts constatés', r.total, `${r.soldes} soldé(s)`, '#334155'],
              ['sens', 'manquant', 'Manquants', <Montant key="m" v={-r.manquants.montant} devise={devise} signe />, `${r.manquants.nb} écart(s)`, '#dc2626'],
              ['sens', 'excedent', 'Excédents', <Montant key="e" v={r.excedents.montant} devise={devise} signe />, `${r.excedents.nb} écart(s)`, '#059669'],
              ['statut', 'constate', 'À affecter', r.a_affecter, 'destination à décider', '#d97706'],
              ['statut', 'affecte', 'À suivre', <Montant key="s" v={r.a_suivre.montant} devise={devise} />, `${r.a_suivre.nb} à recouvrer / restituer`, '#2563eb'],
            ].map(([cle, val, titre, v, sous, c]) => {
              const on = cle && filtre[cle] === val;
              return (
                <button key={titre} type="button" className={`ec-kpi${on ? ' on' : ''}`} style={{ borderTopColor: c }}
                  onClick={() => setFiltre(cle ? { statut: '', sens: '', [cle]: on ? '' : val } : { statut: '', sens: '' })}>
                  <div className="ec-kpi-t">{titre}</div>
                  <div className="ec-kpi-v" style={{ color: typeof v === 'number' ? c : undefined }}>{v}</div>
                  <div className="ec-kpi-s">{sous}</div>
                </button>
              );
            })}
          </div>

          <div className="ec-grille">
            <section className="ec-carte" style={{ borderColor: data.a_constater.length ? '#fde68a' : undefined }}>
              <div className="ec-carte-t" style={{ background: data.a_constater.length ? '#fffbeb' : undefined }}>
                🔔 Écarts détectés à constater <small>— arrêtés (solde constaté saisi) et inventaires validés</small>
                <span className="rpc-statut" style={{ marginLeft: 'auto', background: data.a_constater.length ? '#f59e0b' : '#e2e8f0', color: data.a_constater.length ? '#fff' : '#475569' }}>{data.a_constater.length}</span>
              </div>
              {data.a_constater.length === 0 && <div style={{ padding: '18px 16px', fontSize: 13 }} className="ec-muted">Aucun écart en attente : tous les écarts détectés sont au registre. ✔</div>}
              {data.a_constater.map((d) => (
                <div key={`${d.origine}-${d.origine_id}`} className="ec-detecte">
                  <span style={{ fontSize: 18 }} aria-hidden>{d.origine === 'arret' ? '🔒' : '📦'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{d.journal_code} — {d.origine === 'arret' ? `arrêté ${d.periode.mois} ${d.periode.annee}` : `inventaire du ${dateFr(d.date_ref)}`}</div>
                    <div className="ec-muted" style={{ fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.cause || 'Sans observation'}</div>
                  </div>
                  <Sens sens={d.sens} />
                  <Montant v={d.montant} devise={devise} signe />
                  {peutSaisir && <button type="button" className="ctl-btn mini" onClick={() => setModale({ type: 'constater', source: d })}>Constater</button>}
                </div>
              ))}
            </section>
            <section className="ec-carte">
              <div className="ec-carte-t">🧭 Où sont allés les écarts <small>— par destination</small></div>
              <div className="ec-dest">
                {(r.par_destination || []).length === 0 && <div className="ec-muted" style={{ fontSize: 13 }}>Aucun écart affecté sur la période.</div>}
                {(r.par_destination || []).sort((a, b) => b.montant - a.montant).map((d) => (
                  <div key={`${d.sens}-${d.destination}`} className="ec-dest-l">
                    <span aria-hidden>{(destinations[d.sens] || []).find((o) => o.code === d.destination)?.icone || '•'}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700 }}>{d.libelle} <span className="ec-muted ec-mono" style={{ fontSize: 11 }}>{d.compte}</span></div>
                      <div className="ec-barre"><i style={{ width: `${Math.round((d.montant / maxDest) * 100)}%`, background: d.sens === 'manquant' ? '#f87171' : '#34d399' }} /></div>
                    </div>
                    <span style={{ textAlign: 'right' }}><Montant v={d.sens === 'manquant' ? -d.montant : d.montant} devise={devise} signe /><div className="ec-muted" style={{ fontSize: 11 }}>{d.nb} écart(s)</div></span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="ec-carte">
            <div className="ec-filtres">
              <b style={{ fontSize: 12, marginRight: 4 }}>Registre {mois ? `${mois} ` : ''}{annee}</b>
              {[['', 'Tous'], ['constate', 'À affecter'], ['affecte', 'À suivre'], ['solde', 'Soldés'], ['annule', 'Annulés']].map(([v, lib]) => (
                <button key={lib} type="button" className={`ec-puce${filtre.statut === v ? ' on' : ''}`} onClick={() => setFiltre((f) => ({ ...f, statut: v }))}>{lib}</button>
              ))}
              <span style={{ width: 10 }} />
              {[['', 'Tous sens'], ['manquant', '▼ Manquants'], ['excedent', '▲ Excédents']].map(([v, lib]) => (
                <button key={lib} type="button" className={`ec-puce${filtre.sens === v ? ' on' : ''}`} onClick={() => setFiltre((f) => ({ ...f, sens: v }))}>{lib}</button>
              ))}
            </div>
            <div className="table-wrap" style={{ border: 0, borderRadius: 0, margin: 0 }}>
              <table className="ec-table">
                <thead><tr><th>N°</th><th>Constat</th><th>Journal</th><th>Origine</th><th className="n">Écart</th><th>Destination</th><th>Statut</th><th /></tr></thead>
                <tbody>
                  {lignes.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 28 }} className="ec-muted">Aucun écart pour ce filtre{peutSaisir ? ' — « + Constater un écart » pour en inscrire un.' : '.'}</td></tr>}
                  {lignes.map((l) => (
                    <tr key={l.id} className="cl" tabIndex={0} onClick={() => setModale({ type: 'fiche', ecart: l })} onKeyDown={(e) => { if (e.key === 'Enter') setModale({ type: 'fiche', ecart: l }); }}
                      style={{ opacity: l.statut === 'annule' ? 0.55 : 1 }}>
                      <td><b className="ec-mono" style={{ fontSize: 12 }}>{l.numero}</b>{l.ecriture && <div className="ec-muted" style={{ fontSize: 11 }}>écriture n°{l.ecriture.numero}</div>}</td>
                      <td>{dateFr(l.date_constat)}<div className="ec-muted" style={{ fontSize: 11 }}>{l.traces.constat.par || ''}</div></td>
                      <td><b>{l.journal_code}</b></td>
                      <td style={{ fontSize: 12 }}>{ORIGINES[l.origine]}{l.periode && <div className="ec-muted" style={{ fontSize: 11 }}>{l.periode.mois} {l.periode.annee}</div>}</td>
                      <td className="n"><Montant v={l.montant} devise={devise} signe /><div style={{ marginTop: 3 }}><Sens sens={l.sens} /></div></td>
                      <td style={{ fontSize: 12.5 }}>{l.destination
                        ? <>{l.destination_icone} {l.destination_libelle}<div className="ec-muted" style={{ fontSize: 11 }}><span className="ec-mono">{l.compte_destination}</span>{l.responsable ? ` · ${l.responsable}` : ''}</div></>
                        : <span style={{ color: '#b45309', fontWeight: 600 }}>À définir</span>}</td>
                      <td><Statut s={l.statut} /></td>
                      <td style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                        {peutSaisir && l.statut === 'constate' && <button type="button" className="ctl-btn mini" onClick={() => action('affecter', l)}>🧭 Affecter</button>}
                        {peutSaisir && l.statut === 'affecte' && <button type="button" className="ctl-btn mini vert" onClick={() => action('regulariser', l)}>✅ Régulariser</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <div className="ec-muted" style={{ fontSize: 11, marginTop: 8 }}>
            Constat, affectation et régularisation : comptable (contrôle comptable). L'écriture d'écart suit les règles du journal (période ouverte, ordre chronologique) ; elle n'entre pas dans le contrôle budgétaire.
            Le compte d'attente des rubriques ECP / ECN (471 par défaut) se modifie dans le contrôle de régularité formelle.
          </div>
        </>
      )}

      {modale?.type === 'constater' && <ModaleConstat source={modale.source} journaux={journaux} devise={devise} onFermer={() => setModale(null)} onCree={(e) => majEcart(e)} />}
      {modale?.type === 'fiche' && <FicheEcart e={modale.ecart} devise={devise} peutSaisir={peutSaisir} peutAnnuler={peutAnnuler} onFermer={() => setModale(null)} onAction={action} />}
      {modale?.type === 'affecter' && <ModaleAffectation ecart={modale.ecart} destinations={destinations} devise={devise} onFermer={() => setModale({ type: 'fiche', ecart: modale.ecart })} onMaj={majEcart} />}
      {modale?.type === 'regulariser' && <ModaleRegularisation ecart={modale.ecart} devise={devise} onFermer={() => setModale({ type: 'fiche', ecart: modale.ecart })} onMaj={majEcart} />}
      {modale?.type === 'annuler' && <ModaleAnnulation ecart={modale.ecart} onFermer={() => setModale({ type: 'fiche', ecart: modale.ecart })} onMaj={majEcart} />}
    </div>
  );
}
