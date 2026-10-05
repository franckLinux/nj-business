import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';

// Prospects et comptes de démonstration (réforme prospects).
// Accès : super_admin, ou membre du cabinet titulaire de « prospects.gerer ».
export const STATUTS = {
  PROSPECT:            { label: 'Prospect',               couleur: '#475569', fond: '#f1f5f9' },
  INVITATION_ENVOYEE:  { label: 'Invitation envoyée',     couleur: '#1d4ed8', fond: '#eff6ff' },
  DEMO_ACTIVE:         { label: 'Démo active',            couleur: '#15803d', fond: '#f0fdf4' },
  DEMO_EXPIREE:        { label: 'Démo expirée',           couleur: '#c2410c', fond: '#fff7ed' },
  PAIEMENT_EN_ATTENTE: { label: 'Paiement en attente',    couleur: '#a16207', fond: '#fefce8' },
  CLIENT_ACTIF:        { label: 'Client actif',           couleur: '#065f46', fond: '#d1fae5' },
  DEMO_ANNULEE:        { label: 'Démo annulée',           couleur: '#b91c1c', fond: '#fef2f2' },
  PROSPECT_ABANDONNE:  { label: 'Prospect abandonné',     couleur: '#6b7280', fond: '#f3f4f6' },
};
const EMAILS = {
  en_attente: 'En attente', envoye: 'Envoyé', renvoye: 'Renvoyé', non_envoye: 'Non envoyé', adresse_invalide: 'Adresse invalide',
};
const ETATS_LIEN = { valide: 'Valide', utilisee: 'Utilisé', annulee: 'Annulé / remplacé', expiree: 'Expiré' };
const ACTIONS = {
  CREATION: 'Création', MODIFICATION: 'Modification', INVITATION_CREEE: 'Accès de démo créé', INVITATION_RENVOYEE: 'Accès renvoyé',
  EMAIL_ENVOYE: 'E-mail envoyé', EMAIL_RENVOYE: 'E-mail renvoyé', EMAIL_NON_ENVOYE: 'E-mail non envoyé', EMAIL_ADRESSE_INVALIDE: 'Adresse e-mail invalide',
  ACTIVATION: 'Compte activé par le prospect', PROLONGATION: 'Prolongation', EXPIRATION_AUTOMATIQUE: 'Expiration automatique',
  CHANGEMENT_STATUT: 'Changement de statut', RAPPEL_AVANT: 'Rappel avant échéance', RAPPEL_JOUR: 'Rappel jour d\'échéance', RAPPEL_APRES: 'Rappel après échéance',
};
// Changements manuels autorisés (miroir de TRANSITIONS côté serveur).
const TRANSITIONS = {
  DEMO_ANNULEE:        ['PROSPECT', 'INVITATION_ENVOYEE', 'DEMO_ACTIVE', 'DEMO_EXPIREE', 'PAIEMENT_EN_ATTENTE'],
  PROSPECT_ABANDONNE:  ['PROSPECT', 'INVITATION_ENVOYEE', 'DEMO_ACTIVE', 'DEMO_EXPIREE', 'PAIEMENT_EN_ATTENTE'],
  PAIEMENT_EN_ATTENTE: ['DEMO_ACTIVE', 'DEMO_EXPIREE'],
  PROSPECT:            ['DEMO_ANNULEE', 'PROSPECT_ABANDONNE'],
};
const FERMES = ['DEMO_ANNULEE', 'PROSPECT_ABANDONNE', 'CLIENT_ACTIF'];

const dateFr = (d, h = false) => (d ? (h ? new Date(d).toLocaleString('fr-FR') : new Date(d).toLocaleDateString('fr-FR')) : '—');
const versInput = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
// Une date saisie (jour) = fin de journée locale pour la fin, début de journée pour le début.
const debutJour = (s) => new Date(`${s}T00:00:00`).toISOString();
const finJour = (s) => new Date(`${s}T23:59:59`).toISOString();
const joursRestants = (fin) => Math.ceil((new Date(fin) - Date.now()) / 864e5);

export function BadgeStatut({ statut }) {
  const s = STATUTS[statut] || { label: statut, couleur: '#475569', fond: '#f1f5f9' };
  return <span style={{ background: s.fond, color: s.couleur, fontWeight: 700, fontSize: 11, padding: '3px 8px', borderRadius: 20, whiteSpace: 'nowrap' }}>{s.label}</span>;
}

