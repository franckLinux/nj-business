import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { fmt } from '@/lib/format';

// Activités / projets (migration 034) : référentiel du client. Une opération
// peut y être rattachée à la saisie (champ facultatif) ; le suivi se fait dans
// Reporting → Suivi par activité.
const TYPES = { activite: { label: 'Activité', ico: '🏷️', couleur: '#0369a1', fond: '#e0f2fe' }, projet: { label: 'Projet', ico: '🎯', couleur: '#7c3aed', fond: '#ede9fe' } };

function ActiviteModal({ item, devise, onClose, onSaved }) {
  const isEdit = Boolean(item?.id);
  const [f, setF] = useState({
    nom: item?.nom || '', type: item?.type || 'activite', code: item?.code || '', description: item?.description || '',
    budget: item?.budget ?? '', date_debut: item?.date_debut || '', date_fin: item?.date_fin || '',
  });
  const [erreur, setErreur] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const onSave = async () => {
    if (!f.nom.trim()) { setErreur('Le nom est obligatoire.'); return; }
    setSaving(true);
    const res = isEdit ? await api.put(`/activites/${item.id}`, f) : await api.post('/activites', f);
    setSaving(false);
    if (res.error) { setErreur(res.error); return; }
    onSaved(isEdit ? 'Modification enregistrée ✓' : `« ${res.nom} » ajouté${f.type === 'projet' ? '' : 'e'} ✓`);
  };

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 520 }}>
        <div className="modal-head">
          <h3>{isEdit ? 'Modifier' : 'Nouvelle activité / nouveau projet'}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <label>Type</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {Object.entries(TYPES).map(([k, t]) => (
              <button
                key={k} type="button" onClick={() => setF((x) => ({ ...x, type: k }))}
                style={{ flex: 1, padding: '10px 12px', borderRadius: 9, cursor: 'pointer', fontWeight: 700, fontSize: 13,
                  border: `1.5px solid ${f.type === k ? t.couleur : 'var(--border)'}`, background: f.type === k ? t.fond : '#fff', color: f.type === k ? t.couleur : 'var(--text-muted)' }}
              >{t.ico} {t.label}</button>
            ))}
          </div>
          <p className="field-hint" style={{ marginTop: 6 }}>
            {f.type === 'projet'
              ? 'Un projet a un début, une fin et souvent une enveloppe : chantier, événement, forage, campagne…'
              : 'Une activité est un secteur durable de l\'entreprise : boutique, atelier, transport, restauration…'}
          </p>
          <div className="fgrid2">
            <div style={{ gridColumn: '1 / -1' }}>
              <label>Nom <span className="req">*</span></label>
              <input type="text" maxLength={120} value={f.nom} onChange={set('nom')} placeholder={f.type === 'projet' ? 'Ex : Forage de Mfou' : 'Ex : Boutique Mvog-Mbi'} autoFocus />
            </div>
            <div>
              <label>Code (facultatif)</label>
              <input type="text" maxLength={20} value={f.code} onChange={set('code')} placeholder="Ex : BTQ1" style={{ textTransform: 'uppercase' }} />
            </div>
            <div>
              <label>Enveloppe prévue (facultatif)</label>
              <div className="input-group">
                <input type="number" min="0" step="1" className="has-suffix" value={f.budget} onChange={set('budget')} placeholder="0" />
                <span className="input-suffix">{devise}</span>
              </div>
            </div>
            {f.type === 'projet' && (
              <>
                <div><label>Début</label><input type="date" value={f.date_debut || ''} onChange={set('date_debut')} /></div>
                <div><label>Fin prévue</label><input type="date" value={f.date_fin || ''} onChange={set('date_fin')} /></div>
              </>
            )}
            <div style={{ gridColumn: '1 / -1' }}>
              <label>Description</label>
              <input type="text" maxLength={500} value={f.description} onChange={set('description')} placeholder="Précision utile pour les caissières" />
            </div>
          </div>
          {erreur && <div className="alert-err" style={{ marginTop: 10 }}>{erreur}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn-primary" style={{ width: 'auto', marginTop: 0 }} onClick={onSave} disabled={saving}>💾 Enregistrer</button>
        </div>
      </div>
    </div>
  );
}

