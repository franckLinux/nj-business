import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import PermissionsAssignModal from '@/components/PermissionsAssignModal';
import SuppressionClient from '@/components/SuppressionClient';
import NouveauClientAssistant from '@/components/NouveauClientAssistant';

// Reprend loadTenants()/openModalNewTenant()/saveNewTenant()/toggleTenantActif()/
// switchTenant() de legacy/js/app.js (l. 5987-6124).
export default function TenantsPage() {
  const { user, activeTenantId, selectTenant } = useApp();
  const toast = useToast();
  const isSuperAdmin = user?.role === 'super_admin';
  const [tenants, setTenants] = useState(null);
  const [erreur, setErreur] = useState('');
  const [modal, setModal] = useState(null); // null | 'new' | { perms:t } | { suppr:t }

  const charger = useCallback(async () => {
    const data = await api.get('/tenants');
    if (data.error) { setErreur(data.error); return; }
    setTenants(data);
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const onToggle = async (t) => {
    const res = await api.patch(`/tenants/${t.id}/actif`, { actif: !t.actif });
    if (res.error) { toast(res.error, 'error'); return; }
    charger();
  };

  // Reste sur la page (contrairement au sélecteur de tenant, qui navigue vers
  // le tableau de bord) — reprend switchTenant(), pas selectTenantClose().
  const onSwitch = (t) => {
    selectTenant(t.id, t.nom, t.devise);
    toast(`Client : ${t.nom}`, 'success');
  };

  if (erreur) return <div className="alert-err">{erreur}</div>;
  if (!tenants) return <div className="loading-msg">Chargement…</div>;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Clients</h2>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{tenants.length} client{tenants.length > 1 ? 's' : ''} enregistré{tenants.length > 1 ? 's' : ''}</span>
        </div>
        {isSuperAdmin && (
          <button className="btn-add" onClick={() => setModal('new')} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', fontSize: 13 }}>
            <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Nouveau client
          </button>
        )}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Client</th><th>Identifiant</th><th>Statut</th><th>Créé le</th><th>Action</th></tr></thead>
          <tbody>
            {tenants.map((t) => {
              const isActive = t.id === activeTenantId;
              return (
                <tr key={t.id} style={isActive ? { background: '#eff6ff' } : undefined}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: isActive ? 'var(--accent)' : '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: isActive ? 'white' : 'var(--text-muted)', flexShrink: 0 }}>
                        {t.nom.substring(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{t.nom}</div>
                        {isActive && <span style={{ fontSize: 10, background: '#dbeafe', color: '#1d4ed8', padding: '1px 7px', borderRadius: 10, fontWeight: 600 }}>EN COURS</span>}
                      </div>
                    </div>
                  </td>
                  <td><span className="badge-rubrique" style={{ fontFamily: 'monospace', fontSize: 12 }}>{t.slug}</span></td>
                  <td>
                    <span className={'statut-badge ' + (t.actif ? 'statut-valide' : 'statut-rejete')}>{t.actif ? '✓ Actif' : '✗ Inactif'}</span>
                    {isSuperAdmin && (
                      <button
                        onClick={() => onToggle(t)}
                        style={{ marginLeft: 6, fontSize: 10, padding: '2px 8px', border: `1px solid ${t.actif ? '#fca5a5' : '#86efac'}`, borderRadius: 6, background: 'white', cursor: 'pointer', color: t.actif ? '#dc2626' : '#16a34a', fontWeight: 600 }}
                      >
                        {t.actif ? 'Désactiver' : 'Activer'}
                      </button>
                    )}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{new Date(t.created_at).toLocaleDateString('fr-FR')}</td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
                      {isActive
                        ? <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>✓ Sélectionné</span>
                        : <button className="btn-add" style={{ fontSize: 12, padding: '5px 12px' }} onClick={() => onSwitch(t)}>Travailler sur ce client</button>}
                      {isSuperAdmin && (
                        <button
                          onClick={() => setModal({ perms: t })}
                          style={{ fontSize: 11, padding: '4px 10px', border: '1px solid #c7d2fe', borderRadius: 6, background: '#eef2ff', color: '#4f46e5', cursor: 'pointer', fontWeight: 600 }}
                        >
                          🔐 Permissions
                        </button>
                      )}
                      {isSuperAdmin && (
                        <button
                          onClick={() => setModal({ suppr: t })}
                          title="Réservé à un client ajouté manuellement et jamais utilisé"
                          style={{ fontSize: 11, padding: '4px 10px', border: '1px solid #fecaca', borderRadius: 6, background: 'white', color: '#b91c1c', cursor: 'pointer', fontWeight: 600 }}
                        >
                          🗑 Supprimer
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modal === 'new' && (
        <NouveauClientAssistant slugsExistants={tenants.map((t) => t.slug)} onFermer={() => setModal(null)} onCree={() => charger()} />
      )}
      {modal?.suppr && (
        <SuppressionClient
          id={modal.suppr.id}
          onAnnuler={() => setModal(null)}
          onSupprime={() => { if (modal.suppr.id === activeTenantId) selectTenant(null, ''); setModal(null); charger(); }}
        />
      )}
      {modal?.perms && (
        <PermissionsAssignModal
          title={`Permissions — ${modal.perms.nom}`}
          grantedUrl={`/tenants/${modal.perms.id}/permissions`}
          saveUrl={`/tenants/${modal.perms.id}/permissions`}
          onClose={() => setModal(null)}
          onSaved={(count) => { setModal(null); toast(`${count} permission${count > 1 ? 's' : ''} enregistrée${count > 1 ? 's' : ''}.`, 'success'); }}
        />
      )}
    </>
  );
}