const champ = { padding: '8px 12px', border: '1.5px solid var(--border)', borderRadius: 7, fontSize: 13 };

// ── Lien d'activation affiché quand l'e-mail n'est pas parti ─────────────
function ResultatEnvoi({ r }) {
  const toast = useToast();
  if (!r) return null;
  const ok = ['envoye', 'renvoye'].includes(r.statut_email);
  return (
    <div className={ok ? 'alert-ok' : 'alert-err'} style={{ marginBottom: 12, fontSize: 13, background: ok ? '#f0fdf4' : undefined, color: ok ? '#15803d' : undefined, padding: ok ? 10 : undefined, borderRadius: 8 }}>
      {ok ? `✓ E-mail d'accès ${r.statut_email === 'renvoye' ? 'renvoyé' : 'envoyé'}. Lien valable jusqu'au ${dateFr(r.expire_le, true)}.` : (
        <>
          <strong>E-mail non envoyé ({EMAILS[r.statut_email] || r.statut_email}).</strong> {r.erreur_email}
          <div style={{ marginTop: 8 }}>Transmettez vous-même ce lien <strong>au prospect uniquement</strong> (valable jusqu'au {dateFr(r.expire_le, true)}, utilisable une fois). Il ne sera plus affiché ensuite :</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <input readOnly value={r.lien || ''} style={{ ...champ, flex: 1, fontSize: 12 }} onFocus={(e) => e.target.select()} />
            <button className="btn-secondary" onClick={() => navigator.clipboard?.writeText(r.lien).then(() => toast('Lien copié.', 'success'))}>Copier</button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Formulaire (création / modification) ──────────────────────────────────
const VIDE = () => ({
  nom_complet: '', entreprise: '', email: '', telephone: '', pays: 'Cameroun', ville: '', secteur: '', type_entreprise: '',
  nb_utilisateurs: '', nb_points_vente: '', besoins: '', forfait_envisage: '', notes: '', source: '',
  demo_debut: versInput(new Date()), demo_fin: versInput(new Date(Date.now() + 14 * 864e5)),
});

function ChampsProspect({ f, set, datesModifiables, emailModifiable }) {
  const L = ({ label, k, type = 'text', ph, req, dis }) => (
    <div className="form-section"><label>{label}{req && ' *'}</label>
      <input type={type} value={f[k]} onChange={set(k)} placeholder={ph} disabled={dis} /></div>
  );
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 14px' }}>
        {L({ label: 'Nom complet', k: 'nom_complet', ph: 'Nom et prénom du contact' })}
        {L({ label: 'Entreprise', k: 'entreprise', ph: 'Raison sociale' })}
        {L({ label: 'E-mail (identifiant de connexion)', k: 'email', type: 'email', req: true, dis: !emailModifiable })}
        {L({ label: 'Téléphone', k: 'telephone' })}
        {L({ label: 'Pays', k: 'pays' })}
        {L({ label: 'Ville', k: 'ville' })}
        {L({ label: 'Secteur d\'activité', k: 'secteur', ph: 'Commerce, santé, BTP…' })}
        {L({ label: 'Type d\'entreprise', k: 'type_entreprise', ph: 'SARL, ETS, association…' })}
        {L({ label: 'Utilisateurs prévus', k: 'nb_utilisateurs', type: 'number' })}
        {L({ label: 'Points de vente / caisses', k: 'nb_points_vente', type: 'number' })}
        {L({ label: 'Forfait envisagé', k: 'forfait_envisage' })}
        {L({ label: 'Source', k: 'source', ph: 'Recommandation, salon, site…' })}
        {L({ label: 'Début de la démo', k: 'demo_debut', type: 'date', req: true, dis: !datesModifiables })}
        {L({ label: 'Fin de la démo', k: 'demo_fin', type: 'date', req: true, dis: !datesModifiables })}
      </div>
      {!datesModifiables && <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -4 }}>Les dates se modifient par « Prolonger » une fois l'accès envoyé.</p>}
      <div className="form-section"><label>Besoins exprimés</label><textarea rows={2} value={f.besoins} onChange={set('besoins')} style={{ width: '100%' }} /></div>
      <div className="form-section"><label>Notes internes</label><textarea rows={2} value={f.notes} onChange={set('notes')} style={{ width: '100%' }} /></div>
    </>
  );
}

function ApercuEmail({ nom, debut, fin }) {
  const [c, setC] = useState(null);
  useEffect(() => {
    const t = setTimeout(async () => {
      const p = new URLSearchParams({ nom: nom || '', debut: debut ? debutJour(debut) : '', fin: fin ? finJour(fin) : '' });
      const r = await api.get(`/prospects/apercu-email?${p}`);
      if (!r.error) setC(r);
    }, 300);
    return () => clearTimeout(t);
  }, [nom, debut, fin]);
  if (!c) return <div className="loading-msg">Aperçu…</div>;
  return (
    <div>
      <div style={{ fontSize: 13, marginBottom: 6 }}><strong>Objet :</strong> {c.subject}</div>
      {/* sandbox sans scripts : le HTML de l'aperçu ne peut rien exécuter */}
      <iframe title="Aperçu de l'e-mail" sandbox="" srcDoc={c.html} style={{ width: '100%', height: 420, border: '1px solid var(--border)', borderRadius: 8 }} />
    </div>
  );
}

function NouveauProspect({ onClose, onCree }) {
  const toast = useToast();
  const [f, setF] = useState(VIDE);
  const [envoyer, setEnvoyer] = useState(true);
  const [apercu, setApercu] = useState(false);
  const [erreur, setErreur] = useState('');
  const [doublon, setDoublon] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const valider = async () => {
    setErreur(''); setDoublon(null);
    if (!f.nom_complet.trim() && !f.entreprise.trim()) { setErreur('Indiquez le nom complet ou l\'entreprise.'); return; }
    if (!f.email.trim()) { setErreur('L\'adresse e-mail est obligatoire.'); return; }
    if (f.demo_fin <= f.demo_debut) { setErreur('La fin de la démo doit être après le début.'); return; }
    if (envoyer && !window.confirm(`Créer l'espace de démonstration et envoyer l'accès à ${f.email} ?`)) return;
    setEnCours(true);
    const r = await api.post('/prospects', { ...f, demo_debut: debutJour(f.demo_debut), demo_fin: finJour(f.demo_fin) });
    if (r.error) { setEnCours(false); setErreur(r.error); if (r.existing_id) setDoublon(r.existing_id); return; }
    let envoi = null;
    if (envoyer) {
      envoi = await api.post(`/prospects/${r.id}/invitation`);
      if (envoi.error) { toast(`Prospect créé, mais accès non envoyé : ${envoi.error}`, 'error'); envoi = null; }
    }
    setEnCours(false);
    toast('Prospect enregistré.', 'success');
    onCree(r.id, envoi);
  };

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 860 }}>
        <div className="modal-head"><h3>➕ Nouveau prospect</h3><button className="modal-close" onClick={onClose}>✕</button></div>
        <div className="modal-body" style={{ maxHeight: '72vh', overflowY: 'auto' }}>
          {erreur && <div className="alert-err" style={{ marginBottom: 10 }}>{erreur}
            {doublon && <button className="btn-secondary" style={{ marginLeft: 10 }} onClick={() => onCree(doublon, null)}>Ouvrir le prospect existant</button>}</div>}
          <div className="tabs-header" style={{ marginBottom: 12 }}>
            <button className={`tab-btn${!apercu ? ' active' : ''}`} onClick={() => setApercu(false)}>Informations</button>
            <button className={`tab-btn${apercu ? ' active' : ''}`} onClick={() => setApercu(true)}>Aperçu de l'e-mail</button>
          </div>
          {apercu
            ? <ApercuEmail nom={f.nom_complet || f.entreprise} debut={f.demo_debut} fin={f.demo_fin} />
            : <ChampsProspect f={f} set={set} datesModifiables emailModifiable />}
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginTop: 8 }}>
            <input type="checkbox" checked={envoyer} onChange={(e) => setEnvoyer(e.target.checked)} style={{ width: 'auto' }} />
            Créer l'espace de démonstration (vide) et envoyer le lien d'activation maintenant
          </label>
        </div>
        <div className="modal-foot" style={{ gap: 10 }}>
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-add" onClick={valider} disabled={enCours}>{enCours ? 'Enregistrement…' : (envoyer ? 'Enregistrer et envoyer' : 'Enregistrer')}</button>
        </div>
      </div>
    </div>
  );
}

