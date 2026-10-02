import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { fmt } from '@/lib/format';

// Reprend #modal-arret de legacy/js/app.js (openModalArretCaisse/confirmerArret, l. 1641-1725).
export default function ArretCaisseModal({ journal, soldeFinal, onClose, onSaved }) {
  const { mois, annee, devise } = useApp();
  const toast = useToast();

  const [commentaire, setCommentaire] = useState('');
  const [saving, setSaving] = useState(false);

  const soldeFinalNum = parseFloat(soldeFinal) || 0;

  const onConfirm = async () => {
    setSaving(true);
    const res = await api.post(`/journaux/${journal.id}/arreter`, {
      mois, annee, solde_final: soldeFinalNum, commentaire: commentaire.trim(),
    });
    setSaving(false);
    if (res.error) { toast(res.error, 'error'); return; }
    toast(`Caisse arrêtée pour ${mois} ${annee} ✓`, 'success');
    onSaved();
  };

  return (
    <div className="modal-overlay" style={{ display: 'flex' }}>
      <div className="modal-box" style={{ maxWidth: 480 }}>
        <div className="modal-head" style={{ background: 'linear-gradient(135deg,#d97706,#b45309)' }}>
          <h3 style={{ color: 'white' }}>🔒 Arrêt de caisse</h3>
          <button className="modal-close" onClick={onClose} style={{ color: 'white', opacity: .8 }}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '14px 16px', marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: '#92400e', marginBottom: 8 }}>
              Récapitulatif — {journal.nom} · {mois} {annee}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div style={{ textAlign: 'center', padding: 10, background: 'white', borderRadius: 8, border: '1px solid #fde68a' }}>
                <div style={{ fontSize: 11, color: '#92400e', fontWeight: 600, marginBottom: 4 }}>SOLDE FINAL</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: soldeFinalNum >= 0 ? '#15803d' : '#dc2626' }}>
                  {fmt(Math.abs(soldeFinalNum), devise)}
                </div>
                {soldeFinalNum < 0 && <div style={{ fontSize: 10, color: '#dc2626', fontWeight: 600 }}>⚠️ Solde négatif</div>}
              </div>
              <div style={{ textAlign: 'center', padding: 10, background: 'white', borderRadius: 8, border: '1px solid #fde68a' }}>
                <div style={{ fontSize: 11, color: '#92400e', fontWeight: 600, marginBottom: 4 }}>DATE D'ARRÊT</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#78350f' }}>
                  {new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}
                </div>
                <div style={{ fontSize: 11, color: '#a16207' }}>{new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            </div>
          </div>

          <div className="form-section">
            <label>Commentaire <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>(optionnel)</span></label>
            <input
              type="text" maxLength={300} placeholder="Ex: Arrêt de fin de mois, caisse vérifiée et conforme…"
              value={commentaire} onChange={(e) => setCommentaire(e.target.value)}
            />
          </div>

          <div style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 4 }}>
            <span style={{ fontSize: 16, flexShrink: 0 }}>⚠️</span>
            <p style={{ fontSize: 12, color: '#92400e', margin: 0, lineHeight: 1.5 }}>
              L'arrêt <strong>bloque l'ajout de nouveaux mouvements</strong> pour ce mois.
              Seul le directeur pourra rouvrir la caisse.
            </p>
          </div>
        </div>
        <div className="modal-foot" style={{ gap: 10 }}>
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button
            onClick={onConfirm} disabled={saving}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 22px', background: 'linear-gradient(135deg,#d97706,#b45309)', color: 'white', border: 'none', borderRadius: 9, cursor: 'pointer', fontSize: 13, fontWeight: 700, boxShadow: '0 2px 8px rgba(217,119,6,.3)' }}
          >
            {saving ? 'Arrêt en cours…' : "🔒 Confirmer l'arrêt"}
          </button>
        </div>
      </div>
    </div>
  );
}
