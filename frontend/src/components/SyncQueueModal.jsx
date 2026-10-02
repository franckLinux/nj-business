import { useEffect, useState } from 'react';
import { syncManager } from '@/lib/syncManager';

// Reprend openSyncPage()/closeModalSync() de legacy/js/app.js (l. 6179-6209).
export default function SyncQueueModal({ onClose }) {
  const [ops, setOps] = useState([]);

  useEffect(() => {
    syncManager.getAll().then((all) => setOps(all));
  }, []);

  const statutBadge = (statut) => {
    const cls = statut === 'done' ? 'statut-valide' : statut === 'error' ? 'statut-rejete' : 'statut-attente';
    return <span className={`statut-badge ${cls}`}>{statut}</span>;
  };

  const onClearDone = async () => { await syncManager.clearDone(); onClose(); };
  const onForceSync = async () => { await syncManager.replayAll(); onClose(); };

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 680 }}>
        <div className="modal-head">
          <h3>🔄 File de synchronisation</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ padding: '16px 24px' }}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <span className="statut-badge statut-attente">{ops.filter((o) => o.statut === 'pending').length} en attente</span>
            <span className="statut-badge statut-valide">{ops.filter((o) => o.statut === 'done').length} synchronisé(s)</span>
            <span className="statut-badge statut-rejete">{ops.filter((o) => o.statut === 'error').length} erreur(s)</span>
          </div>
          <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table>
              <thead><tr><th>Date</th><th>Méthode</th><th>URL</th><th>Statut</th></tr></thead>
              <tbody>
                {ops.length === 0 ? (
                  <tr><td colSpan={4} style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>Aucune opération</td></tr>
                ) : ops.slice(-20).reverse().map((o) => (
                  <tr key={o.id}>
                    <td style={{ fontSize: 11 }}>{new Date(o.created_at).toLocaleString('fr-FR')}</td>
                    <td><span className="badge-rubrique">{o.method}</span></td>
                    <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{o.url}</td>
                    <td>{statutBadge(o.statut)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClearDone}>Vider terminés</button>
          <button className="btn-add" onClick={onForceSync}>🔄 Forcer sync</button>
        </div>
      </div>
    </div>
  );
}