export default function ActivitesTab() {
  const { can, devise } = useApp();
  const toast = useToast();
  const canEdit = can('activites.edit');
  const [liste, setListe] = useState(null);
  const [erreur, setErreur] = useState('');
  const [modal, setModal] = useState(null);
  const [voirInactives, setVoirInactives] = useState(false);

  const charger = useCallback(async () => {
    const r = await api.get('/activites?tous=1');
    if (r.error) { setErreur(r.error); return; }
    setListe(r);
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const onDelete = async (a) => {
    const msg = a.nb_operations > 0
      ? `« ${a.nom} » est déjà utilisée par ${a.nb_operations} opération(s).\nElle sera désactivée : plus proposée à la saisie, historique conservé. Continuer ?`
      : `Supprimer « ${a.nom} » ?`;
    if (!window.confirm(msg)) return;
    const res = await api.delete(`/activites/${a.id}`);
    if (res.error) { toast(res.error, 'error'); return; }
    toast(res.message, 'success');
    charger();
  };
  const onReactiver = async (a) => {
    const res = await api.put(`/activites/${a.id}`, { ...a, actif: true });
    if (res.error) { toast(res.error, 'error'); return; }
    toast(`« ${a.nom} » réactivée ✓`, 'success');
    charger();
  };

  if (erreur) return <div className="alert-err">{erreur}</div>;
  if (!liste) return <div className="loading-msg">Chargement…</div>;

  const actives = liste.filter((a) => a.actif);
  const inactives = liste.filter((a) => !a.actif);
  const affichees = voirInactives ? liste : actives;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700 }}>Activités et projets</h3>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, maxWidth: 620 }}>
            Classez vos opérations par secteur d'activité ou par projet. Le choix est <b>facultatif</b> dans le formulaire de saisie ;
            les totaux sont visibles dans <b>Gestion des activités → Rapports par activité</b>.
          </p>
        </div>
        {canEdit && <button className="btn-add" onClick={() => setModal('new')}>+ Ajouter</button>}
      </div>

      {affichees.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, background: 'white', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🎯</div>
          <p>Aucune activité ni aucun projet pour l'instant.</p>
          {canEdit && <p style={{ fontSize: 12, marginTop: 4 }}>Exemples : « Boutique Mvog-Mbi », « Transport », « Projet forage de Mfou ».</p>}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 12 }}>
          {affichees.map((a) => {
            const t = TYPES[a.type] || TYPES.activite;
            return (
              <div key={a.id} style={{ background: 'white', border: '1px solid var(--border)', borderLeft: `4px solid ${t.couleur}`, borderRadius: 10, padding: '14px 16px', opacity: a.actif ? 1 : 0.6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: t.fond, color: t.couleur }}>{t.ico} {t.label}</span>
                  {a.code && <span className="badge-rubrique">{a.code}</span>}
                  {!a.actif && <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b', background: '#f1f5f9', padding: '2px 7px', borderRadius: 10 }}>Désactivée</span>}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{a.nom}</div>
                {a.description && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{a.description}</div>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 11.5, color: 'var(--text-muted)', marginTop: 8 }}>
                  <span>{a.nb_operations} opération{a.nb_operations > 1 ? 's' : ''}</span>
                  {a.budget !== null && a.budget !== undefined && <span>Enveloppe : <b style={{ color: 'var(--text)' }}>{fmt(a.budget, devise)}</b></span>}
                  {(a.date_debut || a.date_fin) && (
                    <span>{a.date_debut ? new Date(`${a.date_debut}T00:00:00`).toLocaleDateString('fr-FR') : '…'} → {a.date_fin ? new Date(`${a.date_fin}T00:00:00`).toLocaleDateString('fr-FR') : '…'}</span>
                  )}
                </div>
                {canEdit && (
                  <div className="row-actions" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
                    {a.actif ? (
                      <>
                        <button className="btn-icon" title="Modifier" onClick={() => setModal(a)}>✏️</button>
                        <button className="btn-icon danger" title={a.nb_operations > 0 ? 'Désactiver' : 'Supprimer'} onClick={() => onDelete(a)}>{a.nb_operations > 0 ? '⏸' : '✕'}</button>
                      </>
                    ) : (
                      <button className="btn-ghost btn-sm" onClick={() => onReactiver(a)}>▶️ Réactiver</button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {inactives.length > 0 && (
        <button className="btn-ghost btn-sm" style={{ marginTop: 14 }} onClick={() => setVoirInactives((v) => !v)}>
          {voirInactives ? 'Masquer' : 'Afficher'} les désactivées ({inactives.length})
        </button>
      )}

      {modal && (
        <ActiviteModal
          item={modal === 'new' ? null : modal}
          devise={devise}
          onClose={() => setModal(null)}
          onSaved={(m) => { setModal(null); toast(m, 'success'); charger(); }}
        />
      )}
    </>
  );
}
