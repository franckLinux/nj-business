import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

// Reprend showTenantSelector()/selectTenantClose() de legacy/js/app.js (l. 6135-6169).
// Fidèle à l'original : pas de bouton d'annulation ni de fermeture au clic
// extérieur — un super_admin/comptable_cabinet doit choisir un client pour
// continuer (ou naviguer ailleurs via la sidebar, qui reste accessible).
export default function TenantSelectorModal({ onSelect }) {
  const [tenants, setTenants] = useState(null);

  useEffect(() => {
    let annule = false;
    api.get('/tenants').then((data) => {
      if (annule) return;
      setTenants(Array.isArray(data) ? data.filter((t) => t.actif) : []);
    });
    return () => { annule = true; };
  }, []);

  return (
    <div className="modal-overlay" style={{ display: 'flex', background: 'rgba(10,20,40,.85)' }}>
      <div className="modal-box" style={{ maxWidth: 500 }}>
        <div className="modal-head"><h3>🏢 Sélectionner un client</h3></div>
        <div className="modal-body" style={{ padding: '12px 24px 20px' }}>
          {tenants === null ? (
            <div className="loading-msg">Chargement…</div>
          ) : tenants.length === 0 ? (
            <div className="alert-err">Aucun client trouvé.</div>
          ) : tenants.map((t) => (
            <div
              key={t.id}
              onClick={() => onSelect(t.id, t.nom, t.devise || 'FCFA')}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10, border: '1.5px solid var(--border)', marginBottom: 8, cursor: 'pointer', background: 'white' }}
            >
              <div style={{ width: 40, height: 40, borderRadius: 10, background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, color: 'var(--accent)', flexShrink: 0 }}>
                {t.nom.substring(0, 2).toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{t.nom}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.slug} · {t.devise || 'FCFA'}</div>
              </div>
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="var(--text-light)" fill="none" strokeWidth="2" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
