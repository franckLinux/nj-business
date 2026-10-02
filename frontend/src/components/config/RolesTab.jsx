import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import PermissionsAssignModal from '@/components/PermissionsAssignModal';

// Reprend loadTabRoles()/openModalNewRole()/openModalEditRole()/saveNewRole()/
// updateRole()/deleteRole()/openModalRolePerms() de legacy/js/app.js (l. 5702-5985).
// Onglet visible uniquement pour super_admin (cf. ConfigPage.jsx).
const ROLE_COLORS = [
  { val: '#6366f1', label: 'Indigo' }, { val: '#0ea5e9', label: 'Bleu' },
  { val: '#10b981', label: 'Vert' }, { val: '#f59e0b', label: 'Ambre' },
  { val: '#ef4444', label: 'Rouge' }, { val: '#8b5cf6', label: 'Violet' },
  { val: '#ec4899', label: 'Rose' }, { val: '#14b8a6', label: 'Turquoise' },
];

const slugify = (nom) => nom.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

function RoleModal({ role, onClose, onSaved }) {
  const isEdit = !!role;
  const [nom, setNom] = useState(role?.nom || '');
  const [code, setCode] = useState(role?.code || '');
  const [description, setDescription] = useState(role?.description || '');
  const [couleur, setCouleur] = useState(role?.couleur || ROLE_COLORS[0].val);
  const [erreur, setErreur] = useState('');
  const [saving, setSaving] = useState(false);

  const onNomChange = (e) => {
    const v = e.target.value;
    setNom(v);
    if (!isEdit) setCode(slugify(v));
  };

  const onSave = async () => {
    if (!nom.trim() || (!isEdit && !code.trim())) { setErreur('Nom et code obligatoires.'); return; }
    setSaving(true);
    const res = isEdit
      ? await api.put(`/roles/${role.id}`, { nom: nom.trim(), description: description.trim(), couleur })
      : await api.post('/roles', { nom: nom.trim(), code: code.trim(), description: description.trim(), couleur });
    setSaving(false);
    if (res.error) { setErreur(res.error); return; }
    onSaved(isEdit ? 'Rôle mis à jour.' : `Rôle "${nom.trim()}" créé avec succès.`);
  };

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 480 }}>
        <div className="modal-head" style={{ background: 'linear-gradient(135deg,#7c3aed,#6366f1)', color: 'white', borderRadius: '14px 14px 0 0' }}>
          <h3 style={{ color: 'white', margin: 0, fontSize: 16 }}>{isEdit ? '✏️ Modifier le rôle' : '🎭 Nouveau rôle'}</h3>
          <button className="modal-close" style={{ color: 'white', opacity: .8 }} onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {isEdit && (
            <div className="form-section">
              <label>Code (immuable)</label>
              <input type="text" value={code} readOnly style={{ background: '#f8fafc', fontFamily: 'monospace', color: 'var(--text-muted)' }} />
            </div>
          )}
          <div className="form-section">
            <label>Nom du rôle <span className="req">*</span></label>
            <input type="text" value={nom} onChange={onNomChange} placeholder="Ex: Caissière, Auditeur interne…" maxLength={100} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isEdit ? '1fr' : '1fr 1fr', gap: 14 }}>
            {!isEdit && (
              <div className="form-section">
                <label>Code <span className="req">*</span></label>
                <input type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="caissiere" style={{ fontFamily: 'monospace' }} maxLength={60} />
                <span className="field-hint">Lettres, chiffres, _ uniquement</span>
              </div>
            )}
            <div className="form-section">
              <label>Couleur</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                {ROLE_COLORS.map((c) => (
                  <span
                    key={c.val} title={c.label} onClick={() => setCouleur(c.val)}
                    style={{ display: 'block', width: 22, height: 22, borderRadius: '50%', background: c.val, cursor: 'pointer', border: `2px solid ${couleur === c.val ? '#1e293b' : 'transparent'}` }}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="form-section">
            <label>Description</label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Courte description du rôle…" maxLength={300} />
          </div>
          {erreur && <div className="alert-err" style={{ marginTop: 10 }}>{erreur}</div>}
        </div>
        <div className="modal-foot" style={{ gap: 10 }}>
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button
            onClick={onSave} disabled={saving}
            style={{ background: 'linear-gradient(135deg,#7c3aed,#6366f1)', color: 'white', border: 'none', borderRadius: 10, padding: '9px 22px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            {isEdit ? 'Enregistrer' : 'Créer le rôle'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RolesTab() {
  const toast = useToast();
  const [roles, setRoles] = useState(null);
  const [erreur, setErreur] = useState('');
  const [modal, setModal] = useState(null); // null | 'new' | { edit:role } | { perms:role }

  const charger = useCallback(async () => {
    const data = await api.get('/roles');
    if (data.error) { setErreur(data.error); return; }
    setRoles(data);
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const onDelete = async (role) => {
    if (!window.confirm(`Supprimer le rôle "${role.nom}" ? Ses permissions associées seront perdues.`)) return;
    const res = await api.delete(`/roles/${role.id}`);
    if (res.error) { toast(res.error, 'error'); return; }
    toast('Rôle supprimé.', 'success');
    charger();
  };

  if (erreur) return <div className="alert-err">{erreur}</div>;
  if (!roles) return <div className="loading-msg">Chargement des rôles…</div>;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 3px' }}>Rôles personnalisés</h3>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {roles.length} rôle{roles.length > 1 ? 's' : ''} défini{roles.length > 1 ? 's' : ''} · Créez des profils de permissions pour vos utilisateurs
          </span>
        </div>
        <button
          onClick={() => setModal('new')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'linear-gradient(135deg,#7c3aed,#6366f1)', color: 'white', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
        >
          + Nouveau rôle
        </button>
      </div>

      {roles.length === 0 ? (
        <div style={{ background: 'white', border: '2px dashed var(--border)', borderRadius: 16, padding: 48, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🎭</div>
          <h4 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 8px' }}>Aucun rôle défini</h4>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 20px' }}>Créez des rôles comme "Caissière", "Auditeur interne" et associez-leur des permissions précises.</p>
          <button onClick={() => setModal('new')} style={{ background: 'linear-gradient(135deg,#7c3aed,#6366f1)', color: 'white', border: 'none', borderRadius: 10, padding: '10px 24px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            Créer le premier rôle
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 16 }}>
          {roles.map((r) => {
            const col = r.couleur || '#6366f1';
            return (
              <div key={r.id} style={{ background: 'white', border: '1.5px solid var(--border)', borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>
                <div style={{ height: 6, background: col }} />
                <div style={{ padding: '18px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 42, height: 42, borderRadius: 10, background: col + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>🎭</div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{r.nom}</div>
                        <code style={{ fontSize: 11, color: col, background: col + '15', padding: '1px 7px', borderRadius: 5, fontWeight: 600 }}>{r.code}</code>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                      <button className="btn-icon" onClick={() => setModal({ edit: r })} title="Modifier">✏️</button>
                      <button className="btn-icon danger" onClick={() => onDelete(r)} title="Supprimer">✕</button>
                    </div>
                  </div>
                  {r.description && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.5 }}>{r.description}</p>}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ background: col + '20', color: col, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
                      {r.nb_permissions} permission{r.nb_permissions > 1 ? 's' : ''}
                    </span>
                    <button
                      onClick={() => setModal({ perms: r })}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: col + '15', border: `1.5px solid ${col}40`, borderRadius: 8, padding: '5px 12px', cursor: 'pointer', color: col, fontSize: 12, fontWeight: 700 }}
                    >
                      🔐 Définir les permissions
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(modal === 'new' || modal?.edit) && (
        <RoleModal
          role={modal === 'new' ? null : modal.edit}
          onClose={() => setModal(null)}
          onSaved={(msg) => { setModal(null); toast(msg, 'success'); charger(); }}
        />
      )}
      {modal?.perms && (
        <PermissionsAssignModal
          title={`Permissions — ${modal.perms.nom}`}
          subtitle="Définissez les fonctionnalités accessibles pour ce rôle"
          headerColor={modal.perms.couleur || '#6366f1'}
          grantedUrl={`/roles/${modal.perms.id}/permissions`}
          saveUrl={`/roles/${modal.perms.id}/permissions`}
          onClose={() => setModal(null)}
          onSaved={(count) => { setModal(null); toast(`${count} permission${count > 1 ? 's' : ''} enregistrée${count > 1 ? 's' : ''}.`, 'success'); charger(); }}
        />
      )}
    </>
  );
}
