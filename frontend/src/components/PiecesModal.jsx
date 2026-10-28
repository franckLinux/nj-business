import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api, API_BASE } from '@/lib/api';

// Pièces jointes d'une écriture existante (C17) : consultation, ajout et
// retrait. Lecture : pieces.view ; ajout/retrait : pieces.upload.
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const taille = (o) => (o > 1048576 ? `${(o / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(o / 1024))} Ko`);

export default function PiecesModal({ m, modifiable, onClose }) {
  const { can } = useApp();
  const toast = useToast();
  const [pieces, setPieces] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const peutJoindre = modifiable && can('pieces.upload');

  const charger = useCallback(async () => {
    const r = await api.get(`/pieces/${m.id}`);
    setPieces(Array.isArray(r) ? r : []);
  }, [m.id]);
  useEffect(() => { charger(); }, [charger]);

  const ajouter = (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) { toast('Fichier trop lourd (max 5 Mo).', 'error'); return; }
    if (!ALLOWED_TYPES.includes(file.type)) { toast('Format non supporté (JPG, PNG, WEBP ou PDF).', 'error'); return; }
    const reader = new FileReader();
    reader.onload = async (ev) => {
      setEnvoi(true);
      const r = await api.post(`/pieces/upload/${m.id}`, { nom_fichier: file.name, mime_type: file.type, data_base64: String(ev.target.result).split(',')[1] });
      setEnvoi(false);
      if (r.error) { toast(r.error, 'error'); return; }
      toast('Pièce jointe ajoutée ✓', 'success');
      charger();
    };
    reader.readAsDataURL(file);
  };

  const retirer = async (p) => {
    if (!window.confirm(`Retirer la pièce « ${p.nom_fichier} » ?`)) return;
    const r = await api.delete(`/pieces/item/${p.id}`);
    if (r.error) { toast(r.error, 'error'); return; }
    toast('Pièce retirée.', 'success');
    charger();
  };

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 520 }}>
        <div className="modal-head">
          <h3>📎 Pièces — écriture n°{m.numero ?? '—'}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>{m.intitule} · {m.rubrique_code}</div>
          {pieces === null ? <div className="loading-msg">Chargement…</div>
            : pieces.length === 0 ? <div style={{ textAlign: 'center', padding: 18, color: 'var(--text-muted)', fontSize: 13 }}>Aucune pièce jointe à cette écriture.</div>
              : pieces.map((p) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 18 }}>{p.type_mime === 'application/pdf' ? '📄' : '🖼️'}</span>
                  <a href={`${API_BASE}${p.storage_url}`} target="_blank" rel="noopener noreferrer" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 600 }}>{p.nom_fichier}</a>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{taille(p.taille_octets || 0)}</span>
                  {peutJoindre && <button className="btn-icon danger" title="Retirer" onClick={() => retirer(p)}>✕</button>}
                </div>
              ))}
          {peutJoindre && (
            <>
              <label htmlFor="pj-ajout" style={{ display: 'flex', justifyContent: 'center', gap: 6, padding: '10px 14px', marginTop: 10, background: '#f8fafc', border: '1.5px dashed var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 13, textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>
                {envoi ? 'Envoi…' : '📎 Ajouter une pièce'} <span className="field-hint" style={{ display: 'inline', margin: 0 }}>&nbsp;JPG, PNG, PDF · max 5 Mo</span>
              </label>
              <input id="pj-ajout" type="file" style={{ display: 'none' }} accept="image/jpeg,image/png,image/webp,application/pdf" onChange={ajouter} disabled={envoi} />
            </>
          )}
          {!modifiable && can('pieces.upload') && <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>Caisse arrêtée ou écriture annulée : consultation seule.</p>}
        </div>
        <div className="modal-foot"><button className="btn-ghost" onClick={onClose}>Fermer</button></div>
      </div>
    </div>
  );
}
