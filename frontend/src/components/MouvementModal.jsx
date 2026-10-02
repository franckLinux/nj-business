import { useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api, API_BASE } from '@/lib/api';
import { syncManager } from '@/lib/syncManager';

// Reprend #modal-mouvement de legacy/index.html + openModalMouvement/saveMouvement
// de legacy/js/app.js (l. 1239-1467), y compris les pièces jointes
// (ajouterFichier/retirerFichier/uploadFichiersForMouvement, l. 1324-1373) et
// le pré-contrôle budgétaire hors-ligne à la création (l. 1404-1424).
// Non porté (pré-existant en legacy, hors scope de cette page) : l'ancien
// flux `require_validation` (le backend actuel n'émet plus que
// `en_attente` / `refus_modification`).
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_FILE_SIZE = 5 * 1024 * 1024;
export default function MouvementModal({ journal, mouvement, onClose, onSaved }) {
  const { mois, annee, rubriques, token, activeTenantId, user } = useApp();
  const toast = useToast();

  const [type, setType] = useState(mouvement ? (parseFloat(mouvement.entree) > 0 ? 'entree' : 'sortie') : '');
  const [rubrique, setRubrique] = useState(mouvement?.rubrique_code || '');
  const [date, setDate] = useState(mouvement?.date || new Date().toISOString().split('T')[0]);
  const [intitule, setIntitule] = useState(mouvement?.intitule || '');
  const [codeComptable, setCodeComptable] = useState(mouvement?.code_comptable || '');
  const [nui, setNui] = useState(mouvement?.nui || '');
  const [objet, setObjet] = useState(mouvement?.objet || '');
  const [beneficiaire, setBeneficiaire] = useState(mouvement?.beneficiaire || '');
  const [telephone, setTelephone] = useState(mouvement?.telephone || '');
  const [montant, setMontant] = useState(mouvement ? (parseFloat(mouvement.entree) > 0 ? mouvement.entree : mouvement.sortie) : '');
  const [erreur, setErreur] = useState('');
  const [piecesHint, setPiecesHint] = useState(null); // { obligatoires:[], recommandees:[] } | null
  const [saving, setSaving] = useState(false);
  const [fichiers, setFichiers] = useState([]); // [{ file, dataUrl, name, type }]

  const listeRubriques = type === 'entree' ? rubriques.entrees : rubriques.depenses;

  // Auto-remplissage code comptable + intitulé + annotation pièces, comme onRubriqueChange().
  useEffect(() => {
    if (!rubrique) { setPiecesHint(null); return; }
    const all = [...(rubriques.entrees || []), ...(rubriques.depenses || [])];
    const rub = all.find((r) => r.code === rubrique);
    setCodeComptable(rub?.code_comptable || '');
    setIntitule((prev) => prev || rub?.intitule || '');

    if (type !== 'sortie') { setPiecesHint(null); return; }
    let annule = false;
    api.get(`/pieces/types?rubrique_code=${rubrique}`).then((types) => {
      if (annule) return;
      if (!Array.isArray(types) || types.length === 0) { setPiecesHint(null); return; }
      setPiecesHint({
        obligatoires: types.filter((t) => t.obligatoire),
        recommandees: types.filter((t) => !t.obligatoire),
      });
    });
    return () => { annule = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rubrique, type]);

  const onTypeChange = (e) => {
    setType(e.target.value);
    setRubrique('');
  };

  const onAjouterFichier = (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) { toast('Fichier trop lourd (max 5 Mo).', 'error'); return; }
    if (!ALLOWED_TYPES.includes(file.type)) { toast('Format non supporté.', 'error'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      setFichiers((prev) => [...prev, { file, dataUrl: ev.target.result, name: file.name, type: file.type }]);
    };
    reader.readAsDataURL(file);
  };

  const onRetirerFichier = (idx) => {
    setFichiers((prev) => prev.filter((_, i) => i !== idx));
  };

  const uploadFichiers = async (mouvementId) => {
    for (const f of fichiers) {
      const base64 = f.dataUrl.split(',')[1];
      await api.post(`/pieces/upload/${mouvementId}`, { nom_fichier: f.name, mime_type: f.type, data_base64: base64 });
    }
  };

  const onSave = async () => {
    const montantNum = parseFloat(montant) || 0;
    if (!type || !rubrique || !intitule.trim() || montantNum <= 0) {
      setErreur('Champs obligatoires manquants.');
      return;
    }
    const body = {
      date, mois, annee,
      journal_id: journal?.id || null,
      type_caisse: journal?.type === 'om' ? 'om' : journal?.type === 'momo' ? 'om' : 'especes',
      rubrique_code: rubrique, intitule: intitule.trim(),
      code_comptable: codeComptable || '',
      nui: nui || '',
      objet, beneficiaire, telephone,
      entree: type === 'entree' ? montantNum : 0,
      sortie: type === 'sortie' ? montantNum : 0,
    };

    // Pré-contrôle budgétaire local (RG-03/RG-06/RG-04) sur données mises en
    // cache, uniquement pour une création hors ligne (reprend saveMouvement,
    // l. 1404-1424). Contrairement au legacy, on ne relance pas le
    // chargement de la page ensuite : notre client API renvoie proprement
    // { error: 'Connexion au serveur impossible.' } hors ligne plutôt que de
    // rejeter la promesse, et ce message remplacerait tout le contenu déjà
    // affiché — on préfère laisser la page telle qu'elle est.
    if (!navigator.onLine && !mouvement) {
      let verdict = { bloque: false, connu: false };
      try { verdict = await syncManager.controleBudgetLocal(body); } catch { /* pré-contrôle indisponible */ }

      const localId = await syncManager.cacheJournalEntry({
        ...body, id: null, type_caisse: body.type_caisse,
        pre_bloque: verdict.bloque, motif_local: verdict.motif || null,
      });
      const tid = activeTenantId || user?.tenantId;
      await syncManager.enqueue({
        method: 'POST', url: API_BASE + '/api/journal', body, local_id: localId,
        headers: { Authorization: `Bearer ${token}`, ...(tid ? { 'X-Tenant-Id': tid } : {}) },
      });
      onClose();
      if (verdict.bloque) {
        toast(`⚠ Dépassement détecté (contrôle local) : ${verdict.message} La sortie sera soumise au directeur à la synchronisation.`, 'warning', 9000);
      } else if (!verdict.connu) {
        toast('💾 Sauvegardé hors ligne — contrôle budgétaire différé à la synchronisation.', '', 6000);
      } else {
        toast('💾 Sauvegardé hors ligne', '');
      }
      return;
    }

    setSaving(true);
    const res = mouvement ? await api.put(`/journal/${mouvement.id}`, body) : await api.post('/journal', body);
    setSaving(false);

    if (res.refus_modification) {
      setErreur(res.message);
      toast(`⚠ ${res.message}`, 'error', 7000);
      return;
    }
    if (res.en_attente) {
      onSaved();
      toast(`⏳ ${res.message}`, 'warning', 8000);
      return;
    }
    if (res.error) { setErreur(res.error); return; }

    if (res.budget_warning) {
      const w = res.budget_warning;
      const isUrgent = w.taux >= 95;
      toast(`${isUrgent ? '🔴' : '🟡'} ${w.message}`, isUrgent ? 'error' : 'warning', 6000);
    }

    if (fichiers.length > 0 && res.id) {
      try { await uploadFichiers(res.id); } catch (e) { console.warn('Upload PJ:', e); }
    }

    onSaved();
    toast(mouvement ? 'Mouvement modifié ✓' : 'Mouvement enregistré ✓', 'success');
  };

  return (
    <div className="modal-overlay" style={{ display: 'flex' }}>
      <div className="modal-box">
        <div className="modal-head">
          <h3>{mouvement ? 'Modifier mouvement' : 'Nouveau mouvement'}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-section">Informations principales</div>
          <div>
            <label>Date <span className="req">*</span></label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label>Type <span className="req">*</span></label>
            <select value={type} onChange={onTypeChange}>
              <option value="">— choisir —</option>
              <option value="entree">Entrée</option>
              <option value="sortie">Sortie</option>
            </select>
          </div>
          <div className="span-2">
            <label>Rubrique <span className="req">*</span></label>
            <select value={rubrique} onChange={(e) => setRubrique(e.target.value)}>
              <option value="">— choisir —</option>
              {(listeRubriques || []).map((r) => (
                <option key={r.code} value={r.code}>[{r.code}] {r.intitule}</option>
              ))}
            </select>
          </div>
          {piecesHint && (
            <div className="span-2" style={{ margin: '6px 0 2px', padding: '8px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 7, fontSize: 12, color: '#92400e' }}>
              <strong style={{ display: 'block', marginBottom: 4 }}>📎 Pièces pour ce type de dépense :</strong>
              {piecesHint.obligatoires.map((t) => (
                <span key={t.id} style={{ display: 'inline-block', margin: '2px 4px 2px 0', padding: '1px 8px', background: '#fee2e2', color: '#991b1b', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>🔴 {t.intitule_piece}</span>
              ))}
              {piecesHint.recommandees.map((t) => (
                <span key={t.id} style={{ display: 'inline-block', margin: '2px 4px 2px 0', padding: '1px 8px', background: '#fef3c7', color: '#92400e', borderRadius: 10, fontSize: 11 }}>🟡 {t.intitule_piece}</span>
              ))}
            </div>
          )}
          <div>
            <label>Intitulé <span className="req">*</span></label>
            <input type="text" placeholder="Libellé du mouvement" value={intitule} onChange={(e) => setIntitule(e.target.value)} />
          </div>
          <div>
            <label>Montant <span className="req">*</span></label>
            <div className="input-group">
              <input type="number" min="0" step="1" placeholder="0" className="has-suffix" value={montant} onChange={(e) => setMontant(e.target.value)} />
              <span className="input-suffix">FCFA</span>
            </div>
          </div>
          <div className="form-section">Détails complémentaires</div>
          <div>
            <label>Code comptable</label>
            <input type="text" placeholder="Auto depuis rubrique" style={{ fontFamily: 'monospace' }} readOnly value={codeComptable} />
          </div>
          <div>
            <label>NUI <span className="field-hint" style={{ display: 'inline', textTransform: 'none', letterSpacing: 0 }}>(optionnel)</span></label>
            <input type="text" placeholder="Numéro Unique d'Identification" value={nui} onChange={(e) => setNui(e.target.value)} />
          </div>
          <div className="span-2">
            <label>Objet / Motif</label>
            <input type="text" placeholder="Détail de l'opération" value={objet} onChange={(e) => setObjet(e.target.value)} />
          </div>
          <div>
            <label>Bénéficiaire</label>
            <input type="text" value={beneficiaire} onChange={(e) => setBeneficiaire(e.target.value)} />
          </div>
          <div>
            <label>Téléphone</label>
            <input type="text" value={telephone} onChange={(e) => setTelephone(e.target.value)} />
          </div>
          <div className="form-section">Pièces jointes</div>
          <div className="span-2">
            {fichiers.length > 0 && (
              <div style={{ marginBottom: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {fichiers.map((f, idx) => (
                  <div
                    key={idx}
                    style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 7, fontSize: 12 }}
                  >
                    <span>{f.type === 'application/pdf' ? '📄' : '🖼️'}</span>
                    <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                    <button
                      type="button"
                      onClick={() => onRetirerFichier(idx)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#991b1b', fontSize: 14, lineHeight: 1, padding: '0 2px' }}
                    >✕</button>
                  </div>
                ))}
              </div>
            )}
            <label
              htmlFor="m-fichier-input"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 14px', background: '#f8fafc', border: '1.5px dashed var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)', marginBottom: 0, textTransform: 'none', letterSpacing: 0, fontWeight: 500, width: '100%' }}
            >
              📎 Ajouter une pièce jointe
              <span className="field-hint" style={{ display: 'inline', margin: 0 }}>&nbsp;JPG, PNG, PDF · max 5 Mo</span>
            </label>
            <input
              type="file" id="m-fichier-input" style={{ display: 'none' }}
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={onAjouterFichier}
            />
          </div>
          {erreur && <div className="alert-err span-2">{erreur}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn-primary" onClick={onSave} disabled={saving}>💾 Enregistrer</button>
        </div>
      </div>
    </div>
  );
}
