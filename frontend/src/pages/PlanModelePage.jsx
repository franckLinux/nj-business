import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import PlanSynchroPanel from '@/components/PlanSynchroPanel';

// Administration du MODÈLE GLOBAL de plan comptable (réforme du plan, étape 6).
// Réservé au super_admin (route gardée dans App.jsx, API en requireRole).
// Les modifications restent « non publiées » : aucun client ne les voit tant
// qu'une nouvelle version n'est pas publiée, et une publication ne s'applique
// qu'aux NOUVEAUX clients (synchronisation des clients existants : étape 7).

const NATURES = [
  { val: '', label: '— Non définie —' },
  { val: 'actif', label: 'Actif' },
  { val: 'passif', label: 'Passif' },
  { val: 'charge', label: 'Charge' },
  { val: 'produit', label: 'Produit' },
  { val: 'tresorerie', label: 'Trésorerie' },
  { val: 'hors_activites_ordinaires', label: 'HAO' },
];
const STATUTS = {
  actif:   { label: 'Actif',   bg: '#dcfce7', fg: '#15803d' },
  inactif: { label: 'Inactif', bg: '#fef3c7', fg: '#b45309' },
  archive: { label: 'Archivé', bg: '#e2e8f0', fg: '#475569' },
};
const ETATS = {
  publie:  { label: 'Publié',      bg: '#f1f5f9', fg: '#64748b' },
  modifie: { label: 'Modifié',     bg: '#ffedd5', fg: '#c2410c' },
  nouveau: { label: 'Non publié',  bg: '#ede9fe', fg: '#6d28d9' },
};
const ACTIONS = {
  AJOUT: 'Ajout', MODIFICATION: 'Modification', ACTIVATION: 'Réactivation',
  DESACTIVATION: 'Désactivation', ARCHIVAGE: 'Archivage',
};
const NOMS = { compte: 'numéro', intitule: 'intitulé', description: 'description', classe: 'classe', nature: 'nature', parent_compte: 'parent', statut: 'statut' };
const MAX = 500;

const Badge = ({ m }) => (
  <span style={{ background: m.bg, color: m.fg, padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>{m.label}</span>
);

function CompteModal({ compte: c, onClose, onSaved }) {
  const creation = !c;
  const [f, setF] = useState({
    compte: c?.compte || '', intitule: c?.intitule || '', description: c?.description || '',
    classe: c?.classe ?? '', nature: c?.nature || '', parent_compte: c?.parent_compte || '',
  });
  const [erreur, setErreur] = useState('');
  const [saving, setSaving] = useState(false);
  const numeroModifiable = creation || (c.etat_publication === 'nouveau' && !c.nb_clients);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const onSave = async () => {
    if (!f.compte.trim() || !f.intitule.trim()) { setErreur('Numéro et intitulé obligatoires.'); return; }
    setSaving(true);
    const body = { ...f, classe: f.classe === '' ? null : Number(f.classe) };
    if (!numeroModifiable) delete body.compte;
    const res = creation ? await api.post('/plan-modele/comptes', body) : await api.put(`/plan-modele/comptes/${c.id}`, body);
    setSaving(false);
    if (res.error) { setErreur(res.error); return; }
    onSaved(creation ? `Compte ${f.compte} ajouté au modèle (non publié).` : `Compte ${res.compte || c.compte} modifié (non publié).`);
  };

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 560 }}>
        <div className="modal-head">
          <h3>{creation ? '➕ Nouveau compte du modèle' : `✏️ Compte ${c.compte}`}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className="form-section">
              <label>Numéro <span className="req">*</span></label>
              <input value={f.compte} onChange={set('compte')} disabled={!numeroModifiable} maxLength={30}
                style={{ fontFamily: 'monospace', fontWeight: 700, background: numeroModifiable ? undefined : '#f8fafc' }} />
              {!numeroModifiable && <span className="field-hint">Déjà publié ou présent chez des clients : verrouillé.</span>}
            </div>
            <div className="form-section">
              <label>Compte parent</label>
              <input value={f.parent_compte} onChange={set('parent_compte')} placeholder="Auto (préfixe)" maxLength={30} style={{ fontFamily: 'monospace' }} />
            </div>
          </div>
          <div className="form-section">
            <label>Intitulé <span className="req">*</span></label>
            <input value={f.intitule} onChange={set('intitule')} maxLength={300} />
          </div>
          <div className="form-section">
            <label>Description</label>
            <textarea value={f.description} onChange={set('description')} rows={2} maxLength={1000} style={{ width: '100%', resize: 'vertical' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className="form-section">
              <label>Classe</label>
              <select value={f.classe} onChange={set('classe')}>
                <option value="">Auto (1er chiffre)</option>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => <option key={k} value={k}>Classe {k}</option>)}
              </select>
            </div>
            <div className="form-section">
              <label>Type (nature)</label>
              <select value={f.nature} onChange={set('nature')}>
                {NATURES.map((n) => <option key={n.val} value={n.val}>{n.label}</option>)}
              </select>
            </div>
          </div>
          {erreur && <div className="alert-err" style={{ marginTop: 10 }}>{erreur}</div>}
        </div>
        <div className="modal-foot" style={{ gap: 10 }}>
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-add" onClick={onSave} disabled={saving}>{creation ? 'Ajouter' : 'Enregistrer'}</button>
        </div>
      </div>
    </div>
  );
}

