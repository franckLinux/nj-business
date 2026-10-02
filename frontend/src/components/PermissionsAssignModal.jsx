import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import PermModuleGrid from '@/components/PermModuleGrid';

// Modale générique réutilisée pour les 3 écrans d'assignation de permissions
// (tenant / utilisateur / rôle) — reprend openModalTenantPerms()/saveTenantPerms()
// et openModalUserPerms()/saveUserPerms() de legacy/js/app.js (l. 5519-5700),
// et sert aussi à la modale « Permissions du rôle » (l. 5934-5985).
export default function PermissionsAssignModal({ title, subtitle, grantedUrl, saveUrl, headerColor, onClose, onSaved }) {
  const [allPerms, setAllPerms] = useState(null);
  const [granted, setGranted] = useState(new Set());
  const [erreur, setErreur] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let annule = false;
    Promise.all([api.get('/permissions'), api.get(grantedUrl)]).then(([perms, grantedCodes]) => {
      if (annule) return;
      if (perms.error) { setErreur(perms.error); return; }
      setAllPerms(perms);
      setGranted(new Set(Array.isArray(grantedCodes) ? grantedCodes : []));
    });
    return () => { annule = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grantedUrl]);

  const total = allPerms?.length || 0;
  const active = allPerms ? allPerms.filter((p) => granted.has(p.code)).length : 0;

  const onSave = async () => {
    setSaving(true);
    setErreur('');
    const res = await api.post(saveUrl, { codes: [...granted] });
    setSaving(false);
    if (res.error) { setErreur(res.error); return; }
    onSaved(granted.size);
  };

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 660 }}>
        <div className="modal-head" style={{ background: headerColor || 'linear-gradient(135deg,#1e40af,#3b82f6)', borderRadius: '14px 14px 0 0' }}>
          <div>
            <h3 style={{ color: 'white', margin: 0, fontSize: 16 }}>🔐 {title}</h3>
            <p style={{ color: 'rgba(255,255,255,.7)', fontSize: 12, margin: '2px 0 0' }}>
              {subtitle || (allPerms ? `${active} / ${total} fonctionnalités activées` : '')}
            </p>
          </div>
          <button className="modal-close" style={{ color: 'white', opacity: .8 }} onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ padding: '18px 20px', maxHeight: '70vh', overflowY: 'auto' }}>
          {erreur && <div className="alert-err" style={{ marginBottom: 12 }}>{erreur}</div>}
          {!allPerms ? <div className="loading-msg">Chargement…</div> : (
            <PermModuleGrid permissions={allPerms} granted={granted} onChange={setGranted} />
          )}
        </div>
        <div className="modal-foot" style={{ gap: 10 }}>
          {/* Répété ici : en haut du corps défilant, l'erreur passait inaperçue
              et l'enregistrement semblait simplement ne rien faire. */}
          {erreur && <div className="alert-err" style={{ flex: 1, margin: 0, fontSize: 12 }}>{erreur}</div>}
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-add" onClick={onSave} disabled={saving || !allPerms}>💾 Enregistrer</button>
        </div>
      </div>
    </div>
  );
}