// ── Détail d'un prospect ───────────────────────────────────────────────────
function DetailProspect({ id, envoiInitial, onClose, onChange }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [f, setF] = useState(null);
  const [onglet, setOnglet] = useState('infos');
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(envoiInitial || null);
  const [prol, setProl] = useState(null);     // { fin, motif }
  const [chg, setChg] = useState(null);       // { statut, motif }
  const [enCours, setEnCours] = useState(false);

  const charger = useCallback(async () => {
    const r = await api.get(`/prospects/${id}`);
    if (r.error) { setErreur(r.error); return; }
    setD(r);
    setF({ ...Object.fromEntries(Object.keys(VIDE()).map((k) => [k, r[k] ?? ''])),
      demo_debut: versInput(r.demo_debut), demo_fin: versInput(r.demo_fin) });
  }, [id]);
  useEffect(() => { charger(); }, [charger]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const apres = (msg) => { toast(msg, 'success'); setErreur(''); charger(); onChange(); };

  const enregistrer = async () => {
    const corps = { ...f };
    if (d.statut === 'PROSPECT') { corps.demo_debut = debutJour(f.demo_debut); corps.demo_fin = finJour(f.demo_fin); } else { delete corps.demo_debut; delete corps.demo_fin; }
    const r = await api.put(`/prospects/${id}`, corps);
    if (r.error) { setErreur(r.error); return; }
    apres('Prospect enregistré.');
  };
  const inviter = async () => {
    const renvoi = d.statut === 'INVITATION_ENVOYEE';
    if (!window.confirm(renvoi
      ? `Renvoyer un nouveau lien à ${d.email} ? L'ancien lien sera invalidé.`
      : `Créer l'espace de démonstration et envoyer l'accès à ${d.email} ?`)) return;
    setEnCours(true);
    const r = await api.post(`/prospects/${id}/invitation`);
    setEnCours(false);
    if (r.error) { setErreur(r.error); return; }
    setEnvoi(r); apres(renvoi ? 'Nouveau lien généré.' : 'Accès de démonstration créé.');
  };
  const prolonger = async () => {
    if (!prol.fin || !prol.motif.trim()) { setErreur('Nouvelle date et motif obligatoires.'); return; }
    const nouvelle = finJour(prol.fin);
    if (!window.confirm(`Prolonger la démonstration du ${dateFr(d.demo_fin)} au ${dateFr(nouvelle)} ?\nMotif : ${prol.motif}`)) return;
    const r = await api.post(`/prospects/${id}/prolongation`, { nouvelle_fin: nouvelle, motif: prol.motif, confirmation: true });
    if (r.error) { setErreur(r.error); return; }
    setProl(null); apres('Démonstration prolongée.');
  };
  const changerStatut = async () => {
    if (!chg.statut || !chg.motif.trim()) { setErreur('Statut et motif obligatoires.'); return; }
    const ferme = ['DEMO_ANNULEE', 'PROSPECT_ABANDONNE'].includes(chg.statut);
    if (!window.confirm(`Passer au statut « ${STATUTS[chg.statut].label} » ?${ferme ? '\nL\'accès de démonstration sera fermé (données conservées, rien n\'est supprimé).' : ''}`)) return;
    const r = await api.post(`/prospects/${id}/statut`, chg);
    if (r.error) { setErreur(r.error); return; }
    setChg(null); apres('Statut mis à jour.');
  };

  const choix = d ? Object.keys(TRANSITIONS).filter((s) => TRANSITIONS[s].includes(d.statut)) : [];
  const ferme = d && FERMES.includes(d.statut);

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 900 }}>
        <div className="modal-head">
          <h3>👤 {d ? (d.entreprise || d.nom_complet) : 'Prospect'} {d && <BadgeStatut statut={d.statut} />}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ maxHeight: '72vh', overflowY: 'auto' }}>
          {erreur && <div className="alert-err" style={{ marginBottom: 10 }}>{erreur}</div>}
          <ResultatEnvoi r={envoi} />
          {!d || !f ? <div className="loading-msg">Chargement…</div> : (
            <>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13, marginBottom: 12 }}>
                <div><span style={{ color: 'var(--text-muted)' }}>Démo :</span> {dateFr(d.demo_debut)} → <strong>{dateFr(d.demo_fin)}</strong>
                  {['DEMO_ACTIVE', 'INVITATION_ENVOYEE'].includes(d.statut) && <span style={{ color: joursRestants(d.demo_fin) <= 3 ? '#c2410c' : 'var(--text-muted)' }}> ({joursRestants(d.demo_fin)} j restants)</span>}</div>
                <div><span style={{ color: 'var(--text-muted)' }}>Identifiant :</span> {d.email}</div>
                {d.espace && <div><span style={{ color: 'var(--text-muted)' }}>Dernier accès :</span> {dateFr(d.espace.dernier_acces, true)}</div>}
              </div>
              <div className="tabs-header" style={{ marginBottom: 12 }}>
                {[['infos', 'Informations'], ['historique', `Historique (${d.historique.length})`], ['acces', `Accès (${d.invitations.length})`]].map(([k, l]) => (
                  <button key={k} className={`tab-btn${onglet === k ? ' active' : ''}`} onClick={() => setOnglet(k)}>{l}</button>
                ))}
              </div>
              {onglet === 'infos' && <ChampsProspect f={f} set={set} datesModifiables={d.statut === 'PROSPECT' && !ferme} emailModifiable={!d.user_id && !ferme} />}
              {onglet === 'historique' && (
                <div className="table-wrap"><table>
                  <thead><tr><th>Date</th><th>Action</th><th>Statut</th><th>Motif / détail</th><th>Par</th></tr></thead>
                  <tbody>{d.historique.map((h) => (
                    <tr key={h.id}>
                      <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{dateFr(h.created_at, true)}</td>
                      <td style={{ fontWeight: 600, fontSize: 13 }}>{ACTIONS[h.action] || h.action}</td>
                      <td style={{ fontSize: 11 }}>{h.ancien_statut && h.ancien_statut !== h.nouveau_statut ? `${STATUTS[h.ancien_statut]?.label || h.ancien_statut} → ` : ''}{STATUTS[h.nouveau_statut]?.label || h.nouveau_statut || ''}</td>
                      <td style={{ fontSize: 12 }}>{h.motif}
                        {h.details?.ancienne_fin && <div style={{ color: 'var(--text-muted)' }}>{dateFr(h.details.ancienne_fin)} → {dateFr(h.details.nouvelle_fin)}</div>}
                        {h.details?.erreur && <div style={{ color: '#b91c1c' }}>{h.details.erreur}</div>}</td>
                      <td style={{ fontSize: 12 }}>{h.auteur || 'système'}</td>
                    </tr>))}</tbody>
                </table></div>
              )}
              {onglet === 'acces' && (
                <>
                  {d.espace && (
                    <p style={{ fontSize: 13 }}>Espace de démo <strong>{d.espace.nom}</strong> — {d.espace.actif ? 'ouvert' : 'fermé'} · {d.espace.nb_utilisateurs} utilisateur(s) · {d.espace.nb_mouvements} mouvement(s)
                      {d.espace.donnees_conservees_jusqu_au && <> · données conservées jusqu'au {dateFr(d.espace.donnees_conservees_jusqu_au)}</>}</p>
                  )}
                  {d.invitations.length === 0 ? <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Aucun accès envoyé.</p> : (
                    <div className="table-wrap"><table>
                      <thead><tr><th>Créé le</th><th>E-mail</th><th>Lien</th><th>Expire le</th><th>Utilisé le</th></tr></thead>
                      <tbody>{d.invitations.map((i) => (
                        <tr key={i.id}>
                          <td style={{ fontSize: 12 }}>{dateFr(i.created_at, true)}{i.est_renvoi && <div style={{ color: 'var(--text-muted)' }}>renvoi</div>}</td>
                          <td style={{ fontSize: 12 }}>{EMAILS[i.statut_email]}{i.erreur_email && <div style={{ color: '#b91c1c', fontSize: 11 }}>{i.erreur_email}</div>}</td>
                          <td style={{ fontSize: 12 }}>{ETATS_LIEN[i.etat]}</td>
                          <td style={{ fontSize: 12 }}>{dateFr(i.expire_le, true)}</td>
                          <td style={{ fontSize: 12 }}>{dateFr(i.utilise_le, true)}</td>
                        </tr>))}</tbody>
                    </table></div>
                  )}
                </>
              )}

              {prol && (
                <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, marginTop: 12 }}>
                  <strong style={{ fontSize: 13 }}>Prolonger la démonstration</strong> <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>(fin actuelle : {dateFr(d.demo_fin)})</span>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
                    <input type="date" value={prol.fin} min={versInput(new Date())} onChange={(e) => setProl({ ...prol, fin: e.target.value })} style={champ} />
                    <input placeholder="Motif (obligatoire)" value={prol.motif} onChange={(e) => setProl({ ...prol, motif: e.target.value })} style={{ ...champ, flex: 1, minWidth: 220 }} />
                    <button className="btn-add" onClick={prolonger}>Valider</button>
                    <button className="btn-secondary" onClick={() => setProl(null)}>Annuler</button>
                  </div>
                </div>
              )}
              {chg && (
                <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, marginTop: 12 }}>
                  <strong style={{ fontSize: 13 }}>Changer le statut</strong>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
                    <select value={chg.statut} onChange={(e) => setChg({ ...chg, statut: e.target.value })} style={champ}>
                      <option value="">— Nouveau statut —</option>
                      {choix.map((s) => <option key={s} value={s}>{s === 'PROSPECT' ? 'Rouvrir le prospect' : STATUTS[s].label}</option>)}
                    </select>
                    <input placeholder="Motif (obligatoire)" value={chg.motif} onChange={(e) => setChg({ ...chg, motif: e.target.value })} style={{ ...champ, flex: 1, minWidth: 220 }} />
                    <button className="btn-add" onClick={changerStatut}>Valider</button>
                    <button className="btn-secondary" onClick={() => setChg(null)}>Annuler</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        {d && (
          <div className="modal-foot" style={{ gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {['PROSPECT', 'INVITATION_ENVOYEE'].includes(d.statut) && (
                <button className="btn-secondary" onClick={inviter} disabled={enCours}>
                  {enCours ? 'Envoi…' : d.statut === 'PROSPECT' ? (d.tenant_id ? '✉ Renvoyer un accès' : '✉ Créer la démo et envoyer l\'accès') : '✉ Renvoyer le lien'}
                </button>
              )}
              {!ferme && d.statut !== 'PAIEMENT_EN_ATTENTE' && !prol && (
                <button className="btn-secondary" onClick={() => setProl({ fin: versInput(new Date(Math.max(Date.now(), new Date(d.demo_fin)) + 7 * 864e5)), motif: '' })}>⏱ Prolonger</button>
              )}
              {choix.length > 0 && !chg && <button className="btn-secondary" onClick={() => setChg({ statut: '', motif: '' })}>Changer le statut</button>}
            </div>
            {onglet === 'infos' && !ferme && <button className="btn-add" onClick={enregistrer}>Enregistrer</button>}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function ProspectsPage() {
  const [data, setData] = useState(null);
  const [erreur, setErreur] = useState('');
  const [filtres, setFiltres] = useState({ recherche: '', statut: '', tri: 'created_at', ordre: 'desc', page: 1 });
  const [recherche, setRecherche] = useState('');
  const [nouveau, setNouveau] = useState(false);
  const [detail, setDetail] = useState(null);   // { id, envoi }

  const charger = useCallback(async () => {
    const p = new URLSearchParams({ ...filtres, taille: 20 });
    const r = await api.get(`/prospects?${p}`);
    if (r.error) { setErreur(r.error); return; }
    setErreur(''); setData(r);
  }, [filtres]);
  useEffect(() => { charger(); }, [charger]);
  // Recherche : petite temporisation pour ne pas interroger à chaque touche.
  useEffect(() => {
    const t = setTimeout(() => setFiltres((x) => (x.recherche === recherche ? x : { ...x, recherche, page: 1 })), 350);
    return () => clearTimeout(t);
  }, [recherche]);

  const filtrer = (k, v) => setFiltres((x) => ({ ...x, [k]: v, page: 1 }));
  const trier = (col) => setFiltres((x) => ({ ...x, tri: col, ordre: x.tri === col && x.ordre === 'asc' ? 'desc' : 'asc', page: 1 }));
  const fleche = (col) => (filtres.tri === col ? (filtres.ordre === 'asc' ? ' ▲' : ' ▼') : '');
  const pages = data ? Math.max(1, Math.ceil(data.total / data.taille)) : 1;
  const totalTous = useMemo(() => (data ? Object.values(data.compteurs).reduce((a, b) => a + b, 0) : 0), [data]);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>Prospects et démonstrations</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0 }}>
            Chaque prospect reçoit un espace de test isolé et vide, accessible par un lien d'activation personnel. L'accès se ferme automatiquement à la fin de la période ; rien n'est supprimé sans votre décision.
          </p>
        </div>
        <button className="btn-add" onClick={() => setNouveau(true)}>+ Nouveau prospect</button>
      </div>

      {erreur && <div className="alert-err" style={{ marginBottom: 10 }}>{erreur}</div>}
      {data && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button onClick={() => filtrer('statut', '')} className="btn-secondary" style={{ fontWeight: filtres.statut === '' ? 800 : 400 }}>Tous ({totalTous})</button>
          {Object.entries(STATUTS).map(([k, s]) => (
            <button key={k} onClick={() => filtrer('statut', filtres.statut === k ? '' : k)} className="btn-secondary"
              style={{ color: s.couleur, background: filtres.statut === k ? s.fond : undefined, fontWeight: filtres.statut === k ? 800 : 400 }}>
              {s.label} ({data.compteurs[k] || 0})
            </button>
          ))}
        </div>
      )}
      <input type="search" placeholder="🔍 Nom, entreprise, e-mail, téléphone, ville…" value={recherche} onChange={(e) => setRecherche(e.target.value)}
        style={{ ...champ, minWidth: 300, marginBottom: 10 }} />

      {!data ? <div className="loading-msg">Chargement…</div> : (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th style={{ cursor: 'pointer' }} onClick={() => trier('entreprise')}>Prospect{fleche('entreprise')}</th>
                <th>Contact</th><th>Lieu</th>
                <th style={{ cursor: 'pointer' }} onClick={() => trier('statut')}>Statut{fleche('statut')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => trier('demo_fin')}>Fin de démo{fleche('demo_fin')}</th>
                <th>E-mail d'accès</th><th>Dernière connexion</th>
                <th style={{ cursor: 'pointer' }} onClick={() => trier('created_at')}>Créé le{fleche('created_at')}</th>
              </tr></thead>
              <tbody>
                {data.items.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>Aucun prospect.</td></tr>}
                {data.items.map((p) => (
                  <tr key={p.id} onClick={() => setDetail({ id: p.id })} style={{ cursor: 'pointer' }} title="Voir le détail">
                    <td style={{ fontWeight: 700 }}>{p.entreprise || p.nom_complet}{p.entreprise && p.nom_complet && <div style={{ fontWeight: 400, fontSize: 12 }}>{p.nom_complet}</div>}</td>
                    <td style={{ fontSize: 12 }}>{p.email}<div style={{ color: 'var(--text-muted)' }}>{p.telephone}</div></td>
                    <td style={{ fontSize: 12 }}>{[p.ville, p.pays].filter(Boolean).join(', ') || '—'}</td>
                    <td><BadgeStatut statut={p.statut} /></td>
                    <td style={{ fontSize: 12 }}>{dateFr(p.demo_fin)}
                      {['DEMO_ACTIVE', 'INVITATION_ENVOYEE'].includes(p.statut) && joursRestants(p.demo_fin) <= 3 && <div style={{ color: '#c2410c', fontWeight: 700 }}>J-{Math.max(0, joursRestants(p.demo_fin))}</div>}</td>
                    <td style={{ fontSize: 12, color: ['non_envoye', 'adresse_invalide'].includes(p.statut_email) ? '#b91c1c' : undefined }}>{p.statut_email ? EMAILS[p.statut_email] : '—'}</td>
                    <td style={{ fontSize: 12 }}>{dateFr(p.derniere_connexion, true)}</td>
                    <td style={{ fontSize: 12 }}>{dateFr(p.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', marginTop: 10, fontSize: 13 }}>
              <button className="btn-secondary" disabled={filtres.page <= 1} onClick={() => setFiltres((x) => ({ ...x, page: x.page - 1 }))}>‹ Précédent</button>
              Page {filtres.page} / {pages} · {data.total} prospect(s)
              <button className="btn-secondary" disabled={filtres.page >= pages} onClick={() => setFiltres((x) => ({ ...x, page: x.page + 1 }))}>Suivant ›</button>
            </div>
          )}
        </>
      )}
      {nouveau && <NouveauProspect onClose={() => setNouveau(false)} onCree={(id, envoi) => { setNouveau(false); charger(); setDetail({ id, envoi }); }} />}
      {detail && <DetailProspect key={detail.id} id={detail.id} envoiInitial={detail.envoi} onClose={() => setDetail(null)} onChange={charger} />}
    </>
  );
}