function HistoriqueModal({ compte: c, onClose }) {
  const [lignes, setLignes] = useState(null);
  useEffect(() => {
    api.get(`/plan-modele/comptes/${c.id}/historique`).then((r) => setLignes(Array.isArray(r) ? r : []));
  }, [c.id]);
  const resume = (v) => (v ? Object.entries(v).filter(([k]) => NOMS[k]).map(([k, x]) => `${NOMS[k]} : ${x ?? '—'}`).join(' · ') : '');
  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 620 }}>
        <div className="modal-head"><h3>🕘 Historique du compte {c.compte}</h3><button className="modal-close" onClick={onClose}>✕</button></div>
        <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {!lignes && <div className="loading-msg">Chargement…</div>}
          {lignes && lignes.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Aucune modification depuis le chargement du référentiel.</p>}
          {lignes && lignes.map((h, i) => (
            <div key={i} style={{ borderBottom: '1px solid #f1f5f9', padding: '10px 0' }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>
                {ACTIONS[h.action] || h.action}
                <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8, fontSize: 12 }}>
                  {new Date(h.created_at).toLocaleString('fr-FR')}{h.username ? ` · ${h.username}` : ''}
                </span>
              </div>
              {h.ancienne_valeur && <div style={{ fontSize: 12, color: '#b91c1c' }}>Avant : {resume(h.ancienne_valeur)}</div>}
              {h.nouvelle_valeur && <div style={{ fontSize: 12, color: '#15803d' }}>Après : {resume(h.nouvelle_valeur)}</div>}
            </div>
          ))}
        </div>
        <div className="modal-foot"><button className="btn-secondary" onClick={onClose}>Fermer</button></div>
      </div>
    </div>
  );
}

function PublierModal({ onClose, onDone }) {
  const [apercu, setApercu] = useState(null);
  const [libelle, setLibelle] = useState('');
  const [notes, setNotes] = useState('');
  const [erreur, setErreur] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { api.get('/plan-modele/apercu').then((r) => (r.error ? setErreur(r.error) : setApercu(r))); }, []);

  const onPublier = async () => {
    if (!window.confirm('Publier une nouvelle version du modèle ?\n\nElle s\'appliquera aux NOUVEAUX clients. Les clients existants ne seront pas modifiés.')) return;
    setSaving(true);
    const res = await api.post('/plan-modele/versions/publier', { libelle, notes });
    setSaving(false);
    if (res.error) { setErreur(res.error); return; }
    onDone(`Version ${res.code} publiée (${res.nb_comptes} comptes).`);
  };

  const Liste = ({ titre, items, couleur, rendu }) => (items.length === 0 ? null : (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: couleur, marginBottom: 4 }}>{titre} ({items.length})</div>
      <div style={{ maxHeight: 140, overflowY: 'auto', fontSize: 12, background: '#f8fafc', borderRadius: 8, padding: '6px 10px' }}>
        {items.map((x) => <div key={x.id}>{rendu(x)}</div>)}
      </div>
    </div>
  ));

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 620 }}>
        <div className="modal-head"><h3>🚀 Publier une nouvelle version</h3><button className="modal-close" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          {!apercu && !erreur && <div className="loading-msg">Calcul des différences…</div>}
          {apercu && (
            <>
              <p style={{ fontSize: 13, marginTop: 0 }}>
                Différences avec la version publiée <strong>{apercu.version_publiee?.code || '—'}</strong> :
                {apercu.total === 0 && ' aucune — rien à publier.'}
              </p>
              <Liste titre="Comptes ajoutés" couleur="#6d28d9" items={apercu.ajoutes} rendu={(x) => <><code>{x.compte}</code> {x.intitule}</>} />
              <Liste titre="Comptes modifiés" couleur="#c2410c" items={apercu.modifies}
                rendu={(x) => <><code>{x.compte}</code> {x.ancien_intitule !== x.intitule ? <>« {x.ancien_intitule} » → « {x.intitule} »</> : x.intitule}{x.ancien_statut !== x.statut ? ` (${x.ancien_statut} → ${x.statut})` : ''}</>} />
              <Liste titre="Comptes archivés" couleur="#475569" items={apercu.archives} rendu={(x) => <><code>{x.compte}</code> {x.intitule}</>} />
              {apercu.total > 0 && (
                <>
                  <div className="form-section">
                    <label>Libellé de la version</label>
                    <input value={libelle} onChange={(e) => setLibelle(e.target.value)} placeholder="Ex : Ajout des sous-comptes 6015, 6181…" maxLength={200} />
                  </div>
                  <div className="form-section">
                    <label>Notes</label>
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ width: '100%' }} />
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Les clients existants gardent leur plan : leur mise à jour se fera par synchronisation, client par client, après aperçu.
                  </div>
                </>
              )}
            </>
          )}
          {erreur && <div className="alert-err" style={{ marginTop: 10 }}>{erreur}</div>}
        </div>
        <div className="modal-foot" style={{ gap: 10 }}>
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          {apercu?.total > 0 && <button className="btn-add" onClick={onPublier} disabled={saving}>Publier</button>}
        </div>
      </div>
    </div>
  );
}

