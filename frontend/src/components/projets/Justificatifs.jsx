import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { Modale, dateFr, fcfa } from '@/pages/ProjetsPage';
import { formuleUnite, quantiteUnites } from '@/lib/projets';

// Justificatifs des projets (070, lot P3) : dépôt avec pièce scannée,
// contrôle (chef de projet ou comptable, jamais ses propres pièces), rejet
// motivé, annulation par le directeur, archives consultables.

export const STATUTS_JUSTIF = {
  depose: { lib: 'À contrôler', cls: 'pj-b-ambre' },
  valide: { lib: 'Validé', cls: 'pj-b-vert' },
  rejete: { lib: 'Rejeté', cls: 'pj-b-rouge' },
  annule: { lib: 'Annulé', cls: 'pj-b-ardoise' },
};

const TAILLE_MAX = 5 * 1024 * 1024;
const lireFichier = (f) => new Promise((ok, ko) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).replace(/^data:[^;]+;base64,/, ''));
  r.onerror = () => ko(new Error('Lecture du fichier impossible.'));
  r.readAsDataURL(f);
});

/** Ouvre la pièce scannée (route protégée) dans un nouvel onglet. */
export const ouvrirPiece = async (projetId, j, toast) => {
  const w = window.open('', '_blank');
  const r = await api.fichier(`/projets/${projetId}/justificatifs/${j.id}/fichier`);
  if (r.error) { if (w) w.close(); toast(r.error, 'error', 7000); return; }
  const lien = URL.createObjectURL(r.blob);
  if (w) w.location.href = lien;
  else { const a = document.createElement('a'); a.href = lien; a.download = j.fichier_nom || 'justificatif'; a.click(); }
  setTimeout(() => URL.revokeObjectURL(lien), 60000);
};

