import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { fmt } from '@/lib/format';
import { useToast } from '@/context/ToastContext';

// Contrôle de régularité formelle (migration 045) : anomalies constatées
// saisies à la main, « Confirmer la validation », réouverture motivée,
// historique. Partagé par le sous-onglet « Contrôle de régularité formelle »
// et la fiche de contrôle. Aucune de ces actions ne touche au journal, à
// l'arrêté de caisse, aux exports ni à la passerelle.
const dateFr = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const dateHeure = (d) => (d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');

// ── Anomalies constatées (saisie manuelle) ───────────────────────────────────
export function AnomaliesSaisies({ l, peutSaisir, onMaj, compact = false }) {
  const toast = useToast();
  const [libelle, setLibelle] = useState('');
  const [bloquante, setBloquante] = useState(false);
  const [edition, setEdition] = useState(null);   // { id, libelle, bloquante }
  const [levee, setLevee] = useState(null);       // { id, motif }
  const [enCours, setEnCours] = useState(false);
  const verrou = l.statut === 'controle';
  const actif = peutSaisir && !verrou;

  const envoyer = async (appelApi, ok) => {
    setEnCours(true);
    const r = await appelApi();
    setEnCours(false);
    if (r.error) { toast(r.error, 'error', 7000); return false; }
    onMaj(r.piece);
    if (ok) toast(ok, 'success', 2500);
    return true;
  };
  const ajouter = async () => {
    if (!libelle.trim()) return;
    if (await envoyer(() => api.post(`/controle/pieces/${l.id}/anomalies`, { libelle, bloquante }), 'Anomalie enregistrée ✓')) { setLibelle(''); setBloquante(false); }
  };
  const modifier = async () => {
    if (await envoyer(() => api.put(`/controle/anomalies/${edition.id}`, { libelle: edition.libelle, bloquante: edition.bloquante }), 'Anomalie modifiée ✓')) setEdition(null);
  };
  const lever = async () => {
    if (await envoyer(() => api.post(`/controle/anomalies/${levee.id}/levee`, { motif: levee.motif }), 'Anomalie levée ✓')) setLevee(null);
  };

  const liste = l.anomalies_saisies || [];
  return (
    <div className="rf-anoms">
      {liste.length === 0 && <div className="muet" style={{ fontSize: 12 }}>Aucune anomalie constatée.</div>}
      {liste.map((a) => (
        <div key={a.id} className={`rf-anom ${a.statut === 'levee' ? 'levee' : a.bloquante ? 'bloq' : ''}`}>
          {edition?.id === a.id ? (
            <div style={{ display: 'grid', gap: 6 }}>
              <textarea className="ctl-in" rows={2} value={edition.libelle} maxLength={500} onChange={(e) => setEdition({ ...edition, libelle: e.target.value })} />
              <label className="rf-case"><input type="checkbox" checked={edition.bloquante} onChange={(e) => setEdition({ ...edition, bloquante: e.target.checked })} /> Bloquante</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="ctl-btn mini vert" disabled={enCours || !edition.libelle.trim()} onClick={modifier}>Enregistrer</button>
                <button type="button" className="ctl-btn mini" onClick={() => setEdition(null)}>Annuler</button>
              </div>
            </div>
          ) : (
            <>
              <div className="rf-anom-lib">
                {a.statut === 'levee' ? '✓ ' : a.bloquante ? '⛔ ' : '⚠ '}{a.libelle}
                {a.bloquante && a.statut === 'ouverte' && <span className="rf-badge rouge">bloquante</span>}
                {a.statut === 'levee' && <span className="rf-badge">levée</span>}
              </div>
              {!compact && (
                <div className="rf-anom-meta">
                  Constatée par {a.cree_par || '?'} le {dateHeure(a.cree_le)}{a.modifie_le ? ` · modifiée le ${dateHeure(a.modifie_le)}` : ''}
                  {a.statut === 'levee' && <> · levée par {a.levee_par || '?'} le {dateHeure(a.levee_le)} : « {a.motif_levee} »</>}
                </div>
              )}
              {actif && a.statut === 'ouverte' && levee?.id !== a.id && (
                <div style={{ display: 'flex', gap: 10, marginTop: 3 }}>
                  <button type="button" className="rpc-lien" style={{ margin: 0, padding: 0 }} onClick={() => setEdition({ id: a.id, libelle: a.libelle, bloquante: a.bloquante })}>✎ Modifier</button>
                  <button type="button" className="rpc-lien" style={{ margin: 0, padding: 0 }} onClick={() => setLevee({ id: a.id, motif: '' })}>✓ Lever</button>
                </div>
              )}
              {levee?.id === a.id && (
                <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
                  <input className="ctl-in" autoFocus value={levee.motif} maxLength={500} onChange={(e) => setLevee({ ...levee, motif: e.target.value })}
                    placeholder="Motif de la levée (corrigée, justifiée…)" onKeyDown={(e) => { if (e.key === 'Enter' && levee.motif.trim()) lever(); }} />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" className="ctl-btn mini vert" disabled={enCours || !levee.motif.trim()} onClick={lever}>Lever l'anomalie</button>
                    <button type="button" className="ctl-btn mini" onClick={() => setLevee(null)}>Annuler</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ))}
      {actif && (
        <div className="rf-ajout">
          <textarea className="ctl-in" rows={2} value={libelle} maxLength={500} onChange={(e) => setLibelle(e.target.value)}
            placeholder="Anomalie constatée (saisie manuelle) : imputation, libellé, tiers, date…" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label className="rf-case" title="Une anomalie bloquante empêche la validation tant qu'elle n'est pas levée.">
              <input type="checkbox" checked={bloquante} onChange={(e) => setBloquante(e.target.checked)} /> Bloquante (empêche la validation)
            </label>
            <button type="button" className="ctl-btn mini" style={{ marginLeft: 'auto' }} disabled={enCours || !libelle.trim()} onClick={ajouter}>+ Ajouter l'anomalie</button>
          </div>
        </div>
      )}
      {verrou && peutSaisir && <div className="muet" style={{ fontSize: 11.5, marginTop: 4 }}>Pièce validée : rouvrez-la pour modifier ses anomalies.</div>}
    </div>
  );
}

// ── Historique du contrôle (traçabilité) ─────────────────────────────────────
export function HistoriqueControle({ id }) {
  const [h, setH] = useState(null);
  const [ouvert, setOuvert] = useState(false);
  useEffect(() => {
    if (!ouvert) return undefined;
    let annule = false;
    api.get(`/controle/pieces/${id}/historique`).then((r) => { if (!annule) setH(Array.isArray(r) ? r : []); });
    return () => { annule = true; };
  }, [ouvert, id]);
  const detail = (x) => {
    const ap = x.apres || {};
    if (x.action === 'CONTROLE_REOUVERTURE') return `motif : « ${ap.motif || ''} »`;
    if (x.action === 'CONTROLE_ANOMALIE_LEVEE') return `« ${x.avant?.libelle || ''} » — ${ap.motif || ''}`;
    if (x.action.startsWith('CONTROLE_ANOMALIE')) return `« ${ap.libelle || ''} »${ap.bloquante ? ' (bloquante)' : ''}`;
    if (x.action === 'CONTROLE_COMPTE_CORRIGE') return `compte ${ap.compte_retenu || ap.compte_corrige || '—'}`;
    if (x.action === 'CONTROLE_VALIDATION') return ap.observation ? `observation : « ${ap.observation} »` : '';
    return ap.statut ? `statut ${ap.statut}` : '';
  };
  return (
    <div className="ctl-sec">
      <button type="button" className="rpc-lien" style={{ margin: 0, padding: 0, fontSize: 12 }} onClick={() => setOuvert(!ouvert)}>
        {ouvert ? '▾' : '▸'} Historique du contrôle
      </button>
      {ouvert && (
        <div className="rf-histo">
          {h === null && <div className="muet">Chargement…</div>}
          {h && h.length === 0 && <div className="muet">Aucune action enregistrée.</div>}
          {(h || []).map((x, i) => (
            <div key={i}><b>{x.libelle}</b> — {x.par || '?'}, {dateHeure(x.le)}{detail(x) && <div className="muet">{detail(x)}</div>}</div>
          ))}
        </div>
      )}
    </div>
  );
}

const Ligne = ({ lib, children }) => <div className="rf-kv"><span>{lib}</span><b>{children}</b></div>;

// ── « Confirmer la validation » : dernière vérification avant validation ──────
export function ModaleValidation({ l, devise, onFermer, onValidee }) {
  const toast = useToast();
  const [observation, setObservation] = useState(l.observation || '');
  const [enCours, setEnCours] = useState(false);
  // Points relevés non bloquants : signalés seulement (24/10/2026).
  const signales = l.anomalies.filter((a) => !['compte_manquant', 'nom_manquant'].includes(a));
  const ouvertes = (l.anomalies_saisies || []).filter((a) => a.statut === 'ouverte');
  const confirmer = async () => {
    setEnCours(true);
    const r = await api.post(`/controle/pieces/${l.id}/validation`, { observation });
    setEnCours(false);
    if (r.error) { toast(r.error, 'error', 9000); return; }
    toast(r.message || 'Pièce validée ✓', 'success', 3000);
    onValidee(r.piece);
  };
  return (
    <div className="modal-overlay ctl-modale" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onFermer(); }}>
      <div className="modal-box" style={{ maxWidth: 560 }} role="dialog" aria-label={`Confirmer la validation de la pièce ${l.reference}`}>
        <div className="modal-head"><h3>Confirmer la validation — {l.reference}</h3><button type="button" className="modal-close" onClick={onFermer}>✕</button></div>
        <div className="modal-body">
          <div className="rf-recap">
            <Ligne lib="Journal">{l.journal_code}{l.journal_nom ? ` – ${l.journal_nom}` : ''}</Ligne>
            <Ligne lib="Date">{dateFr(l.date)}</Ligne>
            <Ligne lib="Libellé">{l.libelle || '—'}</Ligne>
            <Ligne lib="Bénéficiaire">{l.virement ? 'Virement interne' : (l.tiers_nom || '—')}{l.tiers_nui ? ` · ${l.tiers_nui}` : ''}</Ligne>
            <Ligne lib="Montant"><span style={{ color: l.debit ? '#b91c1c' : '#15803d' }}>{l.debit ? `− ${fmt(l.debit, devise)}` : `+ ${fmt(l.credit, devise)}`}</span></Ligne>
            <Ligne lib="Code comptable">{l.compte || <span style={{ color: '#b91c1c' }}>manquant</span>}{l.compte_etat === 'corrige' ? ' (corrigé)' : ''} ↔ {l.compte_tresorerie || '?'}</Ligne>
            {!l.virement && <Ligne lib="Compte tiers">{l.compte_tiers || '—'}</Ligne>}
          </div>
          {l.bloquants.length > 0 ? (
            <div className="ctl-alerte rouge" style={{ marginTop: 12 }}>
              <b>Validation impossible</b>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{l.bloquants.map((b) => <li key={b}>{b}</li>)}</ul>
              <div style={{ marginTop: 4 }}>Corrigez ces points (code comptable, tiers, anomalie levée) puis revenez confirmer.</div>
            </div>
          ) : (
            <>
              {(ouvertes.length > 0 || signales.length > 0) && (
                <div className="ctl-alerte" style={{ marginTop: 12, background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a' }}>
                  {ouvertes.length > 0 && <div><b>Anomalies constatées non bloquantes ({ouvertes.length})</b> : {ouvertes.map((a) => a.libelle).join(' ; ')}</div>}
                  {signales.length > 0 && <div style={{ marginTop: ouvertes.length ? 4 : 0 }}><b>Points signalés (non bloquants)</b> : {l.anomalies_libelles.filter((x, i) => signales.includes(l.anomalies[i])).join(', ')}.</div>}
                </div>
              )}
              <label style={{ marginTop: 12 }}>Observation</label>
              <textarea className="ctl-in" rows={3} value={observation} maxLength={2000} onChange={(e) => setObservation(e.target.value)}
                placeholder="Saisie manuelle (facultative)" />
              <div className="muet" style={{ fontSize: 11.5, marginTop: 8 }}>
                La validation enregistre votre nom et la date. Elle ne déclenche ni l'arrêté de caisse, ni l'export, ni la passerelle comptable.
              </div>
            </>
          )}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn-ghost" onClick={onFermer}>Annuler</button>
          {l.bloquants.length === 0 && (
            <button type="button" className="btn-primary" style={{ width: 'auto', marginTop: 0, opacity: enCours ? 0.5 : 1 }}
              disabled={enCours} onClick={confirmer}>
              ✅ Confirmer la validation
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Réouverture d'une pièce validée (motif obligatoire) ──────────────────────
export function ModaleReouverture({ l, onFermer, onRouverte }) {
  const toast = useToast();
  const [motif, setMotif] = useState('');
  const [enCours, setEnCours] = useState(false);
  const rouvrir = async () => {
    setEnCours(true);
    const r = await api.post(`/controle/pieces/${l.id}/reouverture`, { motif });
    setEnCours(false);
    if (r.error) { toast(r.error, 'error', 8000); return; }
    toast(r.message || 'Pièce rouverte', 'success', 3000);
    onRouverte(r.piece);
  };
  return (
    <div className="modal-overlay ctl-modale" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onFermer(); }}>
      <div className="modal-box" style={{ maxWidth: 480 }} role="dialog" aria-label={`Rouvrir la pièce ${l.reference}`}>
        <div className="modal-head"><h3>Rouvrir la pièce {l.reference}</h3><button type="button" className="modal-close" onClick={onFermer}>✕</button></div>
        <div className="modal-body">
          <div style={{ fontSize: 13 }}>Validée par <b>{l.controle_par || '?'}</b> le {dateHeure(l.controle_le)}.</div>
          <label style={{ marginTop: 12 }}>Motif de la réouverture *</label>
          <textarea className="ctl-in" rows={3} autoFocus value={motif} maxLength={500} onChange={(e) => setMotif(e.target.value)} placeholder="Ex. imputation à revoir, anomalie découverte après validation…" />
          <div className="muet" style={{ fontSize: 11.5, marginTop: 8 }}>La validation est annulée (tracée) ; la pièce redevient modifiable.</div>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn-ghost" onClick={onFermer}>Annuler</button>
          <button type="button" className="btn-primary" style={{ width: 'auto', marginTop: 0, background: '#b45309' }} disabled={enCours || !motif.trim()} onClick={rouvrir}>↺ Rouvrir</button>
        </div>
      </div>
    </div>
  );
}

// ── Anomalies d'une pièce (depuis la colonne « Contrôle ») ───────────────────
export function ModaleAnomalies({ l, peutSaisir, onFermer, onMaj }) {
  return (
    <div className="modal-overlay ctl-modale" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onFermer(); }}>
      <div className="modal-box" style={{ maxWidth: 560 }} role="dialog" aria-label={`Anomalies de la pièce ${l.reference}`}>
        <div className="modal-head"><h3>Contrôle — {l.reference}</h3><button type="button" className="modal-close" onClick={onFermer}>✕</button></div>
        <div className="modal-body">
          <div style={{ fontSize: 12.5, marginBottom: 10 }}><b>{l.libelle}</b> · {dateFr(l.date)} · {l.journal_code}</div>
          {l.anomalies.length > 0 && (
            <div className="ctl-alerte" style={{ marginBottom: 10, background: '#f8fafc', color: '#334155', border: '1px solid var(--border)' }}>
              <b>Points relevés automatiquement</b> : {l.anomalies_libelles.join(', ')}
            </div>
          )}
          <div className="ctl-sec-titre">Anomalies constatées</div>
          <AnomaliesSaisies l={l} peutSaisir={peutSaisir} onMaj={onMaj} />
          <HistoriqueControle id={l.id} />
        </div>
        <div className="modal-foot"><button type="button" className="btn-ghost" onClick={onFermer}>Fermer</button></div>
      </div>
    </div>
  );
}
