import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import PlanComptableAutocomplete from '@/components/PlanComptableAutocomplete';
import { useContexteProjets, NATURES_RECETTE, natureAffectee, libelleNature } from '@/lib/projets';

// Reprend loadTabRubriques()/openModalRubrique()/saveRubrique()/deleteRubrique()
// de legacy/js/app.js (l. 4546-4771).
function VirementBadge({ oui }) {
  return oui ? (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' }}>✓ Oui</span>
  ) : (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: '#dcfce7', color: '#166534', border: '1px solid #86efac' }}>✗ Non</span>
  );
}

// `simple` (044) : ajout par la caissière (rubriques.create sans rubriques.edit) :
// ni code comptable ni virement interne, qui relèvent du comptable.
export function RubriqueModal({ rubrique, defaultType, onClose, onSaved, simple = false }) {
  const isEdit = !!rubrique;
  const [code, setCode] = useState(rubrique?.code || '');
  const [type, setType] = useState(rubrique?.type || defaultType || 'entree');
  const [intitule, setIntitule] = useState(rubrique?.intitule || '');
  const [codeComptable, setCodeComptable] = useState(rubrique?.code_comptable || '');
  const [virement, setVirement] = useState(!!rubrique?.est_virement_interne);
  // Nature de la recette (069) : ONG / associations, rubriques d'entrée.
  const ong = Boolean(useContexteProjets()?.ong);
  const [nature, setNature] = useState(rubrique?.nature_recette || '');
  const avecNature = ong && !simple && type === 'entree';
  const [erreur, setErreur] = useState('');
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    const intituleMaj = intitule.trim().toUpperCase();
    const codeMaj = code.trim().toUpperCase();
    if (!intituleMaj) { setErreur('Intitulé obligatoire.'); return; }
    if (!isEdit && !codeMaj) { setErreur('Code obligatoire.'); return; }

    const base = isEdit
      ? { intitule: intituleMaj, code_comptable: codeComptable.trim() || null, est_virement_interne: virement, ordre: 0, actif: true }
      : simple
        ? { code: codeMaj, intitule: intituleMaj, type, ordre: 0 }
        : { code: codeMaj, intitule: intituleMaj, type, code_comptable: codeComptable.trim() || null, est_virement_interne: virement, ordre: 0 };
    const body = avecNature ? { ...base, nature_recette: nature || null } : base;

    setSaving(true);
    const res = isEdit ? await api.put(`/rubriques/${rubrique.id}`, body) : await api.post('/rubriques', body);
    setSaving(false);
    if (res.error) { setErreur(res.error); return; }
    // Compte déjà validé par le cabinet : le nouveau code devient une proposition.
    onSaved(res.passerelle_message || res.message || (isEdit ? 'Rubrique modifiée ✓' : 'Rubrique créée ✓'), res);
  };

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box">
        <div className="modal-head">
          <h3>{isEdit ? 'Modifier la rubrique' : 'Nouvelle rubrique'}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="fgrid2">
            <div>
              <label>Code *</label>
              <input
                type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Ex: 14, ABQ, SCOM"
                readOnly={isEdit} style={isEdit ? { background: '#f8fafc', fontFamily: 'monospace' } : undefined}
              />
            </div>
            <div>
              <label>Type *</label>
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="entree">Entrée</option>
                <option value="depense">Dépense</option>
              </select>
            </div>
          </div>

          <label>Intitulé *</label>
          <input type="text" value={intitule} onChange={(e) => setIntitule(e.target.value)} placeholder="Ex: FRAIS DE TRANSPORT DIVERS" />

          {simple ? (
            <div style={{ marginTop: 12, background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e3a8a', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
              Le code comptable de la rubrique sera défini par le comptable (Contrôle comptable → Contrôle de régularité formelle).
            </div>
          ) : (<>
          <label>Code comptable
            <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 4 }}>(optionnel — SYSCOHADA / SAGE i7)</span>
          </label>
          <PlanComptableAutocomplete value={codeComptable} onChange={setCodeComptable} placeholder="Ex: 6251, transport, salaire…" />

          {avecNature && (
            <>
              <label style={{ marginTop: 14, display: 'block' }}>Nature de la recette</label>
              <select value={nature} onChange={(e) => setNature(e.target.value)}>
                <option value="">— Non précisée —</option>
                <optgroup label="Affectée à un projet (projet obligatoire à la saisie)">
                  {NATURES_RECETTE.filter((n) => n.affectee).map((n) => <option key={n.code} value={n.code}>{n.libelle}</option>)}
                </optgroup>
                <optgroup label="Non affectée">
                  {NATURES_RECETTE.filter((n) => !n.affectee).map((n) => <option key={n.code} value={n.code}>{n.libelle}</option>)}
                </optgroup>
              </select>
              {natureAffectee(nature) && (
                <div className="field-hint" style={{ color: '#065f46' }}>
                  À chaque entrée sur cette rubrique, le projet bénéficiaire sera demandé : le montant ira au financement reçu du projet.
                </div>
              )}
            </>
          )}

          <label style={{ marginTop: 14, display: 'block' }}>Virement interne</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
            <label className="toggle-switch">
              <input type="checkbox" checked={virement} onChange={(e) => setVirement(e.target.checked)} />
              <span className="toggle-slider" />
            </label>
            <span style={{ fontSize: 13 }}>
              {virement
                ? <span style={{ color: '#991b1b', fontWeight: 600 }}>Oui — exclure du budget</span>
                : <span style={{ color: '#166534', fontWeight: 600 }}>Non — inclure dans le budget</span>}
            </span>
          </div>
          </>)}

          {erreur && <div className="alert-err" style={{ marginTop: 12 }}>{erreur}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn-primary" style={{ width: 'auto', marginTop: 0 }} onClick={onSave} disabled={saving}>💾 Enregistrer</button>
        </div>
      </div>
    </div>
  );
}