export function DepotModal({ projetId, activites, remises, activiteInitiale, onFermer, onDepose }) {
  const toast = useToast();
  const auj = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({
    activite_id: activiteInitiale || (activites.length === 1 ? String(activites[0].id) : ''),
    remise_id: '', poste_cle: '', date_piece: auj, montant: '', fournisseur: '', numero_piece: '', libelle: '',
    quantite_realisee: '', jours_realises: '1',
  });
  const [fichier, setFichier] = useState(null);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  const maj = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value, ...(k === 'activite_id' ? { remise_id: '', poste_cle: '' } : {}) })); setErreur(''); };
  const act = activites.find((a) => String(a.id) === String(f.activite_id));
  const postes = act?.postes || [];
  const poste = postes.find((po) => po.cle === f.poste_cle);
  // Plafond (décision du 20/11/2026) : bloqué au-delà du budget de la ligne, ou de l'activité sans lignes.
  const plafond = poste ? poste.reste : (act && !postes.length && act.budget !== null ? act.reste_budget_justif : null);
  const remisesAct = remises.filter((r) => String(r.activite_id) === String(f.activite_id) && !r.annule);

  const choisir = (e) => {
    const x = e.target.files?.[0];
    if (!x) return;
    if (x.size > TAILLE_MAX) { setErreur('Fichier trop volumineux : 5 Mo au plus (scannez en 150-200 dpi ou en PDF).'); e.target.value = ''; return; }
    if (!/^(application\/pdf|image\/(jpeg|png|webp))$/.test(x.type)) { setErreur('Format accepté : PDF, JPG, PNG ou WEBP.'); e.target.value = ''; return; }
    setFichier(x); setErreur('');
  };

  const deposer = async () => {
    const montant = Number(String(f.montant).replace(/[\s  ]/g, '').replace(',', '.'));
    if (!f.activite_id) return setErreur('Choisissez l\'activité justifiée.');
    if (postes.length && !f.poste_cle) return setErreur('Choisissez la ligne budgétaire justifiée.');
    const parUnite = poste?.mode === 'unite';
    const nombre = (v) => Number(String(v ?? '').replace(/[\s  ]/g, '').replace(',', '.'));
    if (parUnite && (String(f.quantite_realisee).trim() === '' || !(nombre(f.quantite_realisee) >= 0))) {
      return setErreur(`Indiquez la quantité réalisée${poste.unite ? ` (${poste.unite})` : ''}.`);
    }
    if (parUnite && !(nombre(f.jours_realises || 1) > 0)) return setErreur('Le nombre de jours réalisés doit être positif.');
    if (!f.libelle.trim()) return setErreur('Indiquez l\'objet de la dépense.');
    if (!Number.isFinite(montant) || montant <= 0) return setErreur('Le montant doit être positif.');
    if (plafond !== null && montant > plafond) {
      return setErreur(`Dépôt impossible : il ne reste que ${fcfa(Math.max(plafond, 0))} FCFA sur ${poste ? `la ligne « ${poste.libelle} »` : 'le budget de l\'activité'}.`);
    }
    if (!f.date_piece || f.date_piece > auj) return setErreur('Date de la pièce invalide (pas dans le futur).');
    if (!fichier) return setErreur('Joignez la pièce scannée (PDF ou photo).');
    setEnCours(true);
    try {
      const data = await lireFichier(fichier);
      const r = await api.post(`/projets/${projetId}/justificatifs`, {
        ...f, montant, remise_id: f.remise_id || null, poste_cle: f.poste_cle || null,
        ...(poste?.mode === 'unite' ? {} : { quantite_realisee: null, jours_realises: null }), fichier: { nom_fichier: fichier.name, data_base64: data },
      });
      if (r.error) { setErreur(r.error); return; }
      toast('Justificatif déposé : il attend le contrôle.', 'success');
      onDepose();
    } catch (e) {
      setErreur(e.message);
    } finally {
      setEnCours(false);
    }
  };

  return (
    <Modale titre="Déposer un justificatif" onFermer={onFermer} enCours={enCours} largeur={600}
      pied={<>
        <button type="button" className="btn-ghost" onClick={onFermer} disabled={enCours}>Annuler</button>
        <button type="button" className="btn-primary" onClick={deposer} disabled={enCours}>{enCours ? 'Envoi…' : '⬆ Déposer'}</button>
      </>}
    >
      {erreur && <div className="alert-err">{erreur}</div>}
      <div className="pj-section">Activité</div>
      <div className="pj-grille-2">
        <div>
          <label>Activité justifiée <span className="req">*</span></label>
          <select value={f.activite_id} onChange={maj('activite_id')}>
            <option value="">— choisir —</option>
            {activites.map((a) => <option key={a.id} value={a.id}>{a.nom}</option>)}
          </select>
        </div>
        <div>
          <label>Remise de fonds <span className="field-hint pj-inline">(facultatif)</span></label>
          <select value={f.remise_id} onChange={maj('remise_id')} disabled={!remisesAct.length}>
            <option value="">{remisesAct.length ? '— toutes —' : 'aucune remise'}</option>
            {remisesAct.map((r) => <option key={r.id} value={r.id}>{r.journal_code} n° {r.numero} · {dateFr(r.date)} · {fcfa(r.sortie)}</option>)}
          </select>
        </div>
        {postes.length > 0 && (
          <div className="pj-col-2">
            <label>Ligne budgétaire justifiée <span className="req">*</span></label>
            <select value={f.poste_cle} onChange={maj('poste_cle')}>
              <option value="">— choisir la ligne —</option>
              {postes.map((po) => (
                <option key={po.cle} value={po.cle} disabled={po.reste <= 0}>
                  {po.libelle} — budget {fcfa(po.budget)} · reste {fcfa(Math.max(po.reste, 0))}
                </option>
              ))}
            </select>
          </div>
        )}
        {poste?.mode === 'unite' && (
          <>
            <div>
              <label>Quantité réalisée{poste.unite ? ` (${poste.unite})` : ''} <span className="req">*</span></label>
              <input inputMode="decimal" value={f.quantite_realisee} onChange={maj('quantite_realisee')} placeholder={String(poste.quantite)} />
            </div>
            <div>
              <label>Nombre de jours <span className="req">*</span></label>
              <input inputMode="decimal" value={f.jours_realises} onChange={maj('jours_realises')} placeholder="1" />
            </div>
            <div className="pj-col-2 pj-muted pj-petit">
              Prévu : {formuleUnite(poste)} · déjà réalisé {quantiteUnites(poste.realise_unites, poste)} / {quantiteUnites(poste.prevu_unites, poste)}
            </div>
          </>
        )}
        {plafond !== null && (
          <div className="pj-col-2 pj-plafond">
            Reste à justifier sur {poste ? `la ligne « ${poste.libelle} »` : 'le budget de l\'activité'} : <b>{fcfa(Math.max(plafond, 0))} FCFA</b>
            <span className="pj-muted"> — au-delà, le dépôt est refusé.</span>
          </div>
        )}
        {act && (
          <div className="pj-col-2 pj-rappel">
            Remis : <b>{fcfa(act.alloue)}</b> · justifié : <b>{fcfa(act.justifie)}</b> · à contrôler : <b>{fcfa(act.a_controler)}</b> ·
            reste à justifier : <b style={{ color: 'var(--projet-attente)' }}>{fcfa(Math.max(act.en_attente - act.a_controler, 0))}</b>
          </div>
        )}
      </div>
      <div className="pj-section">Pièce</div>
      <div className="pj-grille-2">
        <div className="pj-col-2">
          <label>Objet de la dépense <span className="req">*</span></label>
          <input type="text" maxLength={300} value={f.libelle} onChange={maj('libelle')} placeholder="Ex. : Achat de ciment pour le forage n° 2" />
        </div>
        <div><label>Date de la pièce <span className="req">*</span></label><input type="date" max={auj} value={f.date_piece} onChange={maj('date_piece')} /></div>
        <div><label>Montant (FCFA) <span className="req">*</span></label><input inputMode="decimal" value={f.montant} onChange={maj('montant')} placeholder="0" style={{ textAlign: 'right' }} /></div>
        <div><label>Fournisseur</label><input type="text" maxLength={150} value={f.fournisseur} onChange={maj('fournisseur')} /></div>
        <div><label>N° de facture / reçu</label><input type="text" maxLength={60} value={f.numero_piece} onChange={maj('numero_piece')} /></div>
        <div className="pj-col-2">
          <label>Pièce scannée <span className="req">*</span></label>
          <label className={`pj-depot${fichier ? ' ok' : ''}`}>
            <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" capture="environment" onChange={choisir} />
            {fichier ? <>📎 <b>{fichier.name}</b> <span className="pj-muted">{Math.round(fichier.size / 1024)} Ko — cliquez pour changer</span></>
              : <>📷 Photographier ou choisir un fichier <span className="pj-muted">PDF, JPG, PNG, WEBP — 5 Mo au plus</span></>}
          </label>
        </div>
      </div>
    </Modale>
  );
}

