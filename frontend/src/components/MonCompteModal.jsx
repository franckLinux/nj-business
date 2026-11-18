import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { MesAppareils } from '@/components/SessionsOuvertes';

// « Mon compte » (C7) : accessible à TOUS les profils depuis le bas du menu
// latéral — le changement de mot de passe ne dépend plus de l'onglet Entité.
export default function MonCompteModal({ onClose }) {
  const { user } = useApp();
  const toast = useToast();
  const [pwd, setPwd] = useState({ ancien: '', nouveau: '', confirm: '' });
  const [erreur, setErreur] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setPwd((p) => ({ ...p, [k]: e.target.value }));

  const onSave = async () => {
    if (!pwd.ancien) { setErreur('Saisissez votre mot de passe actuel.'); return; }
    if (pwd.nouveau.length < 6) { setErreur('Le nouveau mot de passe doit faire au moins 6 caractères.'); return; }
    if (pwd.nouveau !== pwd.confirm) { setErreur('Les deux nouveaux mots de passe sont différents.'); return; }
    setSaving(true);
    const res = await api.post('/auth/change-password', { ancienPassword: pwd.ancien, nouveauPassword: pwd.nouveau });
    setSaving(false);
    if (res.error) { setErreur(res.error); return; }
    toast('Mot de passe modifié ✓ Vos autres appareils sont déconnectés.', 'success');
    onClose();
  };

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 440 }}>
        <div className="modal-head">
          <h3>👤 Mon compte</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
            <div><strong>{user?.username}</strong></div>
            <div style={{ color: 'var(--text-muted)' }}>{user?.role}{user?.tenantNom ? ` · ${user.tenantNom}` : ''}</div>
          </div>
          <div className="form-section" style={{ marginTop: 0 }}>🔑 Changer mon mot de passe</div>
          <label>Mot de passe actuel</label>
          <input type="password" autoComplete="current-password" value={pwd.ancien} onChange={set('ancien')} />
          <label>Nouveau mot de passe</label>
          <input type="password" autoComplete="new-password" value={pwd.nouveau} onChange={set('nouveau')} placeholder="6 caractères minimum" />
          <label>Confirmer le nouveau mot de passe</label>
          <input type="password" autoComplete="new-password" value={pwd.confirm} onChange={set('confirm')}
            onKeyDown={(e) => { if (e.key === 'Enter') onSave(); }} />
          {erreur && <div className="alert-err" style={{ marginTop: 10 }}>{erreur}</div>}
          <MesAppareils />
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>Fermer</button>
          <button className="btn-primary" style={{ width: 'auto', marginTop: 0 }} onClick={onSave} disabled={saving}>🔑 Modifier</button>
        </div>
      </div>
    </div>
  );
}
