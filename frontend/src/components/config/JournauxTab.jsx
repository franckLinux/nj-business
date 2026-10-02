import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { UserModal } from '@/components/config/UsersTab';

// Reprend loadTabJournaux()/openModalJournal()/saveJournal()/deleteJournal()
// de legacy/js/app.js (l. 4335-4543).
const TYPES_ICONS = { caisse: '💵', banque: '🏦', om: '🟠', momo: '🟡', carte_prepayee: '💳', autre: '📒' };
const TYPE_LABELS = { caisse: 'Caisse', banque: 'Banque', om: 'Orange Money', momo: 'MTN MOMO', carte_prepayee: 'Carte Prépayée', autre: 'Autre' };
const TYPES = ['caisse', 'banque', 'om', 'momo', 'carte_prepayee', 'autre'];

function JournalModal({ journal, users, onClose, onSaved, onNeedUser, presetUser }) {
  const isEdit = !!journal;
  const [code, setCode] = useState(journal?.code || '');
  const [type, setType] = useState(journal?.type || 'caisse');
  const [nom, setNom] = useState(journal?.nom || '');
  const [saisie, setSaisie] = useState(journal?.responsable_saisie || '');
  const [arret, setArret] = useState(journal?.responsable_arret || '');
  const [ordre, setOrdre] = useState(journal?.ordre || 0);
  const [actif, setActif] = useState(journal?.actif !== false);
  const [erreur, setErreur] = useState('');
  const [saving, setSaving] = useState(false);
  const codeEditedRef = useRef(isEdit);

  // Présélectionne l'utilisateur qui vient d'être créé depuis cette modale
  // (bouton « + Créer » sur Responsable saisie/arrêt).
  useEffect(() => {
    if (!presetUser) return;
    if (presetUser.target === 'saisie') setSaisie(presetUser.id);
    else if (presetUser.target === 'arret') setArret(presetUser.id);
  }, [presetUser]);

  // Auto-suggestion du code (création uniquement, tant que l'utilisateur n'a pas tapé lui-même).
  useEffect(() => {
    if (isEdit || codeEditedRef.current) return;
    api.get(`/journaux/next-code?type=${encodeURIComponent(type)}`).then((res) => {
      if (res?.code) setCode(res.code);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const onCodeChange = (e) => { codeEditedRef.current = true; setCode(e.target.value); };

  const onSave = async () => {
    if (!nom.trim() || !type) { setErreur('Nom et type obligatoires.'); return; }
    const body = {
      code: code.trim().toUpperCase(), nom: nom.trim(), type,
      ordre: parseInt(ordre, 10) || 0,
      responsable_saisie: saisie || null, responsable_arret: arret || null,
      ...(isEdit ? { actif } : {}),
    };
    setSaving(true);
    const res = isEdit ? await api.put(`/journaux/${journal.id}`, body) : await api.post('/journaux', body);
    setSaving(false);
    if (res.error) { setErreur(res.error); return; }
    onSaved(isEdit ? 'Journal modifié ✓' : `Journal créé ✓ (${res.code})`);
  };

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box">
        <div className="modal-head">
          <h3>{isEdit ? 'Modifier le journal' : 'Nouveau journal'}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="fgrid2">
            <div>
              <label>Code {!isEdit && <span style={{ fontWeight: 400, color: 'var(--text-muted)', textTransform: 'none', letterSpacing: 0 }}>(auto)</span>} *</label>
              <input
                type="text" value={code} onChange={onCodeChange} placeholder="Auto : CS1, BQ1…"
                readOnly={isEdit} style={isEdit ? { background: '#f8fafc' } : undefined}
              />
            </div>
            <div>
              <label>Type *</label>
              <select value={type} onChange={(e) => setType(e.target.value)} disabled={isEdit} style={isEdit ? { background: '#f8fafc' } : undefined}>
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <label>Nom *</label>
          <input type="text" value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Ex: Caisse Secrétariat" />

          <div className="fgrid2">
            <div>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Responsable saisie</span>
                <button
                  type="button" title="Créer un nouvel utilisateur" onClick={() => onNeedUser('saisie')}
                  style={{ background: 'none', border: '1.5px solid var(--border)', borderRadius: 6, padding: '1px 8px', fontSize: 12, cursor: 'pointer', color: 'var(--accent-purple,#7c3aed)', fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}
                >+ Créer</button>
              </label>
              <select value={saisie} onChange={(e) => setSaisie(e.target.value)}>
                <option value="">— Aucun —</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.username} ({u.role})</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Responsable arrêt</span>
                <button
                  type="button" title="Créer un nouvel utilisateur" onClick={() => onNeedUser('arret')}
                  style={{ background: 'none', border: '1.5px solid var(--border)', borderRadius: 6, padding: '1px 8px', fontSize: 12, cursor: 'pointer', color: 'var(--accent-purple,#7c3aed)', fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}
                >+ Créer</button>
              </label>
              <select value={arret} onChange={(e) => setArret(e.target.value)}>
                <option value="">— Aucun —</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.username} ({u.role})</option>)}
              </select>
            </div>
          </div>

          <label>Ordre d'affichage</label>
          <input type="number" min="0" value={ordre} onChange={(e) => setOrdre(e.target.value)} />
          {isEdit && (
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" id="jl-actif" checked={actif} onChange={(e) => setActif(e.target.checked)} style={{ width: 'auto' }} />
              <label htmlFor="jl-actif" style={{ margin: 0, textTransform: 'none', fontSize: 13 }}>Journal actif</label>
            </div>
          )}
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

export default function JournauxTab() {
  const { can, loadJournaux: reloadNav } = useApp();
  const toast = useToast();
  const [journaux, setJournaux] = useState(null);
  const [users, setUsers] = useState([]);
  const [erreur, setErreur] = useState('');
  const [modal, setModal] = useState(null); // null | 'new' | journal
  const [needUserFor, setNeedUserFor] = useState(null); // null | 'saisie' | 'arret'
  const [presetUser, setPresetUser] = useState(null);

  const canEdit = can('journaux.edit');

  const charger = useCallback(async () => {
    const [data, u] = await Promise.all([api.get('/journaux'), api.get('/users')]);
    if (data.error) { setErreur(data.error); return; }
    setJournaux(data.journaux || []);
    setUsers(Array.isArray(u) ? u : []);
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const onDelete = async (id) => {
    if (!window.confirm("Supprimer ce journal ? (Impossible s'il contient des mouvements)")) return;
    const res = await api.delete(`/journaux/${id}`);
    if (res.error) { toast(res.error, 'error'); return; }
    toast('Journal supprimé.', 'success');
    reloadNav(); charger();
  };

  if (erreur) return <div className="alert-err">{erreur}</div>;
  if (!journaux) return <div className="loading-msg">Chargement…</div>;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700 }}>Journaux ({journaux.length})</h3>
        {canEdit && <button className="btn-add" onClick={() => setModal('new')}>+ Nouveau journal</button>}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Icône</th><th>Code</th><th>Nom</th><th>Type</th><th>Responsable saisie</th><th>Responsable arrêt</th><th>Statut</th>{canEdit && <th>Actions</th>}</tr>
          </thead>
          <tbody>
            {journaux.map((j) => (
              <tr key={j.id} style={!j.actif ? { opacity: .5 } : undefined}>
                <td style={{ fontSize: 18 }}>{TYPES_ICONS[j.type] || '📒'}</td>
                <td><span className="badge-rubrique">{j.code}</span></td>
                <td><strong>{j.nom}</strong></td>
                <td>{TYPE_LABELS[j.type] || j.type}</td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{j.responsable_saisie_nom || '—'}</td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{j.responsable_arret_nom || '—'}</td>
                <td><span className={'statut-badge ' + (j.actif ? 'statut-valide' : 'statut-rejete')}>{j.actif ? 'Actif' : 'Inactif'}</span></td>
                {canEdit && (
                  <td>
                    <div className="row-actions">
                      <button className="btn-icon" onClick={() => setModal(j)}>✏️</button>
                      <button className="btn-icon danger" onClick={() => onDelete(j.id)}>✕</button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <JournalModal
          journal={modal === 'new' ? null : modal}
          users={users}
          presetUser={presetUser}
          onClose={() => setModal(null)}
          onSaved={(msg) => { setModal(null); setPresetUser(null); toast(msg, 'success'); reloadNav(); charger(); }}
          onNeedUser={(target) => setNeedUserFor(target)}
        />
      )}

      {needUserFor && (
        <UserModal
          user={null}
          onClose={() => setNeedUserFor(null)}
          onSaved={async (msg, created) => {
            toast(msg, 'success');
            const u = await api.get('/users');
            if (Array.isArray(u)) setUsers(u);
            setPresetUser({ target: needUserFor, id: created?.id });
            setNeedUserFor(null);
          }}
        />
      )}
    </>
  );
}