function MotifModal({ titre, bouton, aide, onFermer, onConfirmer }) {
  const [motif, setMotif] = useState('');
  const [enCours, setEnCours] = useState(false);
  return (
    <Modale titre={titre} onFermer={onFermer} enCours={enCours} largeur={460}
      pied={<>
        <button type="button" className="btn-ghost" onClick={onFermer} disabled={enCours}>Annuler</button>
        <button type="button" className="btn-primary btn-auto pj-btn-rouge" disabled={enCours || !motif.trim()}
          onClick={async () => { setEnCours(true); await onConfirmer(motif.trim()); setEnCours(false); }}>{bouton}</button>
      </>}
    >
      <label>Motif <span className="req">*</span></label>
      <textarea rows={3} maxLength={2000} value={motif} autoFocus onChange={(e) => setMotif(e.target.value)} />
      <div className="field-hint">{aide}</div>
    </Modale>
  );
}

/** Tableau de pièces avec leurs actions (fiche projet et file « À contrôler »). */
export function TablePieces({ pieces, projetId, avecProjet = false, onChange, vide }) {
  const toast = useToast();
  const [motif, setMotif] = useState(null);
  const [enCours, setEnCours] = useState(null);
  const pid = (j) => projetId || j.projet_id;
  const agir = async (j, action, corps, ok) => {
    setEnCours(j.id);
    const r = action === 'supprimer'
      ? await api.delete(`/projets/${pid(j)}/justificatifs/${j.id}`)
      : await api.post(`/projets/${pid(j)}/justificatifs/${j.id}/${action}`, corps);
    setEnCours(null);
    if (r.error) { toast(r.error, 'error', 8000); return false; }
    toast(ok, 'success');
    onChange();
    return true;
  };
  if (!pieces.length) return <div className="pj-vide-mini">{vide}</div>;
  return (
    <>
      <div className="table-wrap">
        <table className="pj-table">
          <thead>
            <tr>
              <th>Pièce</th>{avecProjet && <th>Projet</th>}<th>Activité</th><th>Objet · fournisseur</th>
              <th className="n">Montant</th><th>Déposé</th><th>Statut</th><th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pieces.map((j) => {
              const st = STATUTS_JUSTIF[j.statut];
              const d = j.droits || {};
              return (
                <tr key={j.id} className={j.statut === 'annule' ? 'pj-inactif' : ''}>
                  <td>
                    <button type="button" className="pj-piece" onClick={() => ouvrirPiece(pid(j), j, toast)} title="Ouvrir la pièce scannée">
                      📄 {dateFr(j.date_piece)}
                    </button>
                    {j.numero_piece && <div className="pj-muted pj-petit">n° {j.numero_piece}</div>}
                  </td>
                  {avecProjet && <td>{j.projet_nom}</td>}
                  <td>{j.activite_nom}
                    {j.poste_libelle && <div className="pj-petit" style={{ color: 'var(--projet-budget)' }}>└ {j.poste_libelle}
                      {j.quantite_realisee !== null && j.quantite_realisee !== undefined && (
                        <span className="pj-muted"> · réalisé {Number(j.quantite_realisee).toLocaleString('fr-FR')} × {Number(j.jours_realises).toLocaleString('fr-FR')} j</span>
                      )}</div>}
                    {j.remise_numero && <div className="pj-muted pj-petit">remise {j.remise_journal} n° {j.remise_numero}</div>}</td>
                  <td>{j.libelle}{j.fournisseur && <div className="pj-muted pj-petit">{j.fournisseur}</div>}</td>
                  <td className="n"><b>{fcfa(j.montant)}</b></td>
                  <td className="pj-muted">{j.depose_par_nom}<div className="pj-petit">{dateFr(j.depose_le)}</div></td>
                  <td>
                    <span className={`pj-badge ${st.cls}`} style={{ marginLeft: 0 }}>{st.lib}</span>
                    {j.statut === 'rejete' && <div className="pj-err-ligne" title={j.motif_rejet}>{j.motif_rejet}</div>}
                    {j.statut === 'annule' && <div className="pj-muted pj-petit" title={j.motif_annulation}>{j.motif_annulation}</div>}
                    {['valide', 'rejete'].includes(j.statut) && <div className="pj-muted pj-petit">par {j.decide_par_nom}</div>}
                  </td>
                  <td className="pj-actions-l">
                    {d.valider && (
                      <>
                        <button type="button" className="pj-act vert" disabled={enCours === j.id} onClick={() => agir(j, 'valider', {}, 'Justificatif validé.')}>✓ Valider</button>
                        <button type="button" className="pj-act rouge" disabled={enCours === j.id} onClick={() => setMotif({ j, action: 'rejeter' })}>Rejeter</button>
                      </>
                    )}
                    {d.annuler && <button type="button" className="pj-act" disabled={enCours === j.id} onClick={() => setMotif({ j, action: 'annuler' })}>Annuler</button>}
                    {d.supprimer && (
                      <button type="button" className="pj-act" disabled={enCours === j.id}
                        onClick={() => window.confirm('Retirer ce dépôt ?') && agir(j, 'supprimer', null, 'Dépôt retiré.')}>Retirer</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {motif && (
        <MotifModal
          titre={motif.action === 'rejeter' ? 'Rejeter le justificatif' : 'Annuler le justificatif validé'}
          bouton={motif.action === 'rejeter' ? 'Rejeter' : 'Annuler la pièce'}
          aide={motif.action === 'rejeter' ? 'Le déposant est prévenu et voit ce motif ; il dépose une pièce corrigée.' : 'La pièce reste archivée, barrée ; son montant n\'est plus compté comme justifié.'}
          onFermer={() => setMotif(null)}
          onConfirmer={async (m) => {
            if (await agir(motif.j, motif.action, { motif: m }, motif.action === 'rejeter' ? 'Justificatif rejeté.' : 'Justificatif annulé.')) setMotif(null);
          }}
        />
      )}
    </>
  );
}

/** Onglet « Justificatifs » de la fiche projet : dépôt et archives. */
export function OngletJustificatifs({ d, activiteFiltre, onChange }) {
  const [pieces, setPieces] = useState(null);
  const [filtre, setFiltre] = useState({ activite: activiteFiltre || '', statut: '' });
  const [depot, setDepot] = useState(false);
  const [recherche, setRecherche] = useState('');
  const charger = useCallback(async () => {
    const r = await api.get(`/projets/${d.projet.id}/justificatifs`);
    if (!r.error) setPieces(r);
  }, [d.projet.id]);
  useEffect(() => { charger(); }, [charger]);

  const deposables = d.activites.filter((a) => a.actif && (d.acces.gerer || (d.acces.mes_activites || []).includes(a.id)));
  const visibles = (pieces || []).filter((j) => (!filtre.activite || String(j.activite_id) === String(filtre.activite))
    && (!filtre.statut || j.statut === filtre.statut)
    && (!recherche.trim() || [j.libelle, j.fournisseur, j.numero_piece, j.depose_par_nom].some((x) => String(x || '').toLowerCase().includes(recherche.trim().toLowerCase()))));
  const total = (st) => (pieces || []).filter((j) => j.statut === st).reduce((s, j) => s + j.montant, 0);

  return (
    <div className="pj-carte">
      <div className="pj-carte-t">
        Justificatifs et archives
        <small>validé {fcfa(total('valide'))} · à contrôler {fcfa(total('depose'))}</small>
        {deposables.length > 0 && <button type="button" className="btn-primary btn-auto pj-ml" onClick={() => setDepot(true)}>⬆ Déposer un justificatif</button>}
      </div>
      <div className="pj-barre-outils">
        <input type="search" className="pj-recherche" placeholder="Rechercher : objet, fournisseur, n° de pièce…" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
        <select value={filtre.activite} onChange={(e) => setFiltre({ ...filtre, activite: e.target.value })} className="pj-select">
          <option value="">Toutes les activités</option>
          {d.activites.map((a) => <option key={a.id} value={a.id}>{a.nom}</option>)}
        </select>
        <select value={filtre.statut} onChange={(e) => setFiltre({ ...filtre, statut: e.target.value })} className="pj-select">
          <option value="">Tous les statuts</option>
          {Object.entries(STATUTS_JUSTIF).map(([k, v]) => <option key={k} value={k}>{v.lib}</option>)}
        </select>
      </div>
      {pieces === null ? <div className="loading-msg">Chargement…</div> : (
        <TablePieces pieces={visibles} projetId={d.projet.id} onChange={() => { charger(); onChange(); }}
          vide={pieces.length ? 'Aucune pièce ne correspond aux filtres.' : 'Aucun justificatif déposé pour l\'instant.'} />
      )}
      {depot && (
        <DepotModal projetId={d.projet.id} activites={deposables} remises={d.remises} activiteInitiale={filtre.activite}
          onFermer={() => setDepot(false)} onDepose={() => { setDepot(false); charger(); onChange(); }} />
      )}
    </div>
  );
}