function NatureBadge({ code }) {
  if (!code) return <span style={{ color: 'var(--text-light)' }}>—</span>;
  return <span className={`badge-nature${natureAffectee(code) ? '' : ' badge-nature-libre'}`}>{libelleNature(code)}</span>;
}

function Section({ titre, liste, type, canEdit, canAdd = canEdit, onAdd, onEdit, onDelete, avecNature = false }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h4 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: 'var(--text-muted)' }}>{titre} ({liste.length})</h4>
        {canAdd && <button className="btn-add" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => onAdd(type)}>+ Ajouter</button>}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Code</th><th>Intitulé</th><th>Code comptable</th>{avecNature && <th>Nature</th>}<th style={{ textAlign: 'center' }}>Virement interne</th>
              {canEdit && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {liste.map((r) => (
              <tr key={r.id}>
                <td><span className="badge-rubrique">{r.code}</span></td>
                <td style={{ fontWeight: 500 }}>{r.intitule}</td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                  {r.code_comptable || <span style={{ color: 'var(--text-light)' }}>—</span>}
                </td>
                {avecNature && <td><NatureBadge code={r.nature_recette} /></td>}
                <td style={{ textAlign: 'center' }}><VirementBadge oui={r.est_virement_interne} /></td>
                {canEdit && (
                  <td>
                    <div className="row-actions">
                      <button className="btn-icon" onClick={() => onEdit(r)}>✏️</button>
                      <button className="btn-icon danger" onClick={() => onDelete(r.id)}>✕</button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {liste.length === 0 && (
              <tr><td colSpan={avecNature ? 6 : 5} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Aucune rubrique.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function RubriquesTab() {
  const { can, rubriques, loadRubriques } = useApp();
  const toast = useToast();
  const ong = Boolean(useContexteProjets()?.ong);
  const [modal, setModal] = useState(null); // null | { type } | rubrique

  const peutGerer = can('rubriques.edit');
  // 044 : la caissière ajoute des rubriques pour sa saisie, sans les modifier.
  const peutAjouter = peutGerer || can('rubriques.create');

  const onDelete = async (id) => {
    if (!window.confirm('Désactiver cette rubrique ?')) return;
    await api.delete(`/rubriques/${id}`);
    toast('Rubrique désactivée.', 'success');
    loadRubriques();
  };

  return (
    <>
      <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Rubriques</h3>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 18 }}>
        {peutGerer
          ? 'Le code comptable est facultatif. Une fois validé par le cabinet (menu Contrôle comptable → Contrôle de régularité formelle), il ne change plus qu\'après une nouvelle validation.'
          : 'Vous pouvez ajouter les rubriques utiles à votre saisie. Leur code comptable est défini par le comptable.'}
      </p>
      <Section titre="Entrées" avecNature={ong} liste={rubriques.entrees || []} type="entree" canEdit={peutGerer} canAdd={peutAjouter} onAdd={(t) => setModal({ type: t })} onEdit={setModal} onDelete={onDelete} />
      <Section titre="Dépenses" liste={rubriques.depenses || []} type="depense" canEdit={peutGerer} canAdd={peutAjouter} onAdd={(t) => setModal({ type: t })} onEdit={setModal} onDelete={onDelete} />

      {modal && (
        <RubriqueModal
          rubrique={modal.type ? null : modal}
          defaultType={modal.type}
          simple={!peutGerer}
          onClose={() => setModal(null)}
          onSaved={(msg) => { setModal(null); toast(msg, 'success'); loadRubriques(); }}
        />
      )}
    </>
  );
}
