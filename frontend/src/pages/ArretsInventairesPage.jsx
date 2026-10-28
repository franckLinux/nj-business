import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { fmt } from '@/lib/format';

// Contrôle comptable → « Arrêtés & inventaires » (migration 046, 25/10/2026).
//
// • Arrêtés de caisse (26/10/2026) : l'arrêt est fait par le directeur ou le
//   comptable (journaux.arreter — ici ou depuis le journal) ; la VALIDATION,
//   sur la foi du PV scanné (solde constaté, écart, observation), est
//   réservée au directeur (arrets.valider). Un arrêté validé ne peut plus
//   être rouvert tant que le directeur n'a pas annulé la validation (motif).
// • Inventaires : constat des soldes de plusieurs journaux à une date, PV
//   scanné obligatoire, figé une fois validé.
// Aucune de ces actions n'écrit dans le journal, la passerelle ni les exports.

const MAX_PV = 5 * 1024 * 1024;
const TYPES_PV = 'application/pdf,image/jpeg,image/png,image/webp';
const TYPES = { caisse: 'Caisse', banque: 'Banque', om: 'Orange Money', momo: 'Mobile Money', carte_prepayee: 'Carte', autre: 'Autre' };
const ETATS = {
  non_arrete: { lib: 'Non arrêté', bg: '#f1f5f9', fg: '#475569' },
  a_valider: { lib: 'À valider', bg: '#fef3c7', fg: '#92400e' },
  validee: { lib: 'Validé', bg: '#dcfce7', fg: '#166534' },
};
const dateFr = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const dateHeure = (d) => (d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const taille = (o) => (o >= 1024 * 1024 ? `${(o / 1024 / 1024).toFixed(1)} Mo` : `${Math.max(1, Math.round(o / 1024))} Ko`);
const versSaisie = (n) => (n === null || n === undefined ? '' : String(n));
const lireMontant = (v) => {
  const t = String(v ?? '').replace(/[\s  ]/g, '').replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
const aujourdhui = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

// Lecture d'un fichier choisi → { nom_fichier, data_base64 } (contrôle de taille côté navigateur).
const lireFichier = (file) => new Promise((resolve, reject) => {
  if (!file) { reject(new Error('Aucun fichier choisi.')); return; }
  if (file.size > MAX_PV) { reject(new Error('PV trop volumineux (5 Mo au plus). Scannez en 150-200 dpi ou en PDF.')); return; }
  const r = new FileReader();
  r.onload = () => resolve({ nom_fichier: file.name, data_base64: String(r.result).split(',')[1] || '' });
  r.onerror = () => reject(new Error('Lecture du fichier impossible.'));
  r.readAsDataURL(file);
});

// Ouvre un PV protégé dans un nouvel onglet (lecture avec le jeton).
const ouvrirPv = async (url, toast) => {
  const w = window.open('', '_blank');
  const r = await api.fichier(url);
  if (r.error) { if (w) w.close(); toast(r.error, 'error', 7000); return; }
  const lien = URL.createObjectURL(r.blob);
  if (w) w.location.href = lien;
  else { const a = document.createElement('a'); a.href = lien; a.download = 'pv'; a.click(); }
  setTimeout(() => URL.revokeObjectURL(lien), 60000);
};

function Kv({ lib, children }) {
  return <div className="rf-kv"><span>{lib}</span><b>{children}</b></div>;
}
function Montant({ v, devise, signe = false }) {
  if (v === null || v === undefined) return <span className="muted">—</span>;
  const c = signe ? (Math.abs(v) < 0.005 ? '#15803d' : '#b91c1c') : v < 0 ? '#b91c1c' : undefined;
  return <span style={{ color: c, fontWeight: signe ? 700 : 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
    {v < 0 ? '− ' : signe && v > 0 ? '+ ' : ''}{fmt(Math.abs(v), devise)}</span>;
}
function BlocPv({ pv, peut, onFichier, enCours, lienPv }) {
  const toast = useToast();
  return (
    <div className="ai-pv">
      {pv ? (
        <div className="ai-pv-ok">
          <span>📎</span>
          <div style={{ minWidth: 0 }}>
            <button type="button" className="rf-ref" onClick={() => ouvrirPv(lienPv, toast)} title="Ouvrir le PV">{pv.nom}</button>
            <div className="muted" style={{ fontSize: 11 }}>{taille(pv.taille)} · déposé par {pv.depose_par || '?'} le {dateHeure(pv.depose_le)}</div>
            <div className="muted mono" style={{ fontSize: 10 }} title="Empreinte SHA-256 du fichier">SHA-256 {pv.sha256?.slice(0, 16)}…</div>
          </div>
        </div>
      ) : <div className="ctl-alerte rouge" style={{ margin: 0 }}>PV scanné non joint : il est obligatoire pour valider.</div>}
      {peut && (
        <label className={`ctl-btn mini${enCours ? ' disabled' : ''}`} style={{ marginTop: 6, width: 'fit-content' }}>
          {pv ? '↻ Remplacer le PV' : '📎 Joindre le PV scanné'}
          <input type="file" accept={TYPES_PV} hidden disabled={enCours}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFichier(f); }} />
        </label>
      )}
      <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>PDF, JPG, PNG ou WEBP — 5 Mo au plus. Le PV signé atteste le solde constaté.</div>
    </div>
  );
}

// ══ Arrêtés de caisse ════════════════════════════════════════════════════════
function ModaleArret({ l, mois, annee, devise, peutSaisir, peutValider, peutArreter, onFermer, onMaj }) {
  const toast = useToast();
  const verrou = l.etat === 'validee';
  const [constate, setConstate] = useState(versSaisie(l.solde_constate));
  const [obs, setObs] = useState(l.observation || '');
  const [motif, setMotif] = useState('');
  const [annulation, setAnnulation] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [commentaire, setCommentaire] = useState('');
  useEffect(() => { setConstate(versSaisie(l.solde_constate)); setObs(l.observation || ''); }, [l.solde_constate, l.observation]);
  const actif = peutSaisir && !verrou && l.etat === 'a_valider';
  const n = lireMontant(constate);
  const ecart = n === null || Number.isNaN(n) || l.solde_arrete === null ? null : Math.round((n - l.solde_arrete) * 100) / 100;
  const modifie = actif && (versSaisie(l.solde_constate) !== constate.trim() || (l.observation || '') !== obs);

  const envoyer = async (fn, ok) => {
    setEnCours(true);
    const r = await fn();
    setEnCours(false);
    if (r.error) { toast(r.error, 'error', 9000); return false; }
    onMaj(r.ligne);
    toast(r.message || ok, 'success', 3000);
    return true;
  };
  const corps = () => ({ mois, annee, solde_constate: constate, observation: obs });
  const enregistrer = () => {
    if (Number.isNaN(n)) { toast('Solde constaté invalide.', 'warning'); return; }
    envoyer(() => api.put(`/controle/arrets/${l.journal_id}`, corps()), 'Enregistré ✓');
  };
  const valider = () => {
    if (Number.isNaN(n)) { toast('Solde constaté invalide.', 'warning'); return; }
    envoyer(() => api.post(`/controle/arrets/${l.journal_id}/validation`, corps()), 'Arrêté validé ✓');
  };
  const joindre = async (f) => {
    try {
      const fichier = await lireFichier(f);
      // Les saisies en cours partent avec le PV pour ne pas être perdues.
      if (modifie && !Number.isNaN(n)) { const r = await api.put(`/controle/arrets/${l.journal_id}`, corps()); if (r.error) { toast(r.error, 'error', 9000); return; } }
      await envoyer(() => api.post(`/controle/arrets/${l.journal_id}/pv`, { mois, annee, ...fichier }), 'PV joint ✓');
    } catch (e) { toast(e.message, 'error', 7000); }
  };
  // Arrêt de caisse (26/10/2026) : directeur ou comptable (journaux.arreter).
  // Solde arrêté = solde calculé par le serveur.
  const arreter = async () => {
    if (!window.confirm(`Arrêter le journal ${l.journal_code} pour ${mois} ${annee} ? Plus aucune écriture ne pourra y être ajoutée, modifiée ou supprimée.`)) return;
    setEnCours(true);
    const r = await api.post(`/journaux/${l.journal_id}/arreter`, { mois, annee, commentaire: commentaire.trim() });
    setEnCours(false);
    if (r.error) { toast(r.error, 'error', 9000); return; }
    toast(`Caisse ${l.journal_code} arrêtée pour ${mois} ${annee} ✓`, 'success', 3000);
    setCommentaire('');
    onMaj();
  };
  const annuler = async () => {
    if (!motif.trim()) { toast('Le motif est obligatoire.', 'warning'); return; }
    if (await envoyer(() => api.post(`/controle/arrets/${l.journal_id}/annulation`, { mois, annee, motif }), 'Validation annulée')) { setAnnulation(false); setMotif(''); }
  };
  const bloquantsVivants = actif ? [
    !l.pv && 'PV scanné non joint',
    (constate.trim() === '' || Number.isNaN(n)) && 'Solde constaté non saisi',
    ecart !== null && Math.abs(ecart) >= 0.005 && !obs.trim() && 'Écart à justifier dans l\'observation',
    ...l.bloquants.filter((b) => !/PV|Solde constaté|Écart/.test(b)),
  ].filter(Boolean) : [];

  return (
    <div className="modal-overlay ctl-modale" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget && !enCours) onFermer(); }}>
      <div className="modal-box" style={{ maxWidth: 600 }} role="dialog" aria-label={`Arrêté ${l.journal_code}`}>
        <div className="modal-head">
          <h3>🔒 Arrêté {l.journal_code} — {mois} {annee}</h3>
          <button type="button" className="modal-close" onClick={onFermer}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'grid', gap: 12 }}>
          <div className="rf-recap">
            <Kv lib="Journal">{l.journal_code} – {l.journal_nom}{l.compte_tresorerie ? ` (${l.compte_tresorerie})` : ''}</Kv>
            {l.arret ? (
              <>
                <Kv lib="Arrêté le">{dateHeure(l.arret.arrete_le)} par {l.arret.arrete_par || '?'}</Kv>
                {l.arret.commentaire && <Kv lib="Commentaire">{l.arret.commentaire}</Kv>}
                <Kv lib="Solde arrêté"><Montant v={l.solde_arrete} devise={devise} /></Kv>
              </>
            ) : (
              <>
                <Kv lib="Arrêté">Caisse non arrêtée pour ce mois</Kv>
                <Kv lib="Solde à arrêter"><Montant v={l.solde_calcule} devise={devise} /></Kv>
              </>
            )}
            <Kv lib="Pièces du mois">{l.pieces.validees} / {l.pieces.total} validée(s) au contrôle de substance</Kv>
          </div>

          {l.caduc && <div className="ctl-alerte bleue">La caisse a été rouverte depuis la préparation de ce contrôle : vérifiez le solde constaté et le PV avant de valider.</div>}
          {l.etat === 'non_arrete' && (peutArreter ? (
            <div style={{ display: 'grid', gap: 6 }}>
              <label className="ctl-lbl" htmlFor="ai-com">Commentaire de l'arrêt (facultatif)</label>
              <input id="ai-com" className="ctl-in" maxLength={300} value={commentaire} onChange={(e) => setCommentaire(e.target.value)}
                placeholder="Ex. Arrêt de fin de mois, caisse comptée" />
              <div className="ctl-alerte" style={{ background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a' }}>
                L'arrêt <b>bloque toute nouvelle écriture</b> sur ce journal pour le mois. Le solde arrêté est le solde calculé du journal. La validation de l'arrêté revient ensuite au directeur.
              </div>
            </div>
          ) : <div className="ctl-alerte">Caisse non arrêtée. L'arrêt est fait par le directeur ou le comptable ; la validation sera possible ensuite.</div>)}

          {l.etat !== 'non_arrete' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 10 }}>
                <div>
                  <label className="ctl-lbl" htmlFor="ai-constate">Solde constaté (PV)</label>
                  <input id="ai-constate" className="ctl-in" inputMode="decimal" value={constate} disabled={!actif}
                    onChange={(e) => setConstate(e.target.value)} placeholder="Ex. 1 250 000" />
                </div>
                <div>
                  <span className="ctl-lbl">Écart (constaté − arrêté)</span>
                  <div style={{ padding: '8px 0', fontSize: 15 }}>{ecart === null ? <span className="muted">—</span> : <Montant v={ecart} devise={devise} signe />}</div>
                </div>
              </div>
              <div>
                <label className="ctl-lbl" htmlFor="ai-obs">Observation {ecart !== null && Math.abs(ecart) >= 0.005 && <span style={{ color: '#b91c1c' }}>(obligatoire : écart)</span>}</label>
                <textarea id="ai-obs" className="ctl-in" rows={3} maxLength={2000} value={obs} disabled={!actif} onChange={(e) => setObs(e.target.value)}
                  placeholder="Saisie manuelle : explication de l'écart, conditions du comptage…" />
              </div>
              <BlocPv pv={l.pv} peut={actif} enCours={enCours} onFichier={joindre} lienPv={l.controle_id ? `/controle/pv/arret/${l.controle_id}` : ''} />
            </>
          )}

          {verrou && (
            <div className="ctl-alerte verte">
              <b>✓ Arrêté validé</b> par {l.validation.par || '?'} le {dateHeure(l.validation.le)}. Il ne peut plus être rouvert ni ré-arrêté tant que la validation n'est pas annulée.
            </div>
          )}
          {l.derniere_annulation && !verrou && (
            <div className="muted" style={{ fontSize: 12 }}>Validation annulée le {dateHeure(l.derniere_annulation.le)} par {l.derniere_annulation.par || '?'} : « {l.derniere_annulation.motif} »</div>
          )}
          {actif && !peutValider && (
            <div className="ctl-alerte bleue">Vous pouvez préparer le contrôle (solde constaté, PV). <b>La validation de l'arrêté revient au directeur.</b></div>
          )}
          {actif && peutValider && bloquantsVivants.length > 0 && (
            <div className="ctl-alerte rouge"><b>Validation impossible pour l'instant</b>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{bloquantsVivants.map((b) => <li key={b}>{b}</li>)}</ul></div>
          )}
          {annulation && (
            <div style={{ display: 'grid', gap: 6 }}>
              <label className="ctl-lbl" htmlFor="ai-motif">Motif de l'annulation (obligatoire, tracé)</label>
              <textarea id="ai-motif" className="ctl-in" rows={2} maxLength={500} value={motif} onChange={(e) => setMotif(e.target.value)} autoFocus />
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn-ghost" onClick={onFermer}>Fermer</button>
          {actif && <button type="button" className="ctl-btn" disabled={enCours || !modifie} onClick={enregistrer}>Enregistrer</button>}
          {l.etat === 'non_arrete' && peutArreter && (
            <button type="button" className="btn-primary" style={{ width: 'auto', marginTop: 0, background: 'linear-gradient(135deg,#d97706,#b45309)', opacity: enCours ? 0.5 : 1 }}
              disabled={enCours} onClick={arreter}>🔒 Arrêter la caisse</button>
          )}
          {actif && peutValider && (
            <button type="button" className="btn-primary" style={{ width: 'auto', marginTop: 0, opacity: enCours || bloquantsVivants.length ? 0.5 : 1 }}
              disabled={enCours || bloquantsVivants.length > 0} onClick={valider}>✅ Confirmer la validation</button>
          )}
          {verrou && peutValider && !annulation && <button type="button" className="ctl-btn rouge" onClick={() => setAnnulation(true)}>↺ Annuler la validation</button>}
          {annulation && <button type="button" className="ctl-btn rouge" disabled={enCours || !motif.trim()} onClick={annuler}>Confirmer l'annulation</button>}
        </div>
      </div>
    </div>
  );
}

function OngletArrets({ mois, annee, devise, peutSaisir, peutValider, peutArreter }) {
  const [data, setData] = useState(null);
  const [erreur, setErreur] = useState('');
  const [selId, setSelId] = useState(null);
  const [filtre, setFiltre] = useState('');
  const charger = useCallback(async () => {
    const r = await api.get(`/controle/arrets?mois=${encodeURIComponent(mois)}&annee=${annee}`);
    if (r.error) { setErreur(r.error); setData(null); return; }
    setErreur(''); setData(r);
  }, [mois, annee]);
  useEffect(() => { setData(null); charger(); }, [charger]);
  const majLigne = () => charger();
  const lignes = (data?.lignes || []).filter((l) => !filtre || l.etat === filtre);
  const sel = data?.lignes.find((l) => l.journal_id === selId) || null;
  const r = data?.resume;

  if (erreur) return <div className="alert-err">{erreur}</div>;
  if (!data) return <div className="loading-msg">Chargement…</div>;
  return (
    <>
      <div className="rpc-kpis">
        {[['', 'Journaux', r.total, '#334155'], ['a_valider', 'À valider', r.a_valider, '#d97706'], ['validee', 'Validés', r.validees, '#10b981'], ['non_arrete', 'Non arrêtés', r.non_arretes, '#94a3b8']].map(([k, t, v, c]) => (
          <button key={t} type="button" className={`rpc-kpi ai-kpi${filtre === k && k ? ' on' : ''}`} style={{ borderTopColor: c, textAlign: 'left', cursor: 'pointer' }}
            onClick={() => setFiltre(filtre === k ? '' : k)} title={k ? 'Filtrer' : 'Tout afficher'}>
            <div className="rpc-kpi-t">{t}</div>
            <div className="rpc-kpi-v" style={{ color: c }}>{v}</div>
            {k === 'validee' && r.avec_ecart > 0 && <div className="rpc-kpi-s">{r.avec_ecart} avec écart</div>}
          </button>
        ))}
      </div>
      <section className="rpc-carte" style={{ padding: 0 }}>
        <div className="rpc-detail-tete">
          <h3 className="rpc-h3" style={{ margin: 0 }}>Arrêtés de caisse — {mois} {annee}</h3>
          {filtre && <button type="button" className="rpc-lien" onClick={() => setFiltre('')}>Tout afficher</button>}
        </div>
        <div className="table-wrap" style={{ border: 0, borderRadius: 0, margin: 0 }}>
          <table className="rpc-table">
            <thead><tr><th>Journal</th><th>Arrêté</th><th className="n">Solde arrêté</th><th className="n">Solde constaté</th><th className="n">Écart</th><th>PV</th><th>Statut</th><th /></tr></thead>
            <tbody>
              {lignes.length === 0 && <tr><td colSpan={8} className="ctl-vide">Aucun journal pour ce filtre.</td></tr>}
              {lignes.map((l) => {
                const st = ETATS[l.etat];
                return (
                  <tr key={l.journal_id} className={`cliquable${selId === l.journal_id ? ' sel' : ''}`} tabIndex={0}
                    onClick={() => setSelId(l.journal_id)} onKeyDown={(e) => { if (e.key === 'Enter') setSelId(l.journal_id); }}>
                    <td><b>{l.journal_code}</b> <span className="muted">{l.journal_nom}</span><div className="muted" style={{ fontSize: 11 }}>{TYPES[l.journal_type] || l.journal_type}</div></td>
                    <td>{l.arret ? <>{dateFr(l.arret.arrete_le)}<div className="muted" style={{ fontSize: 11 }}>{l.arret.arrete_par || '?'}</div></> : <span className="muted">—</span>}</td>
                    <td className="n">{l.etat === 'non_arrete'
                      ? <span className="muted" title="Solde calculé du journal (non arrêté)"><Montant v={l.solde_calcule} devise={devise} /></span>
                      : <Montant v={l.solde_arrete} devise={devise} />}</td>
                    <td className="n"><Montant v={l.solde_constate} devise={devise} /></td>
                    <td className="n">{l.ecart === null ? <span className="muted">—</span> : <Montant v={l.ecart} devise={devise} signe />}</td>
                    <td>{l.pv ? <span title={l.pv.nom}>📎</span> : l.etat === 'non_arrete' ? <span className="muted">—</span> : <span style={{ color: '#b91c1c', fontSize: 12 }}>manquant</span>}</td>
                    <td><span className="rpc-statut" style={{ background: st.bg, color: st.fg }}>{st.lib}</span>
                      {l.etat === 'validee' && <div className="muted" style={{ fontSize: 11 }}>{l.validation.par}, {dateFr(l.validation.le)}</div>}
                      {l.caduc && <div style={{ fontSize: 11, color: '#1d4ed8' }}>caisse rouverte</div>}</td>
                    <td>{l.etat === 'non_arrete' && peutArreter
                      ? <button type="button" className="ctl-btn mini" onClick={(e) => { e.stopPropagation(); setSelId(l.journal_id); }}>🔒 Arrêter</button>
                      : l.etat === 'a_valider' && (peutValider || peutSaisir)
                      ? <button type="button" className={`ctl-btn mini${peutValider && l.validable ? ' vert' : ''}`} onClick={(e) => { e.stopPropagation(); setSelId(l.journal_id); }}>
                          {peutValider ? (l.validable ? '✅ Valider' : 'Contrôler') : 'Préparer'}</button>
                      : <button type="button" className="rpc-lien" style={{ margin: 0 }} onClick={(e) => { e.stopPropagation(); setSelId(l.journal_id); }}>Détail</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
        Arrêt : directeur ou comptable. Validation : <b>directeur</b>, avec PV scanné joint, solde constaté saisi, écart justifié et solde arrêté conforme au journal.
        Un arrêté validé ne peut plus être rouvert : le directeur doit d'abord annuler la validation (motif obligatoire).
      </div>
      {sel && <ModaleArret l={sel} mois={mois} annee={annee} devise={devise} peutSaisir={peutSaisir} peutValider={peutValider} peutArreter={peutArreter}
        onFermer={() => setSelId(null)} onMaj={majLigne} />}
    </>
  );
}

// ══ Inventaires ══════════════════════════════════════════════════════════════
function ModaleNouvelInventaire({ journaux, onFermer, onCree }) {
  const toast = useToast();
  const [date, setDate] = useState(aujourdhui());
  const [libelle, setLibelle] = useState('');
  const [choix, setChoix] = useState(() => new Set(journaux.map((j) => j.id)));
  const [enCours, setEnCours] = useState(false);
  const basculer = (id) => setChoix((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const creer = async () => {
    if (!choix.size) { toast('Choisissez au moins un journal.', 'warning'); return; }
    setEnCours(true);
    const r = await api.post('/controle/inventaires', { date_inventaire: date, libelle, journal_ids: [...choix] });
    setEnCours(false);
    if (r.error) { toast(r.error, 'error', 8000); return; }
    toast(r.message || 'Inventaire créé ✓', 'success');
    onCree(r.inventaire);
  };
  return (
    <div className="modal-overlay ctl-modale" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onFermer(); }}>
      <div className="modal-box" style={{ maxWidth: 520 }} role="dialog" aria-label="Nouvel inventaire">
        <div className="modal-head"><h3>📦 Nouvel inventaire</h3><button type="button" className="modal-close" onClick={onFermer}>✕</button></div>
        <div className="modal-body" style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '160px minmax(0,1fr)', gap: 10 }}>
            <div><label className="ctl-lbl" htmlFor="ni-d">Date de l'inventaire</label>
              <input id="ni-d" type="date" className="ctl-in" value={date} max={aujourdhui()} onChange={(e) => setDate(e.target.value)} /></div>
            <div><label className="ctl-lbl" htmlFor="ni-l">Libellé</label>
              <input id="ni-l" className="ctl-in" maxLength={200} value={libelle} onChange={(e) => setLibelle(e.target.value)} placeholder="Ex. Inventaire de fin de mois" /></div>
          </div>
          <div>
            <span className="ctl-lbl">Journaux inventoriés</span>
            <div className="ai-choix">
              {journaux.map((j) => (
                <label key={j.id} className="rf-case"><input type="checkbox" checked={choix.has(j.id)} onChange={() => basculer(j.id)} /> <b>{j.code}</b> {j.nom}</label>
              ))}
              {journaux.length === 0 && <span className="muted">Aucun journal actif.</span>}
            </div>
          </div>
          <div className="muted" style={{ fontSize: 11.5 }}>Le solde théorique de chaque journal est calculé à la fin de la journée choisie. Vous saisirez ensuite les soldes constatés et joindrez le PV signé.</div>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn-ghost" onClick={onFermer}>Annuler</button>
          <button type="button" className="btn-primary" style={{ width: 'auto', marginTop: 0 }} disabled={enCours} onClick={creer}>Créer l'inventaire</button>
        </div>
      </div>
    </div>
  );
}

function ModaleInventaire({ id, devise, peutSaisir, peutRouvrir, onFermer, onMaj }) {
  const toast = useToast();
  const [inv, setInv] = useState(null);
  const [saisie, setSaisie] = useState({});   // journal_id → { constate, obs }
  const [ent, setEnt] = useState({ libelle: '', observation: '' });
  const [motif, setMotif] = useState('');
  const [reouv, setReouv] = useState(false);
  const [enCours, setEnCours] = useState(false);

  const appliquer = (i) => {
    setInv(i);
    setEnt({ libelle: i.libelle, observation: i.observation });
    setSaisie(Object.fromEntries(i.lignes.map((l) => [l.journal_id, { constate: versSaisie(l.solde_constate), obs: l.observation }])));
  };
  useEffect(() => {
    api.get(`/controle/inventaires/${id}`).then((r) => { if (r.error) { toast(r.error, 'error'); onFermer(); } else appliquer(r); });
  }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!inv) return <div className="modal-overlay ctl-modale" style={{ display: 'flex' }}><div className="modal-box"><div className="modal-body loading-msg">Chargement…</div></div></div>;
  const brouillon = inv.statut === 'brouillon';
  const actif = peutSaisir && brouillon;
  const lignesModifiees = inv.lignes.filter((l) => {
    const s = saisie[l.journal_id] || {};
    return versSaisie(l.solde_constate) !== String(s.constate ?? '').trim() || (l.observation || '') !== (s.obs || '');
  });
  const modifie = actif && (lignesModifiees.length > 0 || ent.libelle !== inv.libelle || ent.observation !== inv.observation);
  const invalides = inv.lignes.filter((l) => Number.isNaN(lireMontant(saisie[l.journal_id]?.constate)));
  const ecartDe = (l) => {
    const n = lireMontant(saisie[l.journal_id]?.constate);
    return n === null || Number.isNaN(n) || l.solde_theorique === null ? null : Math.round((n - l.solde_theorique) * 100) / 100;
  };
  const totaux = inv.lignes.reduce((t, l) => {
    const n = lireMontant(saisie[l.journal_id]?.constate);
    return { theo: t.theo + (l.solde_theorique || 0), cons: t.cons + (Number.isFinite(n) ? n : 0), ecart: t.ecart + (ecartDe(l) || 0) };
  }, { theo: 0, cons: 0, ecart: 0 });

  const envoyer = async (fn, ok) => {
    setEnCours(true);
    const r = await fn();
    setEnCours(false);
    if (r.error) { toast(r.error, 'error', 9000); return false; }
    if (r.inventaire) { appliquer(r.inventaire); onMaj(); }
    toast(r.message || ok, 'success', 3000);
    return true;
  };
  const corps = () => ({
    libelle: ent.libelle, observation: ent.observation,
    lignes: lignesModifiees.map((l) => ({ journal_id: l.journal_id, solde_constate: saisie[l.journal_id].constate, observation: saisie[l.journal_id].obs })),
  });
  const enregistrer = async () => {
    if (invalides.length) { toast(`Montant invalide : ${invalides.map((l) => l.journal_code).join(', ')}.`, 'warning'); return false; }
    return envoyer(() => api.put(`/controle/inventaires/${id}`, corps()), 'Enregistré ✓');
  };
  const valider = async () => {
    if (modifie && !(await enregistrer())) return;
    envoyer(() => api.post(`/controle/inventaires/${id}/validation`), 'Inventaire validé ✓');
  };
  const joindre = async (f) => {
    try {
      const fichier = await lireFichier(f);
      if (modifie && !(await enregistrer())) return;
      await envoyer(() => api.post(`/controle/inventaires/${id}/pv`, fichier), 'PV joint ✓');
    } catch (e) { toast(e.message, 'error', 7000); }
  };
  const rouvrir = async () => {
    if (!motif.trim()) { toast('Le motif est obligatoire.', 'warning'); return; }
    if (await envoyer(() => api.post(`/controle/inventaires/${id}/reouverture`, { motif }), 'Inventaire rouvert')) { setReouv(false); setMotif(''); }
  };
  const supprimer = async () => {
    if (!window.confirm('Supprimer cet inventaire en préparation ? (la trace reste dans le journal d\'audit)')) return;
    setEnCours(true);
    const r = await api.delete(`/controle/inventaires/${id}`);
    setEnCours(false);
    if (r.error) { toast(r.error, 'error', 8000); return; }
    toast('Inventaire supprimé', 'success'); onMaj(); onFermer();
  };
  const fermer = async () => {
    if (modifie && window.confirm('Enregistrer les modifications avant de fermer ?') && !(await enregistrer())) return;
    onFermer();
  };
  // Points bloquants recalculés sur la saisie en cours.
  const bloquants = actif ? [
    !inv.pv && 'PV d\'inventaire scanné non joint',
    inv.lignes.some((l) => String(saisie[l.journal_id]?.constate ?? '').trim() === '') && `Solde constaté non saisi : ${inv.lignes.filter((l) => String(saisie[l.journal_id]?.constate ?? '').trim() === '').map((l) => l.journal_code).join(', ')}`,
    inv.lignes.some((l) => { const e = ecartDe(l); return e !== null && Math.abs(e) >= 0.005 && !String(saisie[l.journal_id]?.obs || '').trim(); })
      && `Écart à justifier : ${inv.lignes.filter((l) => { const e = ecartDe(l); return e !== null && Math.abs(e) >= 0.005 && !String(saisie[l.journal_id]?.obs || '').trim(); }).map((l) => l.journal_code).join(', ')}`,
  ].filter(Boolean) : [];

  return (
    <div className="modal-overlay ctl-modale" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget && !enCours) fermer(); }}>
      <div className="modal-box" style={{ maxWidth: 920, width: '96vw' }} role="dialog" aria-label="Inventaire">
        <div className="modal-head">
          <h3>📦 Inventaire du {dateFr(inv.date_inventaire)}{inv.libelle ? ` — ${inv.libelle}` : ''}</h3>
          <button type="button" className="modal-close" onClick={fermer}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'grid', gap: 12 }}>
          <div className="muted" style={{ fontSize: 12 }}>
            Créé par {inv.cree.par || '?'} le {dateHeure(inv.cree.le)}
            {inv.validation && <> · <b style={{ color: '#15803d' }}>validé par {inv.validation.par || '?'} le {dateHeure(inv.validation.le)}</b></>}
            {inv.derniere_reouverture && <> · rouvert le {dateHeure(inv.derniere_reouverture.le)} par {inv.derniere_reouverture.par || '?'} : « {inv.derniere_reouverture.motif} »</>}
          </div>
          {actif && (
            <div><label className="ctl-lbl" htmlFor="inv-lib">Libellé</label>
              <input id="inv-lib" className="ctl-in" maxLength={200} value={ent.libelle} onChange={(e) => setEnt({ ...ent, libelle: e.target.value })} /></div>
          )}
          <div className="ai-table">
            <table className="rpc-table">
              <thead><tr><th>Journal</th><th className="n">Solde théorique</th><th className="n" style={{ minWidth: 140 }}>Solde constaté</th><th className="n">Écart</th><th style={{ minWidth: 200 }}>Observation</th></tr></thead>
              <tbody>
                {inv.lignes.map((l) => {
                  const s = saisie[l.journal_id] || {};
                  const e = ecartDe(l);
                  const obsRequise = e !== null && Math.abs(e) >= 0.005;
                  return (
                    <tr key={l.journal_id}>
                      <td><b>{l.journal_code}</b> <span className="muted">{l.journal_nom}</span><div className="muted" style={{ fontSize: 11 }}>{TYPES[l.journal_type] || l.journal_type}{l.compte_tresorerie ? ` · ${l.compte_tresorerie}` : ''}</div></td>
                      <td className="n"><Montant v={l.solde_theorique} devise={devise} /></td>
                      <td className="n">{actif
                        ? <input className={`ctl-in${String(s.constate ?? '').trim() === '' || Number.isNaN(lireMontant(s.constate)) ? ' vide' : ''}`} style={{ textAlign: 'right' }} inputMode="decimal"
                            value={s.constate ?? ''} onChange={(ev) => setSaisie({ ...saisie, [l.journal_id]: { ...s, constate: ev.target.value } })} aria-label={`Solde constaté ${l.journal_code}`} />
                        : <Montant v={l.solde_constate} devise={devise} />}</td>
                      <td className="n">{e === null ? <span className="muted">—</span> : <Montant v={e} devise={devise} signe />}</td>
                      <td>{actif
                        ? <input className={`ctl-in${obsRequise && !String(s.obs || '').trim() ? ' vide' : ''}`} maxLength={1000} value={s.obs || ''}
                            placeholder={obsRequise ? 'Obligatoire : justifiez l\'écart' : 'Facultatif'}
                            onChange={(ev) => setSaisie({ ...saisie, [l.journal_id]: { ...s, obs: ev.target.value } })} aria-label={`Observation ${l.journal_code}`} />
                        : (l.observation || <span className="muted">—</span>)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr><td>Total</td><td className="n"><Montant v={Math.round(totaux.theo * 100) / 100} devise={devise} /></td>
                <td className="n"><Montant v={Math.round(totaux.cons * 100) / 100} devise={devise} /></td>
                <td className="n"><Montant v={Math.round(totaux.ecart * 100) / 100} devise={devise} signe /></td><td /></tr></tfoot>
            </table>
          </div>
          <div>
            <label className="ctl-lbl" htmlFor="inv-obs">Observation générale</label>
            <textarea id="inv-obs" className="ctl-in" rows={2} maxLength={2000} value={ent.observation} disabled={!actif}
              onChange={(e) => setEnt({ ...ent, observation: e.target.value })} placeholder="Conditions de l'inventaire, personnes présentes…" />
          </div>
          <BlocPv pv={inv.pv} peut={actif} enCours={enCours} onFichier={joindre} lienPv={`/controle/pv/inventaire/${inv.id}`} />
          {brouillon && <div className="muted" style={{ fontSize: 11 }}>Tant que l'inventaire n'est pas validé, le solde théorique est recalculé à chaque ouverture ; il est figé à la validation.</div>}
          {actif && bloquants.length > 0 && (
            <div className="ctl-alerte rouge"><b>Validation impossible pour l'instant</b>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{bloquants.map((b) => <li key={b}>{b}</li>)}</ul></div>
          )}
          {reouv && (
            <div style={{ display: 'grid', gap: 6 }}>
              <label className="ctl-lbl" htmlFor="inv-motif">Motif de la réouverture (obligatoire, tracé)</label>
              <textarea id="inv-motif" className="ctl-in" rows={2} maxLength={500} value={motif} onChange={(e) => setMotif(e.target.value)} autoFocus />
            </div>
          )}
        </div>
        <div className="modal-foot">
          {actif && <button type="button" className="ctl-btn rouge" style={{ marginRight: 'auto' }} disabled={enCours} onClick={supprimer}>🗑 Supprimer</button>}
          <button type="button" className="btn-ghost" onClick={fermer}>Fermer</button>
          {actif && <button type="button" className="ctl-btn" disabled={enCours || !modifie} onClick={enregistrer}>Enregistrer</button>}
          {actif && (
            <button type="button" className="btn-primary" style={{ width: 'auto', marginTop: 0, opacity: enCours || bloquants.length ? 0.5 : 1 }}
              disabled={enCours || bloquants.length > 0} onClick={valider}>✅ Valider l'inventaire</button>
          )}
          {!brouillon && peutRouvrir && !reouv && <button type="button" className="ctl-btn rouge" onClick={() => setReouv(true)}>↺ Rouvrir</button>}
          {reouv && <button type="button" className="ctl-btn rouge" disabled={enCours || !motif.trim()} onClick={rouvrir}>Confirmer la réouverture</button>}
        </div>
      </div>
    </div>
  );
}

function OngletInventaires({ annee, devise, journaux, peutSaisir, peutRouvrir }) {
  const [liste, setListe] = useState(null);
  const [erreur, setErreur] = useState('');
  const [nouveau, setNouveau] = useState(false);
  const [ouvert, setOuvert] = useState(null);
  const [toutes, setToutes] = useState(false);
  const charger = useCallback(async () => {
    const r = await api.get(`/controle/inventaires${toutes ? '' : `?annee=${annee}`}`);
    if (r.error) { setErreur(r.error); setListe(null); return; }
    setErreur(''); setListe(Array.isArray(r) ? r : []);
  }, [annee, toutes]);
  useEffect(() => { charger(); }, [charger]);

  if (erreur) return <div className="alert-err">{erreur}</div>;
  return (
    <>
      <section className="rpc-carte" style={{ padding: 0 }}>
        <div className="rpc-detail-tete">
          <h3 className="rpc-h3" style={{ margin: 0 }}>Inventaires {toutes ? '— toutes les années' : annee}</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label className="rf-case"><input type="checkbox" checked={toutes} onChange={(e) => setToutes(e.target.checked)} /> Toutes les années</label>
            {peutSaisir && <button type="button" className="ctl-btn vert" onClick={() => setNouveau(true)}>+ Nouvel inventaire</button>}
          </div>
        </div>
        {!liste ? <div className="loading-msg">Chargement…</div> : (
          <div className="table-wrap" style={{ border: 0, borderRadius: 0, margin: 0 }}>
            <table className="rpc-table">
              <thead><tr><th>Date</th><th>Libellé</th><th>Journaux</th><th>Saisie</th><th className="n">Écart total</th><th>PV</th><th>Statut</th></tr></thead>
              <tbody>
                {liste.length === 0 && <tr><td colSpan={7} className="ctl-vide">Aucun inventaire{peutSaisir ? ' — « + Nouvel inventaire » pour en commencer un.' : '.'}</td></tr>}
                {liste.map((i) => (
                  <tr key={i.id} className={`cliquable${ouvert === i.id ? ' sel' : ''}`} tabIndex={0} onClick={() => setOuvert(i.id)} onKeyDown={(e) => { if (e.key === 'Enter') setOuvert(i.id); }}>
                    <td><b>{dateFr(i.date_inventaire)}</b></td>
                    <td>{i.libelle || <span className="muted">—</span>}<div className="muted" style={{ fontSize: 11 }}>par {i.cree.par || '?'}</div></td>
                    <td className="mono" style={{ fontSize: 12 }}>{i.journaux}</td>
                    <td>{i.nb_saisis} / {i.nb_journaux}</td>
                    <td className="n">{i.ecart_total === null ? <span className="muted">—</span> : <Montant v={i.ecart_total} devise={devise} signe />}</td>
                    <td>{i.pv ? '📎' : <span style={{ color: '#b91c1c', fontSize: 12 }}>manquant</span>}</td>
                    <td>{i.statut === 'valide'
                      ? <><span className="rpc-statut" style={{ background: '#dcfce7', color: '#166534' }}>Validé</span><div className="muted" style={{ fontSize: 11 }}>{i.validation?.par}, {dateFr(i.validation?.le)}</div></>
                      : <span className="rpc-statut" style={{ background: '#fef3c7', color: '#92400e' }}>En préparation</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
        Validation : PV d'inventaire scanné joint, solde constaté saisi pour chaque journal, chaque écart justifié. Un inventaire validé est figé ; sa réouverture exige un motif.
      </div>
      {nouveau && <ModaleNouvelInventaire journaux={journaux} onFermer={() => setNouveau(false)}
        onCree={(i) => { setNouveau(false); charger(); setOuvert(i.id); }} />}
      {ouvert && <ModaleInventaire key={ouvert} id={ouvert} devise={devise} peutSaisir={peutSaisir} peutRouvrir={peutRouvrir}
        onFermer={() => setOuvert(null)} onMaj={charger} />}
    </>
  );
}

export default function ArretsInventairesPage() {
  const { mois, annee, devise, can, journauxGrouped } = useApp();
  const [onglet, setOnglet] = useState('arrets');
  const peutSaisir = can('controle.saisir');
  const peutRouvrir = can('controle.reouvrir');
  // 26/10/2026 : le directeur arrête et valide ; le comptable arrête seulement.
  const peutValider = can('arrets.valider');
  const peutArreter = can('journaux.arreter');
  const journaux = useMemo(() => Object.values(journauxGrouped || {}).flat().filter((j) => j.actif !== false)
    .sort((a, b) => String(a.code).localeCompare(String(b.code))), [journauxGrouped]);
  return (
    <div>
      <div className="rf-onglets" role="tablist" aria-label="Arrêtés et inventaires">
        {[['arrets', '🔒 Arrêtés de caisse'], ['inventaires', '📦 Inventaires']].map(([id, lib]) => (
          <button key={id} type="button" role="tab" aria-selected={onglet === id} className={onglet === id ? 'on' : ''} onClick={() => setOnglet(id)}>{lib}</button>
        ))}
      </div>
      {onglet === 'arrets'
        ? <OngletArrets mois={mois} annee={annee} devise={devise} peutSaisir={peutSaisir} peutValider={peutValider} peutArreter={peutArreter} />
        : <OngletInventaires annee={annee} devise={devise} journaux={journaux} peutSaisir={peutSaisir} peutRouvrir={peutRouvrir} />}
    </div>
  );
}
