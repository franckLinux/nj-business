import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { MODULE_META, moduleMeta } from '@/components/PermModuleGrid';

// Reprend loadPermissions()/openModalNewPerm()/openModalEditPerm()/savePerm()/
// updatePerm()/deletePerm() de legacy/js/app.js (l. 5332-5516). Les modales
// d'assignation (tenant/utilisateur/rôle) vivent dans PermissionsAssignModal.jsx,
// utilisé depuis TenantsPage/UsersTab/RolesTab.
function PermissionModal({ perm, onClose, onSaved }) {
  const isEdit = !!perm;
  const [nom, setNom] = useState(perm?.nom || '');
  const [code, setCode] = useState(perm?.code || '');
  const [module, setModule] = useState(perm?.module || Object.keys(MODULE_META)[0]);
  const [description, setDescription] = useState(perm?.description || '');
  const [erreur, setErreur] = useState('');
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    if (!nom.trim() || (!isEdit && !code.trim()) || !module) { setErreur('Nom, code et module sont obligatoires.'); return; }
    setSaving(true);
    const res = isEdit
      ? await api.put(`/permissions/${encodeURIComponent(perm.code)}`, { nom: nom.trim(), module, description: description.trim() })
      : await api.post('/permissions', { nom: nom.trim(), code: code.trim(), module, description: description.trim() });
    setSaving(false);
    if (res.error) { setErreur(res.error); return; }
    onSaved(isEdit ? 'Permission mise à jour.' : `Permission "${nom.trim()}" créée.`);
  };

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 500 }}>
        <div className="modal-head">
          <h3>{isEdit ? '✎ Modifier la permission' : '🔐 Nouvelle permission'}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {isEdit && (
            <div className="form-section">
              <label>Code (immuable)</label>
              <input type="text" value={code} readOnly style={{ background: '#f8fafc', fontFamily: 'monospace' }} />
            </div>
          )}
          <div className="form-section">
            <label>Nom <span className="req">*</span></label>
            <input type="text" value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Ex: Créer un mouvement" maxLength={200} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {!isEdit && (
              <div className="form-section">
                <label>Code <span className="req">*</span></label>
                <input type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="journal.create" style={{ fontFamily: 'monospace' }} />
                <span className="field-hint">Format : module.action</span>
              </div>
            )}
            <div className="form-section">
              <label>Module <span className="req">*</span></label>
              <select value={module} onChange={(e) => setModule(e.target.value)}>
                {Object.entries(MODULE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                <option value="autre">Autre</option>
              </select>
            </div>
          </div>
          <div className="form-section">
            <label>Description</label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Courte description de ce que permet cette permission" maxLength={300} />
          </div>
          {erreur && <div className="alert-err" style={{ marginTop: 10 }}>{erreur}</div>}
        </div>
        <div className="modal-foot" style={{ gap: 10 }}>
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-add" onClick={onSave} disabled={saving}>{isEdit ? 'Enregistrer' : 'Créer'}</button>
        </div>
      </div>
    </div>
  );
}

export default function PermissionsPage() {
  const { user } = useApp();
  const toast = useToast();
  const isSuperAdmin = user?.role === 'super_admin';
  const [perms, setPerms] = useState(null);
  const [erreur, setErreur] = useState('');
  const [modal, setModal] = useState(null); // null | 'new' | { edit:perm }

  const charger = useCallback(async () => {
    const data = await api.get('/permissions');
    if (data.error) { setErreur(data.error); return; }
    setPerms(data);
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const onDelete = async (code) => {
    if (!window.confirm(`Supprimer la permission "${code}" ? Cette action est irréversible.`)) return;
    const res = await api.delete(`/permissions/${encodeURIComponent(code)}`);
    if (res.error) { toast(res.error, 'error'); return; }
    toast('Permission supprimée.', 'success');
    charger();
  };

  if (erreur) return <div className="alert-err">{erreur}</div>;
  if (!perms) return <div className="loading-msg">Chargement…</div>;

  const byModule = {};
  perms.forEach((p) => { (byModule[p.module] ??= []).push(p); });

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Permissions</h2>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{perms.length} permission{perms.length > 1 ? 's' : ''} · {Object.keys(byModule).length} modules</span>
        </div>
        {isSuperAdmin && (
          <button className="btn-add" onClick={() => setModal('new')} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', fontSize: 13 }}>
            <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Nouvelle permission
          </button>
        )}
      </div>

      {Object.entries(byModule).map(([mod, list]) => {
        const meta = moduleMeta(mod);
        return (
          <div key={mod} style={{ marginBottom: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ background: meta.color, color: meta.text, padding: '4px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5 }}>{meta.label}</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{list.length} permission{list.length > 1 ? 's' : ''}</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Nom / Code</th><th>Module</th><th>Description</th>{isSuperAdmin && <th style={{ width: 80 }}>Actions</th>}</tr></thead>
                <tbody>
                  {list.map((p) => (
                    <tr key={p.code}>
                      <td>
                        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--accent)', marginBottom: 2 }}>{p.nom}</div>
                        <code style={{ fontSize: 11, color: 'var(--text-muted)', background: '#f1f5f9', padding: '1px 6px', borderRadius: 4 }}>{p.code}</code>
                      </td>
                      <td><span style={{ background: meta.color, color: meta.text, padding: '2px 10px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{mod}</span></td>
                      <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{p.description || '—'}</td>
                      {isSuperAdmin && (
                        <td>
                          <div className="row-actions">
                            <button className="btn-icon" onClick={() => setModal({ edit: p })}>✏️</button>
                            <button className="btn-icon danger" onClick={() => onDelete(p.code)}>✕</button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {(modal === 'new' || modal?.edit) && (
        <PermissionModal
          perm={modal === 'new' ? null : modal.edit}
          onClose={() => setModal(null)}
          onSaved={(msg) => { setModal(null); toast(msg, 'success'); charger(); }}
        />
      )}
    </>
  );
}
