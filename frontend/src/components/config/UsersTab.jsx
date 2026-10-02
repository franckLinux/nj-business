import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import PermissionsAssignModal from '@/components/PermissionsAssignModal';

// Reprend loadTabUsers()/openModalUser()/saveUser()/openModalResetPwd()/toggleUser()/deleteUser()
// de legacy/js/app.js (l. 4774-5170).
const ROLES_LABELS = {
  directeur: '👔 Directeur', caissier: '🧾 Caissier(ère)', auditeur: '🔍 Auditeur',
  comptable_cabinet: '📊 Comptable Cabinet', super_admin: '⚙️ Super Admin',
};
const ROLES_COLORS = {
  directeur: '#dbeafe', caissier: '#fce7f3', auditeur: '#fef3c7',
  comptable_cabinet: '#dcfce7', super_admin: '#ede9fe',
};
const ROLES_CREABLES = ['directeur', 'caissier', 'auditeur', 'comptable_cabinet'];

// Exporté : réutilisé par JournauxTab pour la création rapide d'un responsable
// depuis la modale journal (bouton « + Créer »).
export function UserModal({ user, onClose, onSaved }) {
  const isEdit = !!user;
  const [username, setUsername] = useState(user?.username || '');
  const [email, setEmail] = useState(user?.email || '');
  const [role, setRole] = useState(user?.role || 'caissier');
  const [customRoleId, setCustomRoleId] = useState(user?.custom_role_id || null);
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [roles, setRoles] = useState(null);
  const [erreur, setErreur] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let annule = false;
    api.get('/roles').then((r) => { if (!annule) setRoles(Array.isArray(r) ? r : []); });
    return () => { annule = true; };
  }, []);

  const onSave = async () => {
    if (!username.trim() || !role) { setErreur('Identifiant et rôle obligatoires.'); return; }
    let body = { username: username.trim(), email: email.trim(), role, custom_role_id: customRoleId };
    if (!isEdit) {
      if (!pwd || pwd.length < 6) { setErreur('Minimum 6 caractères.'); return; }
      if (pwd !== pwd2) { setErreur('Les mots de passe ne correspondent pas.'); return; }
      body = { ...body, password: pwd };
    }
    setSaving(true);
    const res = isEdit ? await api.put(`/users/${user.id}`, body) : await api.post('/users', body);
    setSaving(false);
    if (res.error) { setErreur(res.error); return; }
    // Le 2e argument (l'utilisateur créé/modifié) permet à un appelant comme
    // JournauxTab de présélectionner ce nouvel utilisateur dans un select.
    onSaved(isEdit ? 'Utilisateur modifié ✓' : 'Utilisateur créé ✓', res);
  };

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 560 }}>
        <div className="modal-head" style={{ background: 'linear-gradient(135deg,#1e40af,#3b82f6)', borderRadius: '14px 14px 0 0' }}>
          <h3 style={{ color: 'white', margin: 0, fontSize: 16 }}>{isEdit ? "✏️ Modifier l'utilisateur" : '👤 Nouvel utilisateur'}</h3>
          <button className="modal-close" style={{ color: 'white', opacity: .8 }} onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div className="form-section" style={{ margin: 0 }}>
              <label>Identifiant <span className="req">*</span></label>
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Ex: marie_caisse" />
            </div>
            <div className="form-section" style={{ margin: 0 }}>
              <label>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@exemple.com" />
            </div>
          </div>

          <div className="form-section">
            <label>Accès système <span className="req">*</span></label>
            <span className="field-hint" style={{ marginBottom: 6, display: 'block' }}>Détermine ce que l'utilisateur peut administrer</span>
            <select style={{ background: '#f8fafc' }} value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES_CREABLES.map((r) => <option key={r} value={r}>{ROLES_LABELS[r]}</option>)}
            </select>
          </div>

          <div className="form-section">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              Profil métier
              <span style={{ fontSize: 10, background: '#f0fdf4', color: '#16a34a', padding: '1px 7px', borderRadius: 10, fontWeight: 600 }}>Optionnel</span>
            </label>
            <span className="field-hint" style={{ marginBottom: 8, display: 'block' }}>Groupe de permissions associé à ce poste</span>
            {roles === null ? (
              <div className="loading-msg">Chargement…</div>
            ) : roles.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0' }}>Aucun profil métier défini. Créez-en dans Configuration → Rôles.</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 8, marginTop: 8 }}>
                <div
                  onClick={() => setCustomRoleId(null)}
                  style={{
                    cursor: 'pointer', border: `2px solid ${!customRoleId ? '#94a3b8' : 'var(--border)'}`, borderRadius: 10,
                    padding: '10px 12px', textAlign: 'center', background: !customRoleId ? '#f8fafc' : 'white',
                  }}
                >
                  <div style={{ fontSize: 20, marginBottom: 4 }}>🚫</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>Aucun profil</div>
                </div>
                {roles.map((r) => {
                  const selected = customRoleId === r.id;
                  const col = r.couleur || '#6366f1';
                  return (
                    <div
                      key={r.id}
                      onClick={() => setCustomRoleId(r.id)}
                      style={{
                        cursor: 'pointer', border: `2px solid ${selected ? col : 'var(--border)'}`, borderRadius: 10,
                        padding: '10px 12px', textAlign: 'center', background: selected ? col + '15' : 'white',
                      }}
                    >
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: col + '22', margin: '0 auto 6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontSize: 16 }}>🎭</span>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: selected ? col : 'var(--text)', lineHeight: 1.3 }}>{r.nom}</div>
                      {r.description && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.3 }}>{r.description}</div>}
                      <div style={{ marginTop: 4, fontSize: 10, fontWeight: 600, color: col, background: col + '18', borderRadius: 10, padding: '1px 6px', display: 'inline-block' }}>
                        {r.nb_permissions || 0} perm.
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {!isEdit && (
            <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div className="form-section" style={{ margin: 0 }}>
                  <label>Mot de passe <span className="req">*</span></label>
                  <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="Minimum 6 caractères" />
                </div>
                <div className="form-section" style={{ margin: 0 }}>
                  <label>Confirmer <span className="req">*</span></label>
                  <input type="password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} placeholder="Répéter le mot de passe" />
                </div>
              </div>
            </div>
          )}

          {erreur && <div className="alert-err" style={{ marginTop: 10 }}>{erreur}</div>}
        </div>
        <div className="modal-foot" style={{ gap: 10 }}>
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button
            onClick={onSave}
            disabled={saving}
            style={{ background: 'linear-gradient(135deg,#1e40af,#3b82f6)', color: 'white', border: 'none', borderRadius: 10, padding: '9px 22px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            💾 {isEdit ? 'Enregistrer' : "Créer l'utilisateur"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ResetPasswordModal({ userId, username, onClose, onDone }) {
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [erreur, setErreur] = useState('');
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    if (!pwd || pwd.length < 6) { setErreur('Minimum 6 caractères.'); return; }
    if (pwd !== pwd2) { setErreur('Mots de passe différents.'); return; }
    setSaving(true);
    const res = await api.post(`/users/${userId}/password`, { password: pwd });
    setSaving(false);
    if (res.error) { setErreur(res.error); return; }
    onDone();
  };

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 420 }}>
        <div className="modal-head">
          <h3>🔑 Réinitialiser — {username}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <label>Nouveau mot de passe *</label>
          <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="Minimum 6 caractères" />
          <label>Confirmer *</label>
          <input type="password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} />
          {erreur && <div className="alert-err" style={{ marginTop: 10 }}>{erreur}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn-primary" style={{ width: 'auto', marginTop: 0 }} onClick={onSave} disabled={saving}>🔑 Réinitialiser</button>
        </div>
      </div>
    </div>
  );
}

export default function UsersTab() {
  const { user: me, can } = useApp();
  const toast = useToast();
  const [users, setUsers] = useState(null);
  const [erreur, setErreur] = useState('');
  const [modal, setModal] = useState(null); // null | 'new' | user | { reset:user } | { perms:user }

  const canCreate = can('users.create');
  const canEdit = can('users.edit');
  const canDelete = can('users.delete');
  const showActions = canEdit || canDelete;
  // L'attribution de permissions reste réservée au super_admin (la route
  // POST /users/:id/permissions est la seule à garder un requireRole).
  const isSuperAdmin = me?.role === 'super_admin';

  const charger = useCallback(async () => {
    const data = await api.get('/users');
    if (data.error) { setErreur(data.error); return; }
    setUsers(data);
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const onToggle = async (id) => {
    const res = await api.patch(`/users/${id}/actif`, {});
    if (res.error) { toast(res.error, 'error'); return; }
    toast(res.message, 'success');
    charger();
  };

  const onDelete = async (id, username) => {
    if (!window.confirm(`Supprimer définitivement "${username}" ?`)) return;
    const res = await api.delete(`/users/${id}`);
    if (res.error) { toast(res.error, 'error'); return; }
    toast('Utilisateur supprimé.', 'success');
    charger();
  };

  if (erreur) return <div className="alert-err">{erreur}</div>;
  if (!users) return <div className="loading-msg">Chargement…</div>;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700 }}>Utilisateurs ({users.length})</h3>
        {canCreate && <button className="btn-add" onClick={() => setModal('new')}>+ Nouvel utilisateur</button>}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Utilisateur</th><th>Accès système</th><th>Profil métier</th><th>Email</th><th>Dernière connexion</th><th>Statut</th>
              {showActions && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isMe = u.id === me?.id;
              const bg = ROLES_COLORS[u.role] || '#f1f5f9';
              const conn = u.derniere_connexion
                ? new Date(u.derniere_connexion).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                : 'Jamais';
              const roleCol = u.custom_role_couleur || '#6366f1';
              return (
                <tr key={u.id} style={!u.actif ? { opacity: .5 } : undefined}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                        {u.username.substring(0, 2).toUpperCase()}
                      </div>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>
                        {u.username}
                        {isMe && <span style={{ fontSize: 10, color: 'var(--accent)', marginLeft: 4 }}>(vous)</span>}
                      </span>
                    </div>
                  </td>
                  <td><span style={{ padding: '3px 9px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: bg, color: '#1e293b' }}>{ROLES_LABELS[u.role] || u.role}</span></td>
                  <td>
                    {u.custom_role_nom ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: roleCol + '18', color: roleCol, border: `1px solid ${roleCol}40` }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: roleCol, display: 'inline-block' }} />
                        {u.custom_role_nom}
                      </span>
                    ) : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{u.email || '—'}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{conn}</td>
                  <td><span className={'statut-badge ' + (u.actif ? 'statut-valide' : 'statut-rejete')}>{u.actif ? '✓ Actif' : '✗ Inactif'}</span></td>
                  {showActions && (
                    <td>
                      <div className="row-actions">
                        {canEdit && <button className="btn-icon" onClick={() => setModal({ edit: u })}>✏️</button>}
                        {canEdit && <button className="btn-icon" onClick={() => setModal({ reset: u })}>🔑</button>}
                        {isSuperAdmin && <button className="btn-icon" title="Permissions" onClick={() => setModal({ perms: u })}>🔐</button>}
                        {canEdit && <button className={'btn-icon' + (u.actif ? ' danger' : '')} onClick={() => onToggle(u.id)} disabled={isMe}>{u.actif ? '⏸' : '▶️'}</button>}
                        {canDelete && !isMe && <button className="btn-icon danger" onClick={() => onDelete(u.id, u.username)}>✕</button>}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(modal === 'new' || modal?.edit) && (
        <UserModal
          user={modal === 'new' ? null : modal.edit}
          onClose={() => setModal(null)}
          onSaved={(msg) => { setModal(null); toast(msg, 'success'); charger(); }}
        />
      )}
      {modal?.reset && (
        <ResetPasswordModal
          userId={modal.reset.id}
          username={modal.reset.username}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); toast('Mot de passe réinitialisé ✓', 'success'); }}
        />
      )}
      {modal?.perms && (
        <PermissionsAssignModal
          title={`Permissions — ${modal.perms.username}`}
          grantedUrl={`/users/${modal.perms.id}/permissions`}
          saveUrl={`/users/${modal.perms.id}/permissions`}
          onClose={() => setModal(null)}
          onSaved={(count) => { setModal(null); toast(`${count} permission${count > 1 ? 's' : ''} enregistrée${count > 1 ? 's' : ''}.`, 'success'); }}
        />
      )}
    </>
  );
}
