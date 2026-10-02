import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

// Affectation d'un comptable cabinet à ses clients (migration 015) :
// il ne voit et n'administre QUE les clients cochés ici. Réservé au super_admin.
export default function AffectationsModal({ user, onClose, onSaved }) {
  const [tenants, setTenants] = useState(null);
  const [coches, setCoches] = useState(new Set());
  const [erreur, setErreur] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let annule = false;
    Promise.all([api.get('/tenants'), api.get(`/users/${user.id}/affectations`)]).then(([t, a]) => {
      if (annule) return;
      if (t.error || a.error) { setErreur(t.error || a.error); return; }
      setTenants(t);
      setCoches(new Set(a));
    });
    return () => { annule = true; };
  }, [user.id]);

  const basculer = (id) => setCoches((prev) => {
    const s = new Set(prev);
    if (s.has(id)) s.delete(id); else s.add(id);
    return s;
  });

  const onSave = async () => {
    setSaving(true);
    setErreur('');
    const res = await api.put(`/users/${user.id}/affectations`, { tenantIds: [...coches] });
    setSaving(false);
    if (res.error) { setErreur(res.error); return; }
    onSaved(coches.size);
  };

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 520 }}>
        <div className="modal-head" style={{ background: 'linear-gradient(135deg,#15803d,#22c55e)', borderRadius: '14px 14px 0 0' }}>
          <div>
            <h3 style={{ color: 'white', margin: 0, fontSize: 16 }}>🏢 Clients affectés — {user.username}</h3>
            <p style={{ color: 'rgba(255,255,255,.75)', fontSize: 12, margin: '2px 0 0' }}>
              {tenants ? `${coches.size} / ${tenants.length} client(s)` : ''}
            </p>
          </div>
          <button className="modal-close" style={{ color: 'white', opacity: .8 }} onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ padding: '18px 20px', maxHeight: '60vh', overflowY: 'auto' }}>
          {!tenants ? <div className="loading-msg">Chargement…</div> : tenants.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Aucun client.</p>
          ) : tenants.map((t) => (
            <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
              <input type="checkbox" checked={coches.has(t.id)} onChange={() => basculer(t.id)} />
              <span style={{ fontWeight: 600, fontSize: 13 }}>{t.nom}</span>
              <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.slug}</code>
              {!t.actif && <span className="statut-badge statut-rejete" style={{ marginLeft: 'auto' }}>Inactif</span>}
            </label>
          ))}
        </div>
        <div className="modal-foot" style={{ gap: 10 }}>
          {erreur && <div className="alert-err" style={{ flex: 1, margin: 0, fontSize: 12 }}>{erreur}</div>}
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-add" onClick={onSave} disabled={saving || !tenants}>💾 Enregistrer</button>
        </div>
      </div>
    </div>
  );
}
