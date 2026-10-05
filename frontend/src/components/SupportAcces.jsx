import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';

// Accès SUPPORT temporaire du super_admin aux données de caisse d'un client
// (réforme, étape 8). La fenêtre s'ouvre quand l'API répond SUPPORT_REQUIS
// (lib/api.js) ; le bandeau rappelle la session en cours et permet de la fermer.
const DUREES = [15, 30, 60, 120, 240];

export default function SupportAcces() {
  const { user, activeTenantId, activeTenantNom } = useApp();
  const toast = useToast();
  const [sessions, setSessions] = useState([]);
  const [demande, setDemande] = useState(null); // { tenantId }
  const [motif, setMotif] = useState('');
  const [duree, setDuree] = useState(30);
  const [confirme, setConfirme] = useState(false);
  const [erreur, setErreur] = useState('');
  const estSuperAdmin = user?.role === 'super_admin';

  const charger = useCallback(async () => {
    if (!estSuperAdmin) return;
    const r = await api.get('/plateforme/support');
    if (!r.error) setSessions(r.sessions || []);
  }, [estSuperAdmin]);

  useEffect(() => {
    if (!estSuperAdmin) return undefined;
    charger();
    const id = setInterval(charger, 60000);
    const onRequis = (e) => { setDemande({ tenantId: e.detail?.tenantId || activeTenantId }); setErreur(''); setConfirme(false); };
    window.addEventListener('support-requis', onRequis);
    return () => { clearInterval(id); window.removeEventListener('support-requis', onRequis); };
  }, [estSuperAdmin, charger, activeTenantId]);

  if (!estSuperAdmin) return null;

  const ouvrir = async () => {
    if (motif.trim().length < 10) { setErreur('Le motif doit faire au moins 10 caractères.'); return; }
    if (!confirme) { setErreur('Cochez la confirmation.'); return; }
    const r = await api.post('/plateforme/support', { tenant_id: demande.tenantId, motif: motif.trim(), duree_minutes: duree });
    if (r.error) { setErreur(r.error); return; }
    toast(`Accès support ouvert jusqu'à ${new Date(r.expire_le).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`, 'success');
    setDemande(null); setMotif('');
    window.location.reload(); // recharge l'écran demandé, désormais autorisé
  };

  const fermer = async (s) => {
    const r = await api.delete(`/plateforme/support/${s.id}`);
    if (r.error) { toast(r.error, 'error'); return; }
    toast('Accès support fermé.', 'success');
    window.location.reload();
  };

  return (
    <>
      {sessions.map((s) => (
        <div key={s.id} style={{ background: '#fef3c7', borderBottom: '1px solid #fcd34d', color: '#92400e', padding: '6px 16px', fontSize: 12, display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
          <span>🛟 <strong>Accès support</strong> à « {s.client} » jusqu'à {new Date(s.expire_le).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} — {s.motif} (tracé dans le journal d'audit)</span>
          <button className="btn-ghost" style={{ padding: '2px 10px', fontSize: 12 }} onClick={() => fermer(s)}>Terminer</button>
        </div>
      ))}
      {demande && (
        <div className="modal-overlay" style={{ display: 'flex' }}>
          <div className="modal-box" style={{ maxWidth: 520 }}>
            <div className="modal-head"><h3>🛟 Accès support requis</h3><button className="modal-close" onClick={() => setDemande(null)}>✕</button></div>
            <div className="modal-body">
              <p style={{ fontSize: 13, marginTop: 0 }}>
                En tant qu'administrateur plateforme, vous n'accédez pas automatiquement aux données de caisse
                {activeTenantNom ? <> de <strong>{activeTenantNom}</strong></> : ' de ce client'}. Un accès support temporaire est
                <strong> enregistré dans le journal d'audit</strong> avec votre nom, le motif et la durée.
              </p>
              <div className="form-section">
                <label>Motif <span className="req">*</span></label>
                <input value={motif} onChange={(e) => setMotif(e.target.value)} maxLength={300} placeholder="Ex : Correction du RAN demandée par le directeur" />
              </div>
              <div className="form-section">
                <label>Durée</label>
                <select value={duree} onChange={(e) => setDuree(Number(e.target.value))}>
                  {DUREES.map((d) => <option key={d} value={d}>{d < 60 ? `${d} minutes` : `${d / 60} heure(s)`}</option>)}
                </select>
              </div>
              <div style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }} onClick={() => setConfirme((x) => !x)}>
                <input type="checkbox" checked={confirme} readOnly style={{ width: 16, height: 16, flex: 'none', margin: 0 }} />
                <span>Je confirme avoir besoin d'accéder aux données de ce client pour ce motif.</span>
              </div>
              {erreur && <div className="alert-err" style={{ marginTop: 10 }}>{erreur}</div>}
            </div>
            <div className="modal-foot" style={{ gap: 10 }}>
              <button className="btn-secondary" onClick={() => setDemande(null)}>Annuler</button>
              <button className="btn-add" onClick={ouvrir}>Ouvrir l'accès support</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