export default function PlanModelePage() {
  const toast = useToast();
  const [comptes, setComptes] = useState(null);
  const [versions, setVersions] = useState([]);
  const [erreur, setErreur] = useState('');
  const [q, setQ] = useState('');
  const [classe, setClasse] = useState('');
  const [statut, setStatut] = useState('');
  const [etat, setEtat] = useState('');
  const [voirVersions, setVoirVersions] = useState(false);
  const [modal, setModal] = useState(null);
  const [onglet, setOnglet] = useState('comptes'); // 'comptes' | 'synchro'

  const charger = useCallback(async () => {
    const [c, v] = await Promise.all([api.get('/plan-modele/comptes'), api.get('/plan-modele/versions')]);
    if (c.error) { setErreur(c.error); return; }
    setComptes(Array.isArray(c) ? c : []);
    setVersions(Array.isArray(v) ? v : []);
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const filtres = useMemo(() => {
    if (!comptes) return [];
    const s = q.trim().toLowerCase();
    return comptes.filter((c) => (!s || c.compte.toLowerCase().includes(s) || (c.intitule || '').toLowerCase().includes(s))
      && (!classe || String(c.classe) === classe)
      && (!statut || c.statut === statut)
      && (!etat || c.etat_publication === etat));
  }, [comptes, q, classe, statut, etat]);

  const changerStatut = async (c, s) => {
    const verbe = { actif: 'Réactiver', inactif: 'Désactiver', archive: 'Archiver' }[s];
    if (!window.confirm(`${verbe} ${c.compte} — ${c.intitule} dans le modèle ?\n\nEffet après publication, pour les nouveaux clients uniquement.`)) return;
    const res = await api.patch(`/plan-modele/comptes/${c.id}/statut`, { statut: s });
    if (res.error) { toast(res.error, 'error'); return; }
    toast(`${c.compte} : ${STATUTS[s].label.toLowerCase()} (non publié).`, 'success');
    charger();
  };

  if (erreur) return <div className="alert-err">{erreur}</div>;
  if (!comptes) return <div className="loading-msg">Chargement du modèle…</div>;

  const publiee = versions.find((v) => v.statut === 'publiee');
  const enAttente = comptes.filter((c) => c.etat_publication !== 'publie').length;
  const sel = { padding: '8px 10px', border: '1.5px solid var(--border)', borderRadius: 7, fontSize: 13 };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Modèle de plan comptable (OHADA)</h2>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Version publiée : <strong>{publiee ? `${publiee.code} — ${publiee.libelle}` : 'aucune'}</strong>
            {publiee && ` · ${publiee.nb_comptes} comptes · ${publiee.nb_clients} client(s)`}
            {' · '}<button className="btn-ghost" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => setVoirVersions((x) => !x)}>{voirVersions ? 'Masquer' : 'Voir'} les versions</button>
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {enAttente > 0 && <span style={{ fontSize: 12, color: '#c2410c', fontWeight: 600 }}>{enAttente} modification(s) non publiée(s)</span>}
          <button className="btn-secondary" onClick={() => setModal('publier')}>🚀 Publier une version</button>
          <button className="btn-add" onClick={() => setModal('add')}>+ Compte</button>
        </div>
      </div>

      <div className="tabs-header" style={{ marginBottom: 16 }}>
        <button className={'tab-btn' + (onglet === 'comptes' ? ' active' : '')} onClick={() => setOnglet('comptes')}>📚 Comptes du modèle</button>
        <button className={'tab-btn' + (onglet === 'synchro' ? ' active' : '')} onClick={() => setOnglet('synchro')}>🔄 Synchronisation des clients</button>
      </div>

      {onglet === 'synchro' && <PlanSynchroPanel onChange={charger} />}

      {onglet === 'comptes' && voirVersions && (
        <div className="table-wrap" style={{ marginBottom: 16 }}>
          <table>
            <thead><tr><th>Version</th><th>Libellé</th><th>Statut</th><th>Publiée le</th><th>Par</th><th>Comptes</th><th>Clients</th></tr></thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id}>
                  <td><code>{v.code}</code></td><td>{v.libelle}{v.notes ? <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{v.notes}</div> : null}</td>
                  <td>{v.statut === 'publiee' ? <Badge m={{ label: 'Publiée', bg: '#dcfce7', fg: '#15803d' }} /> : <Badge m={{ label: 'Archivée', bg: '#e2e8f0', fg: '#475569' }} />}</td>
                  <td>{v.publiee_le ? new Date(v.publiee_le).toLocaleDateString('fr-FR') : '—'}</td>
                  <td>{v.publiee_par || '—'}</td><td>{v.nb_comptes}</td><td>{v.nb_clients}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {onglet === 'comptes' && (<>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input type="search" placeholder="🔍 Numéro ou intitulé…" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...sel, minWidth: 240 }} />
        <select value={classe} onChange={(e) => setClasse(e.target.value)} style={sel}>
          <option value="">Toutes les classes</option>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => <option key={k} value={k}>Classe {k}</option>)}
        </select>
        <select value={statut} onChange={(e) => setStatut(e.target.value)} style={sel}>
          <option value="">Tous les statuts</option>
          {Object.entries(STATUTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={etat} onChange={(e) => setEtat(e.target.value)} style={sel}>
          <option value="">Publiés et non publiés</option>
          <option value="nouveau">Non publiés (nouveaux)</option>
          <option value="modifie">Modifiés depuis la publication</option>
        </select>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>{filtres.length} compte(s){filtres.length > MAX ? ` — ${MAX} affichés` : ''}</span>
      </div>

      <div className="table-wrap" style={{ maxHeight: '62vh', overflowY: 'auto' }}>
        <table>
          <thead>
            <tr><th style={{ width: 100 }}>Compte</th><th>Intitulé</th><th style={{ width: 60 }}>Classe</th><th style={{ width: 90 }}>Type</th><th style={{ width: 80 }}>Parent</th><th style={{ width: 80 }}>Statut</th><th style={{ width: 90 }}>Publication</th><th style={{ width: 60 }}>Clients</th><th style={{ width: 150 }} /></tr>
          </thead>
          <tbody>
            {filtres.slice(0, MAX).map((c) => (
              <tr key={c.id} style={{ opacity: c.statut === 'actif' ? 1 : 0.65 }}>
                <td><code style={{ fontWeight: 700 }}>{c.compte}</code></td>
                <td>{c.intitule}{c.description ? <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.description}</div> : null}</td>
                <td>{c.classe ?? '—'}</td>
                <td style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{c.nature || '—'}</td>
                <td><code>{c.parent_compte || '—'}</code></td>
                <td><Badge m={STATUTS[c.statut]} /></td>
                <td><Badge m={ETATS[c.etat_publication]} /></td>
                <td style={{ textAlign: 'center' }}>{c.nb_clients}</td>
                <td>
                  <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                    <button className="btn-icon" title="Modifier" onClick={() => setModal({ edit: c })}>✏️</button>
                    {c.statut !== 'actif' && <button className="btn-icon" title="Réactiver" onClick={() => changerStatut(c, 'actif')}>↺</button>}
                    {c.statut === 'actif' && <button className="btn-icon" title="Désactiver" onClick={() => changerStatut(c, 'inactif')}>⏸</button>}
                    {c.statut !== 'archive' && <button className="btn-icon" title="Archiver" onClick={() => changerStatut(c, 'archive')}>🗄</button>}
                    <button className="btn-icon" title="Historique" onClick={() => setModal({ histo: c })}>🕘</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </>)}

      {(modal === 'add' || modal?.edit) && (
        <CompteModal compte={modal === 'add' ? null : modal.edit} onClose={() => setModal(null)}
          onSaved={(msg) => { setModal(null); toast(msg, 'success'); charger(); }} />
      )}
      {modal?.histo && <HistoriqueModal compte={modal.histo} onClose={() => setModal(null)} />}
      {modal === 'publier' && <PublierModal onClose={() => setModal(null)} onDone={(msg) => { setModal(null); toast(msg, 'success'); charger(); }} />}
    </>
  );
}
