import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';

// Reprend loadTabPieces()/openModalPieceType()/savePieceType()/deletePieceType()
// de legacy/js/app.js (l. 4827-4969).
function PieceTypeModal({ item, allRubriques, onClose, onSaved }) {
  const isEdit = !!item?.id;
  const [rubrique, setRubrique] = useState(item?.rubrique_code || '');
  const [intitule, setIntitule] = useState(item?.intitule_piece || '');
  const [description, setDescription] = useState(item?.description || '');
  const [obligatoire, setObligatoire] = useState(!!item?.obligatoire);
  const [erreur, setErreur] = useState('');
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    if (!rubrique || !intitule.trim()) { setErreur('Rubrique et intitulé obligatoires.'); return; }
    const body = { rubrique_code: rubrique, intitule_piece: intitule.trim(), description: description.trim(), obligatoire };
    setSaving(true);
    const res = isEdit ? await api.put(`/pieces/types/${item.id}`, body) : await api.post('/pieces/types', body);
    setSaving(false);
    if (res.error) { setErreur(res.error); return; }
    onSaved(isEdit ? 'Pièce modifiée ✓' : 'Pièce ajoutée ✓');
  };

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 480 }}>
        <div className="modal-head">
          <h3>{isEdit ? 'Modifier' : 'Nouvelle pièce justificative'}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <label>Rubrique *</label>
          <select value={rubrique} onChange={(e) => setRubrique(e.target.value)}>
            <option value="">— Choisir —</option>
            {allRubriques.map((r) => <option key={r.code} value={r.code}>[{r.code}] {r.intitule}</option>)}
          </select>
          <label>Intitulé de la pièce *</label>
          <input type="text" value={intitule} onChange={(e) => setIntitule(e.target.value)} placeholder="Ex: Bon de commande, Facture fournisseur…" />
          <label>Description / Précision</label>
          <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex: Signé par le directeur et tamponné" />
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
            <label className="toggle-switch">
              <input type="checkbox" checked={obligatoire} onChange={(e) => setObligatoire(e.target.checked)} />
              <span className="toggle-slider" />
            </label>
            <span style={{ fontSize: 13, fontWeight: 500 }}>Pièce obligatoire</span>
          </div>
          {erreur && <div className="alert-err" style={{ marginTop: 10 }}>{erreur}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn-primary" style={{ width: 'auto', marginTop: 0 }} onClick={onSave} disabled={saving}>💾 Enregistrer</button>
        </div>
      </div>
    </div>
  );
}

export default function PiecesTab() {
  const { can } = useApp();
  const toast = useToast();
  const [types, setTypes] = useState(null);
  const [allRubriques, setAllRubriques] = useState([]);
  const [erreur, setErreur] = useState('');
  const [modal, setModal] = useState(null); // null | 'new' | { rubrique_code } | item

  const canEdit = can('pieces.edit');

  const charger = useCallback(async () => {
    const [t, r] = await Promise.all([api.get('/pieces/types'), api.get('/rubriques')]);
    if (t.error) { setErreur(t.error); return; }
    setTypes(t);
    setAllRubriques([...(r.entrees || []), ...(r.depenses || [])]);
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const onDelete = async (id) => {
    if (!window.confirm('Supprimer ce type de pièce ?')) return;
    await api.delete(`/pieces/types/${id}`);
    toast('Type supprimé.', 'success');
    charger();
  };

  if (erreur) return <div className="alert-err">{erreur}</div>;
  if (!types) return <div className="loading-msg">Chargement…</div>;

  const grouped = {};
  types.forEach((t) => { (grouped[t.rubrique_code] ??= []).push(t); });

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 700 }}>Pièces justificatives par rubrique</h3>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Définissez les justificatifs attendus pour chaque type de dépense.
            Ils apparaîtront en annotation dans le formulaire de saisie.
          </p>
        </div>
        {canEdit && <button className="btn-add" onClick={() => setModal('new')}>+ Ajouter</button>}
      </div>

      {Object.keys(grouped).length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, background: 'white', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>📎</div>
          <p>Aucune pièce justificative configurée.</p>
          <p style={{ fontSize: 12, marginTop: 4 }}>Commencez par ajouter les justificatifs attendus par rubrique.</p>
        </div>
      ) : Object.entries(grouped).map(([code, items]) => {
        const rub = allRubriques.find((r) => r.code === code);
        return (
          <div key={code} style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 12, overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', background: '#f8fafc', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="badge-rubrique">{code}</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{rub?.intitule || code}</span>
              </div>
              {canEdit && <button className="btn-icon" style={{ fontSize: 12 }} onClick={() => setModal({ rubrique_code: code, id: null })}>+ Ajouter</button>}
            </div>
            <div style={{ padding: '10px 16px' }}>
              {items.map((item) => (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid #f8fafc' }}>
                  <span style={{ fontSize: 16 }}>{item.obligatoire ? '🔴' : '🟡'}</span>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{item.intitule_piece}</span>
                    {item.description && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>— {item.description}</span>}
                  </div>
                  <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, fontWeight: 600, background: item.obligatoire ? '#fee2e2' : '#fef3c7', color: item.obligatoire ? '#991b1b' : '#92400e' }}>
                    {item.obligatoire ? 'Obligatoire' : 'Recommandée'}
                  </span>
                  {canEdit && (
                    <div className="row-actions">
                      <button className="btn-icon" onClick={() => setModal(item)}>✏️</button>
                      <button className="btn-icon danger" onClick={() => onDelete(item.id)}>✕</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {modal && (
        <PieceTypeModal
          item={modal === 'new' ? null : modal}
          allRubriques={allRubriques}
          onClose={() => setModal(null)}
          onSaved={(msg) => { setModal(null); toast(msg, 'success'); charger(); }}
        />
      )}
    </>
  );
}
