import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import PermissionsAssignModal from '@/components/PermissionsAssignModal';
import SuppressionClient from '@/components/SuppressionClient';

// Reprend loadTenants()/openModalNewTenant()/saveNewTenant()/toggleTenantActif()/
// switchTenant() de legacy/js/app.js (l. 5987-6124).
// Lot B (065) : le client est créé avec son identité seule ; les modules cochés
// sont activés dans la même opération (chacun prépare alors ses données). Aucun
// module n'est obligatoire : un client peut être créé puis configuré avant toute
// activation. Les signataires de la caisse se règlent dans ses paramètres.
function NewTenantModal({ onClose, onSaved }) {
  const [nom, setNom] = useState('');
  const [slug, setSlug] = useState('');
  const [devise, setDevise] = useState('FCFA');
  const [catalogue, setCatalogue] = useState(null);
  const [choisis, setChoisis] = useState(['caisse']);
  const [erreur, setErreur] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/plateforme/modules').then((r) => {
      if (r?.error) { setCatalogue([]); return; }
      setCatalogue((r.modules || []).filter((m) => m.statut !== 'retire'));
    });
  }, []);

  const onNomChange = (e) => {
    const v = e.target.value;
    setNom(v);
    setSlug(v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''));
  };
  const basculer = (code) => setChoisis((x) => (x.includes(code) ? x.filter((c) => c !== code) : [...x, code]));

  const onSave = async () => {
    if (!nom.trim()) { setErreur('Le nom du client est obligatoire.'); return; }
    if (!slug.trim()) { setErreur("L'identifiant (slug) est obligatoire."); return; }
    if (!/^[a-z0-9-]+$/.test(slug.trim())) { setErreur('Slug invalide : minuscules, chiffres et tirets uniquement.'); return; }
    setSaving(true);
    const res = await api.post('/tenants', { nom: nom.trim(), slug: slug.trim(), devise, modules: choisis });
    setSaving(false);
    if (res.error) { setErreur(res.error); return; }
    const noms = (catalogue || []).filter((m) => choisis.includes(m.code)).map((m) => m.nom);
    onSaved(`Client "${nom.trim()}" créé ${noms.length ? `avec ${noms.join(' et ')}` : 'sans module (à activer plus tard)'}.`);
  };

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 560 }}>
        <div className="modal-head">
          <h3>🏢 Nouveau client</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-section">
            <label>Nom du client <span className="req">*</span></label>
            <input type="text" value={nom} onChange={onNomChange} placeholder="Ex: Cabinet Dupont" maxLength={100} />
          </div>
          <div className="form-section">
            <label>Identifiant unique (slug) <span className="req">*</span></label>
            <input type="text" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="cabinet-dupont" maxLength={60} style={{ fontFamily: 'monospace' }} />
            <span className="field-hint">Minuscules, chiffres et tirets uniquement — immuable après création.</span>
          </div>
          <div className="form-section">
            <label>Devise</label>
            <select value={devise} onChange={(e) => setDevise(e.target.value)}>
              <option value="FCFA">FCFA — Franc CFA</option>
              <option value="XAF">XAF — Franc CFA (BEAC)</option>
              <option value="EUR">EUR — Euro</option>
              <option value="USD">USD — Dollar américain</option>
            </select>
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: '16px 0 0', minWidth: 0 }}>
            <legend style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-muted)', marginBottom: 4, padding: 0 }}>Modules à activer</legend>
            <span className="field-hint" style={{ display: 'block', marginBottom: 10 }}>Facultatif : un client peut être créé sans module, puis configuré. Les modules s'activent aussi plus tard (Plateforme → Modules).</span>
            {catalogue === null ? <div className="loading-msg">Chargement…</div> : (
              <div style={{ display: 'grid', gap: 8 }}>
                {catalogue.map((m) => {
                  const dispo = m.statut === 'operationnel';
                  return (
                    <label key={m.code} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 12px', borderRadius: 9, cursor: dispo ? 'pointer' : 'not-allowed',
                      textTransform: 'none', letterSpacing: 0, fontWeight: 400, color: 'var(--text)', margin: 0, width: '100%', boxSizing: 'border-box',
                      border: `1.5px solid ${choisis.includes(m.code) ? 'var(--accent)' : 'var(--border)'}`, background: dispo ? 'white' : '#f8fafc', opacity: dispo ? 1 : 0.7 }}>
                      <input type="checkbox" checked={choisis.includes(m.code)} disabled={!dispo} onChange={() => basculer(m.code)}
                        style={{ width: 16, height: 16, minWidth: 16, flex: '0 0 16px', margin: '2px 0 0', padding: 0, appearance: 'auto', WebkitAppearance: 'checkbox', accentColor: 'var(--accent)', borderRadius: 3 }} />
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <b style={{ fontSize: 13 }}>{m.nom}</b>{!dispo && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}> · bientôt disponible</span>}
                        <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)' }}>{m.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>
          {erreur && <div className="alert-err" style={{ marginTop: 10 }}>{erreur}</div>}
        </div>
        <div className="modal-foot" style={{ gap: 10 }}>
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-add" onClick={onSave} disabled={saving}>Créer le client</button>
        </div>
      </div>
    </div>
  );
}

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
        <NewTenantModal onClose={() => setModal(null)} onSaved={(msg) => { setModal(null); toast(msg, 'success'); charger(); }} />
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
