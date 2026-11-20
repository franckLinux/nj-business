import { useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api, API_BASE } from '@/lib/api';
import { syncManager } from '@/lib/syncManager';
import { RubriqueModal } from '@/components/config/RubriquesTab';
import { useContexteProjets, natureAffectee, libelleNature } from '@/lib/projets';

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
  const { mois, annee, rubriques, loadRubriques, token, activeTenantId, user, devise, can } = useApp();
  const rattrapageAutorise = can('journal.rattrapage');
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
  // Tiers du registre (044) : choisi par le nom ou le NUI, il complète le NUI,
  // le téléphone et apporte son compte tiers. Sans choix, le serveur retrouve
  // le tiers de même NUI (ou de même nom) à l'enregistrement.
  const [tiersId, setTiersId] = useState(mouvement?.tiers_id ? Number(mouvement.tiers_id) : null);
  const [tiersListe, setTiersListe] = useState([]);
  const [nouvelleRubrique, setNouvelleRubrique] = useState(false);
  const peutAjouterRubrique = !mouvement && (can('rubriques.create') || can('rubriques.edit'));
  // Activité / projet (034) : rattachement FACULTATIF. Les désactivées ne sont
  // proposées que si l'écriture modifiée y est déjà rattachée.
  const [activiteId, setActiviteId] = useState(mouvement?.activite_id ? String(mouvement.activite_id) : '');
  const [activites, setActivites] = useState([]);
  useEffect(() => {
    let annule = false;
    api.get('/activites?tous=1').then((r) => {
      if (annule || !Array.isArray(r)) return;
      setActivites(r.filter((a) => a.actif || String(a.id) === String(mouvement?.activite_id || '')));
    });
    return () => { annule = true; };
  }, [mouvement?.activite_id]);
  // Projets des ONG / associations (069) : rien ne change pour une PME.
  const ctxProjets = useContexteProjets();
  const ong = Boolean(ctxProjets?.ong);
  const projetsOng = ong ? (ctxProjets.projets || []) : [];
  const projetsStructures = new Set(projetsOng.filter((p) => p.activites.length > 0).map((p) => p.id));
  // Remise à une activité (plafonnée aussi par le reste du projet) ou remise
  // GLOBALE au projet (lot P4), justifiée ensuite activité par activité.
  const activitesProjet = projetsOng.flatMap((p) => [
    ...(p.activites.length ? [{
      id: p.id, nom: 'Remise globale au projet', global: true, projet: p,
      budget: p.budget_valide ? p.budget_total : null, consomme: p.remis_total, reste: p.budget_valide ? p.reste_total : null,
    }] : []),
    ...p.activites.map((a) => ({
      ...a, projet: p,
      reste: a.reste === null ? null : Math.min(a.reste, p.budget_valide ? p.reste_total : a.reste),
    })),
  ]);
  const [projetId, setProjetId] = useState('');
  const [referenceFin, setReferenceFin] = useState('');
  const [montant, setMontant] = useState(mouvement ? (parseFloat(mouvement.entree) > 0 ? mouvement.entree : mouvement.sortie) : '');
  const [erreur, setErreur] = useState('');
  const [piecesHint, setPiecesHint] = useState(null); // { obligatoires:[], recommandees:[] } | null
  const [saving, setSaving] = useState(false);
  const [fichiers, setFichiers] = useState([]); // [{ file, dataUrl, name, type }]

  const listeRubriques = type === 'entree' ? rubriques.entrees : rubriques.depenses;

  // Bénéficiaires du registre pour le sens de l'opération (entrée : clients, sortie : fournisseurs).
  useEffect(() => {
    if (!navigator.onLine) return undefined;
    let annule = false;
    api.get(`/registre-tiers/saisie${type ? `?sens=${type}` : ''}`).then((r) => { if (!annule && Array.isArray(r)) setTiersListe(r); });
    return () => { annule = true; };
  }, [type]);
  const tiersChoisi = tiersListe.find((t) => t.id === tiersId) || null;
  const normNui = (v) => String(v || '').toUpperCase().replace(/\s+/g, '');
  const normNom = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const onBeneficiaire = (v) => {
    setBeneficiaire(v);
    const t = tiersListe.find((x) => normNom(x.nom) === normNom(v));
    if (t) {
      setTiersId(t.id);
      if (t.nui) setNui(t.nui);
      if (t.telephone && !telephone) setTelephone(t.telephone);
    } else if (tiersChoisi) setTiersId(null);
  };
  const onNui = (v) => {
    setNui(v);
    const t = normNui(v) ? tiersListe.find((x) => x.nui && x.nui === normNui(v)) : null;
    if (t) { setTiersId(t.id); setBeneficiaire(t.nom); if (t.telephone && !telephone) setTelephone(t.telephone); }
    else if (tiersChoisi && tiersChoisi.nui) setTiersId(null);
  };
  // Activité / projet obligatoire pour cette personne (039), hors virements
  // internes et seulement s'il existe des activités actives. L'API applique la
  // même règle : ce contrôle n'évite qu'un aller-retour.
  const rubriqueChoisie = [...(rubriques.entrees || []), ...(rubriques.depenses || [])].find((r) => r.code === rubrique);
  // ONG : une recette de nature « affectée » exige le projet bénéficiaire ;
  // une activité de projet est contrôlée par le budget du projet.
  const financementAffecte = ong && type === 'entree' && natureAffectee(rubriqueChoisie?.nature_recette);
  const activiteProjet = ong ? activitesProjet.find((a) => String(a.id) === String(activiteId)) || null : null;
  const activitesSimples = ong
    ? activites.filter((a) => !a.projet_id && !(a.type === 'projet' && projetsStructures.has(a.id)))
    : activites;
  const rattachementProjetFige = Boolean(mouvement && activiteProjet);
  const activiteRequise = Boolean(user?.activite_obligatoire) && !rubriqueChoisie?.est_virement_interne
    && activites.some((a) => a.actif) && !financementAffecte;

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

  // Reste disponible de la rubrique (semaine en cours avec report si budget
  // hebdomadaire, sinon le mois) — indicatif, le contrôle reste côté serveur.
  const [dispo, setDispo] = useState(null);
  useEffect(() => {
    setDispo(null);
    if (mouvement || type !== 'sortie' || !rubrique || !date || !navigator.onLine) return;
    let annule = false;
    const qs = new URLSearchParams({ date, mois, annee: String(annee), rubrique_code: rubrique, ...(journal?.id ? { journal_id: String(journal.id) } : {}) });
    api.get(`/journal/disponible?${qs}`).then((r) => { if (!annule && r && !r.error) setDispo(r); });
    return () => { annule = true; };
  }, [mouvement, type, rubrique, date, mois, annee, journal?.id]);

  const onTypeChange = (e) => {
    setType(e.target.value);
    setRubrique('');
    setProjetId('');
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
    if (activiteRequise && !activiteId) {
      setErreur('Activité / projet obligatoire : choisissez l\'activité ou le projet concerné par cette opération.');
      return;
    }
    if (!mouvement && financementAffecte && !projetId) {
      setErreur('Projet obligatoire : cette recette est un financement affecté. Choisissez le projet bénéficiaire.');
      return;
    }
    if (!mouvement && activiteProjet && type === 'sortie' && activiteProjet.reste !== null && montantNum > activiteProjet.reste) {
      setErreur(`Budget de l'activité « ${activiteProjet.nom} » dépassé : il reste ${(activiteProjet.reste || 0).toLocaleString('fr-FR')} ${devise}.`);
      return;
    }
    // C16 : pièce obligatoire manquante → avertissement et confirmation
    // explicite (l'écriture n'est pas bloquée).
    if (!mouvement && type === 'sortie' && piecesHint?.obligatoires?.length && fichiers.length === 0) {
      const liste = piecesHint.obligatoires.map((t) => `• ${t.intitule_piece}`).join('\n');
      if (!window.confirm(`Pièce(s) obligatoire(s) non jointe(s) pour cette dépense :\n${liste}\n\nEnregistrer quand même ? Vous pourrez joindre la pièce plus tard avec 📎 dans le journal.`)) return;
    }
    const body = {
      date, mois, annee,
      journal_id: journal?.id || null,
      type_caisse: journal?.type === 'om' ? 'om' : journal?.type === 'momo' ? 'om' : 'especes',
      rubrique_code: rubrique, intitule: intitule.trim(),
      code_comptable: codeComptable || '',
      nui: nui || '',
      tiers_id: tiersId || null,
      activite_id: financementAffecte ? null : (activiteId ? Number(activiteId) : null),
      ...(!mouvement && financementAffecte ? { projet_id: Number(projetId), reference_financement: referenceFin.trim() } : {}),
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
      // Remise de fonds à une activité de projet : pas de budget de
      // fonctionnement (le budget du projet est contrôlé à la synchronisation).
      if (!activiteProjet) {
        try { verdict = await syncManager.controleBudgetLocal(body); } catch { /* pré-contrôle indisponible */ }
      }

      const localId = await syncManager.cacheJournalEntry({
        ...body, id: null, type_caisse: body.type_caisse,
        pre_bloque: verdict.bloque, motif_local: verdict.motif || null,
      });
      const tid = activeTenantId || user?.tenantId;
      await syncManager.enqueue({
        method: 'POST', url: API_BASE + '/api/journal', body, local_id: localId, user_id: user?.id || null,
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

    // Nouvelle écriture : JournalPage propose aussitôt l'impression du bon.
    onSaved(mouvement ? undefined : res);
    if (mouvement) toast('Mouvement modifié ✓', 'success');
  };

  return (
    <div className="modal-overlay" style={{ display: 'flex' }}>
      <div className="modal-box">
        <div className="modal-head">
          <h3>{mouvement ? `Corriger l'écriture n°${mouvement.numero ?? ''}` : 'Nouveau mouvement'}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {mouvement && (
            <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e3a8a', borderRadius: 8, padding: '8px 12px', fontSize: 12, marginBottom: 12 }}>
              Seuls le libellé, l'objet et le bénéficiaire se corrigent. Un montant, une date ou une rubrique erronés :
              annulez l'écriture (bouton ↩) puis ressaisissez-la.
            </div>
          )}
          <div className="form-section">Informations principales</div>
          <div>
            <label>Date <span className="req">*</span></label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={!!mouvement}
              min={journal?.date_ouverture ? String(journal.date_ouverture).slice(0, 10) : undefined} />
            {!mouvement && rattrapageAutorise && (
              <div className="field-hint" style={{ color: '#b45309' }}>
                ⏪ Rattrapage autorisé : vous pouvez dater l'opération avant la dernière écriture (hors mois arrêté). Elle sera marquée « Rattrapage ».
              </div>
            )}
            {!mouvement && journal?.date_ouverture && date && date < String(journal.date_ouverture).slice(0, 10) && (
              <div className="field-hint" style={{ color: 'var(--accent-red)' }}>
                Caisse ouverte le {new Date(`${String(journal.date_ouverture).slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR')} : choisissez une date à partir de ce jour.
              </div>
            )}
          </div>
          <div>
            <label>Type <span className="req">*</span></label>
            <select value={type} onChange={onTypeChange} disabled={!!mouvement}>
              <option value="">— choisir —</option>
              <option value="entree">Entrée</option>
              <option value="sortie">Sortie</option>
            </select>
          </div>
          <div className="span-2">
            <label style={{ display: 'flex', alignItems: 'center' }}>Rubrique <span className="req">*</span>
              {peutAjouterRubrique && type && navigator.onLine && (
                <button type="button" onClick={() => setNouvelleRubrique(true)}
                  style={{ marginLeft: 'auto', border: 0, background: 'none', color: 'var(--accent)', fontSize: 12, fontWeight: 600, cursor: 'pointer', textTransform: 'none', letterSpacing: 0, padding: 0 }}>
                  + Nouvelle rubrique
                </button>
              )}
            </label>
            <select value={rubrique} onChange={(e) => setRubrique(e.target.value)} disabled={!!mouvement}>
              <option value="">— choisir —</option>
              {(listeRubriques || []).map((r) => (
                <option key={r.code} value={r.code}>[{r.code}] {r.intitule}</option>
              ))}
            </select>
          </div>
          {dispo && !activiteProjet && (
            <div className="span-2" style={{ margin: '4px 0 2px', padding: '6px 12px', borderRadius: 7, fontSize: 12,
              background: !dispo.valide ? '#fef3c7' : dispo.reste - (parseFloat(montant) || 0) < 0 ? '#fee2e2' : '#ecfdf5',
              color: !dispo.valide ? '#92400e' : dispo.reste - (parseFloat(montant) || 0) < 0 ? '#991b1b' : '#065f46' }}>
              {!dispo.valide
                ? <>⏳ {dispo.periodicite === 'hebdomadaire' ? `Semaine ${dispo.semaine} non validée` : 'Budget du mois non validé'} : la sortie sera mise en attente.</>
                : <>💰 Reste disponible {dispo.periodicite === 'hebdomadaire' ? `(${dispo.libelle}, avec report)` : `(${dispo.libelle})`} : <strong>{(dispo.reste || 0).toLocaleString('fr-FR')} {devise}</strong>
                  {parseFloat(montant) > 0 && <> — après cette sortie : {(dispo.reste - parseFloat(montant)).toLocaleString('fr-FR')} {devise}</>}</>}
            </div>
          )}
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
              <input type="number" min="0" step="1" placeholder="0" className="has-suffix" value={montant} onChange={(e) => setMontant(e.target.value)} disabled={!!mouvement} />
              <span className="input-suffix">{devise}</span>
            </div>
          </div>
          {financementAffecte && !mouvement && (
            <div className="span-2 projet-imputation">
              <div className="projet-imputation-titre">
                <span className="badge-nature">{libelleNature(rubriqueChoisie?.nature_recette)}</span>
                Financement affecté : le montant sera compté dans le financement reçu du projet.
              </div>
              <div className="projet-imputation-grille">
                <div>
                  <label>Projet bénéficiaire <span className="req">*</span></label>
                  <select value={projetId} onChange={(e) => setProjetId(e.target.value)}>
                    <option value="">— choisir le projet —</option>
                    {projetsOng.map((p) => (
                      <option key={p.id} value={p.id}>{p.code ? `[${p.code}] ` : ''}{p.nom}</option>
                    ))}
                  </select>
                  {projetsOng.length === 0 && (
                    <div className="field-hint" style={{ color: 'var(--accent-red)' }}>Aucun projet actif : créez d'abord le projet.</div>
                  )}
                </div>
                <div>
                  <label>Référence du financement <span className="field-hint" style={{ display: 'inline', textTransform: 'none', letterSpacing: 0 }}>(facultatif)</span></label>
                  <input type="text" maxLength={120} placeholder="N° d'avis de crédit, de virement…" value={referenceFin} onChange={(e) => setReferenceFin(e.target.value)} />
                </div>
              </div>
              <div className="field-hint">Le bailleur est le bénéficiaire / tiers indiqué plus bas.</div>
            </div>
          )}
          {!financementAffecte && (activitesSimples.length > 0 || activitesProjet.length > 0) && (
            <div className="span-2">
              <label>
                Activité / projet{' '}
                {activiteRequise
                  ? <span className="req">*</span>
                  : <span className="field-hint" style={{ display: 'inline', textTransform: 'none', letterSpacing: 0 }}>(facultatif — pour le suivi par activité)</span>}
              </label>
              <select value={activiteId} onChange={(e) => setActiviteId(e.target.value)} disabled={rattachementProjetFige}>
                <option value="">{activiteRequise ? '— choisir —' : '— Non classé —'}</option>
                {['activite', 'projet'].map((ty) => {
                  const items = activitesSimples.filter((a) => a.type === ty);
                  if (!items.length) return null;
                  return (
                    <optgroup key={ty} label={ty === 'projet' ? 'Projets' : 'Activités'}>
                      {items.map((a) => (
                        <option key={a.id} value={a.id}>{a.code ? `[${a.code}] ` : ''}{a.nom}{a.actif ? '' : ' (désactivée)'}</option>
                      ))}
                    </optgroup>
                  );
                })}
                {projetsOng.filter((p) => p.activites.length > 0).map((p) => (
                  <optgroup key={`p${p.id}`} label={`Projet — ${p.nom}`}>
                    <option value={p.id}>◆ Remise globale au projet — reste {p.budget_valide ? (p.reste_total || 0).toLocaleString('fr-FR') : 'budget non validé'}</option>
                    {p.activites.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code ? `[${a.code}] ` : ''}{a.nom}{a.responsable_nom ? ` · ${a.responsable_nom}` : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {rattachementProjetFige && (
                <div className="field-hint">Rattachement à un projet : il ne se corrige pas ici. Annulez l'écriture (↩) puis ressaisissez-la.</div>
              )}
            </div>
          )}
          {activiteProjet && type === 'sortie' && !mouvement && (() => {
            const p = activiteProjet.projet;
            const m = parseFloat(montant) || 0;
            const etat = !p.budget_valide ? 'attente' : activiteProjet.reste === null || activiteProjet.reste - m < 0 ? 'depasse' : 'ok';
            return (
              <div className={`span-2 projet-dispo projet-dispo-${etat}`}>
                {etat === 'attente' && <>⏳ Budget du projet « {p.nom} » pas encore validé par le directeur : la remise de fonds sera refusée.</>}
                {etat !== 'attente' && activiteProjet.reste === null && <>⛔ L'activité « {activiteProjet.nom} » n'a pas de montant dans le budget validé du projet.</>}
                {etat !== 'attente' && activiteProjet.reste !== null && (
                  <>
                    <strong>{activiteProjet.global ? `Remise globale — ${p.nom}` : 'Budget du projet'}</strong>
                    {!activiteProjet.global && <> · {activiteProjet.nom}{activiteProjet.responsable_nom ? ` (${activiteProjet.responsable_nom})` : ''}</>}
                    <div className="projet-dispo-chiffres">
                      <span>{activiteProjet.global ? 'Budget total' : 'Budget validé'} <b>{(activiteProjet.budget || 0).toLocaleString('fr-FR')}</b></span>
                      <span>Déjà remis <b>{(activiteProjet.consomme || 0).toLocaleString('fr-FR')}</b></span>
                      <span>Reste <b>{(activiteProjet.reste || 0).toLocaleString('fr-FR')} {devise}</b></span>
                      {m > 0 && <span>Après cette sortie <b>{(activiteProjet.reste - m).toLocaleString('fr-FR')}</b></span>}
                    </div>
                    <div className="projet-dispo-note">
                      {activiteProjet.global ? 'Montant non affecté : il sera justifié activité par activité. ' : ''}Hors budget de fonctionnement.
                    </div>
                  </>
                )}
              </div>
            );
          })()}
          <div className="form-section">Détails complémentaires</div>
          <div>
            <label>Bénéficiaire {tiersChoisi && <span className="field-hint" style={{ display: 'inline', textTransform: 'none', letterSpacing: 0, color: '#166534' }}>✓ registre</span>}</label>
            <input type="text" value={beneficiaire} onChange={(e) => onBeneficiaire(e.target.value)} list="mvt-tiers-nom" autoComplete="off"
              placeholder={tiersListe.length ? 'Nom (suggestions du registre)' : undefined} />
            <datalist id="mvt-tiers-nom">{tiersListe.map((t) => <option key={t.id} value={t.nom}>{t.nui || ''}</option>)}</datalist>
            <datalist id="mvt-tiers-nui">{tiersListe.filter((t) => t.nui).map((t) => <option key={t.id} value={t.nui}>{t.nom}</option>)}</datalist>
          </div>
          <div>
            <label>NUI <span className="field-hint" style={{ display: 'inline', textTransform: 'none', letterSpacing: 0 }}>(optionnel)</span></label>
            <input type="text" placeholder="Numéro Unique d'Identification" value={nui} onChange={(e) => onNui(e.target.value)}
              list="mvt-tiers-nui" autoComplete="off" />
          </div>
          <div>
            <label>Compte tiers</label>
            <input type="text" readOnly style={{ fontFamily: 'monospace' }} placeholder="Auto depuis le registre"
              value={tiersChoisi ? `${tiersChoisi.compte_effectif}${tiersChoisi.compte_collectif ? ' (collectif)' : ''}` : ''}
              title={tiersChoisi ? `Tiers du registre : ${tiersChoisi.nom}` : 'Choisissez un bénéficiaire du registre (nom ou NUI)'} />
          </div>
          <div>
            <label>Code comptable</label>
            <input type="text" placeholder="Auto depuis rubrique" style={{ fontFamily: 'monospace' }} readOnly value={codeComptable} />
          </div>
          <div className="span-2">
            <label>Objet / Motif</label>
            <input type="text" placeholder="Détail de l'opération" value={objet} onChange={(e) => setObjet(e.target.value)} />
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
      {nouvelleRubrique && (
        <RubriqueModal defaultType={type === 'entree' ? 'entree' : 'depense'} simple={!can('rubriques.edit')}
          onClose={() => setNouvelleRubrique(false)}
          onSaved={async (msg, res) => {
            setNouvelleRubrique(false);
            await loadRubriques();
            const ok = res?.code && (res.type === 'entree') === (type === 'entree');
            if (ok) setRubrique(res.code);
            toast(ok ? `${msg} Elle est sélectionnée pour cette saisie.` : msg, 'success', 5000);
          }} />
      )}
    </div>
  );
}
