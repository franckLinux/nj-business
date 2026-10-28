import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import PlanComptableAutocomplete from '@/components/PlanComptableAutocomplete';
import SimulationExport from '@/components/config/SimulationExport';
import RubriquesPasserelle from '@/components/config/RubriquesPasserelle';
import { fmt } from '@/lib/format';

// Passerelle comptable — lot 1 : paramétrage (migration 037).
// Rattache rubriques et journaux aux comptes du plan du client, en vue de
// l'export des écritures (CSV, puis SAGE i7). Le directeur PROPOSE, le
// cabinet VALIDE (passerelle.valider) — ses propres saisies sont validées
// d'office. Toutes les règles sont appliquées par l'API ; l'écran ne fait
// qu'afficher l'état et relayer les messages du serveur.

const ETATS = {
  valide:          { label: 'Validé',          bg: '#dcfce7', fg: '#166534' },
  a_valider:       { label: 'À valider',       bg: '#fef3c7', fg: '#92400e' },
  non_mappe:       { label: 'Sans compte',     bg: '#f1f5f9', fg: '#475569' },
  ecart:           { label: 'Écart',           bg: '#ffedd5', fg: '#9a3412' },
  compte_invalide: { label: 'Compte invalide', bg: '#fee2e2', fg: '#991b1b' },
  virement:        { label: 'Virement interne', bg: '#ede9fe', fg: '#5b21b6' },
  incomplet:       { label: 'Incomplet',       bg: '#fee2e2', fg: '#991b1b' },
  incoherent:      { label: 'Sens contraire',  bg: '#fee2e2', fg: '#991b1b' },
  regroupement:    { label: 'Compte à détailler', bg: '#ffedd5', fg: '#9a3412' },
  ok:              { label: 'Paramétré',       bg: '#dcfce7', fg: '#166534' },
};

const STATUTS_HISTO = { valide: 'En vigueur', archive: 'Archivée', brouillon: 'Proposée', rejete: 'Rejetée' };

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '');

function Badge({ etat }) {
  const e = ETATS[etat] || ETATS.non_mappe;
  return (
    <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: e.bg, color: e.fg, whiteSpace: 'nowrap' }}>
      {e.label}
    </span>
  );
}

function Jauge({ ok, total, libelle }) {
  const pct = total ? Math.round((ok / total) * 100) : 0;
  return (
    <div style={{ flex: '1 1 180px', minWidth: 160 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
        <span>{libelle}</span><strong style={{ color: 'var(--text)' }}>{ok} / {total}</strong>
      </div>
      <div style={{ height: 8, background: '#e2e8f0', borderRadius: 6, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? 'var(--accent-green)' : 'var(--accent)', transition: 'width .3s' }} />
      </div>
    </div>
  );
}

function Modal({ titre, onClose, children, pied }) {
  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box">
        <div className="modal-head">
          <h3>{titre}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {pied && <div className="modal-foot">{pied}</div>}
      </div>
    </div>
  );
}

// ── Proposer / saisir le compte d'une rubrique ───────────────────────────────
function CompteRubriqueModal({ rubrique, peutValider, onClose, onSaved }) {
  const [compte, setCompte] = useState(rubrique.proposition?.compte || rubrique.validee?.compte || rubrique.code_comptable || '');
  const [commentaire, setCommentaire] = useState('');
  const [erreur, setErreur] = useState('');
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    if (!compte.trim()) { setErreur('Compte obligatoire.'); return; }
    setSaving(true);
    const res = await api.post('/passerelle/equivalences', { rubrique_id: rubrique.id, compte: compte.trim(), commentaire });
    setSaving(false);
    if (res.error) { setErreur(res.error); return; }
    onSaved(res.statut === 'valide' ? `Compte ${res.compte} validé (version ${res.version}) ✓`
      : res.statut === 'inchange' ? 'Compte inchangé.' : `Compte ${res.compte} proposé au cabinet ✓`, res.avertissement);
  };

  return (
    <Modal titre={`Compte de la rubrique ${rubrique.code}`} onClose={onClose} pied={(
      <>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" style={{ width: 'auto', marginTop: 0 }} onClick={onSave} disabled={saving}>
          {peutValider ? '✓ Enregistrer et valider' : '📨 Proposer au cabinet'}
        </button>
      </>
    )}>
      <p style={{ fontSize: 13, marginBottom: 12 }}>
        <strong>{rubrique.intitule}</strong> — {rubrique.type === 'entree' ? 'entrée (compte crédité)' : 'dépense (compte débité)'}
      </p>
      {rubrique.validee && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
          En vigueur : <code>{rubrique.validee.compte}</code> (version {rubrique.validee.version}, validée le {fmtDate(rubrique.validee.decide_le)})
        </div>
      )}
      <label>Compte du plan comptable *</label>
      <PlanComptableAutocomplete value={compte} onChange={setCompte} placeholder="Ex : 6052, électricité, transport…" />
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
        Règles : compte de <b>détail</b> (pas un compte de regroupement), existant et actif dans le plan du client ;
        {rubrique.type === 'entree' ? ' une entrée ne peut pas aller sur un compte de charge (classe 6).' : ' une dépense ne peut pas aller sur un compte de produit (classe 7).'}
        {' '}Une classe inhabituelle (2, 4, 5…) est acceptée avec un avertissement.
      </div>
      <label style={{ marginTop: 12, display: 'block' }}>Commentaire <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 11 }}>(facultatif)</span></label>
      <input type="text" value={commentaire} onChange={(e) => setCommentaire(e.target.value)} maxLength={500} placeholder="Justification pour le cabinet" />
      {!peutValider && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
          Votre proposition sera soumise au cabinet ; le compte en vigueur reste utilisé jusqu'à sa validation.
        </div>
      )}
      {erreur && <div className="alert-err" style={{ marginTop: 12 }}>{erreur}</div>}
    </Modal>
  );
}

// ── Décision du cabinet ──────────────────────────────────────────────────────
function DecisionModal({ rubrique, onClose, onSaved }) {
  const [motif, setMotif] = useState('');
  const [erreur, setErreur] = useState('');
  const [saving, setSaving] = useState(false);
  const p = rubrique.proposition;

  const decider = async (decision) => {
    if (decision === 'rejeter' && !motif.trim()) { setErreur('Indiquez le motif du rejet.'); return; }
    setSaving(true);
    const res = await api.patch(`/passerelle/equivalences/${p.id}/decision`, { decision, motif });
    setSaving(false);
    if (res.error) { setErreur(res.error); return; }
    onSaved(decision === 'valider' ? `Compte ${p.compte} validé pour ${rubrique.code} ✓` : 'Proposition rejetée.', res.avertissement);
  };

  return (
    <Modal titre={`Proposition — rubrique ${rubrique.code}`} onClose={onClose} pied={(
      <>
        <button className="btn-ghost" onClick={() => decider('rejeter')} disabled={saving} style={{ color: '#991b1b' }}>✕ Rejeter</button>
        <button className="btn-primary" style={{ width: 'auto', marginTop: 0 }} onClick={() => decider('valider')} disabled={saving}>✓ Valider</button>
      </>
    )}>
      <p style={{ fontSize: 13, marginBottom: 10 }}><strong>{rubrique.intitule}</strong></p>
      <div style={{ fontSize: 13, lineHeight: 1.8 }}>
        <div>Compte proposé : <code style={{ fontWeight: 700 }}>{p.compte}</code></div>
        <div>En vigueur : {rubrique.validee ? <code>{rubrique.validee.compte}</code> : <em>aucun</em>}</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Proposé par {p.propose_par || '—'} le {fmtDate(p.propose_le)}</div>
        {p.commentaire && <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>« {p.commentaire} »</div>}
      </div>
      <label style={{ marginTop: 12, display: 'block' }}>Motif <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 11 }}>(obligatoire pour un rejet)</span></label>
      <input type="text" value={motif} onChange={(e) => setMotif(e.target.value)} maxLength={500} placeholder="Ex : utiliser le compte 6281" />
      {erreur && <div className="alert-err" style={{ marginTop: 12 }}>{erreur}</div>}
    </Modal>
  );
}

// ── Historique des versions ──────────────────────────────────────────────────
function HistoriqueModal({ rubrique, onClose }) {
  const [lignes, setLignes] = useState(null);
  const [erreur, setErreur] = useState('');
  useEffect(() => {
    api.get(`/passerelle/rubriques/${rubrique.id}/historique`).then((res) => {
      if (res.error) setErreur(res.error); else setLignes(res);
    });
  }, [rubrique.id]);
  return (
    <Modal titre={`Historique — rubrique ${rubrique.code}`} onClose={onClose}>
      {erreur && <div className="alert-err">{erreur}</div>}
      {!lignes && !erreur && <div className="loading-msg">Chargement…</div>}
      {lignes && lignes.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Aucune version enregistrée.</p>}
      {lignes && lignes.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>V.</th><th>Compte</th><th>Statut</th><th>Proposé</th><th>Décidé</th></tr></thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.id}>
                  <td>{l.version}</td>
                  <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{l.compte}</td>
                  <td>
                    {STATUTS_HISTO[l.statut] || l.statut}
                    {l.motif_rejet && <div style={{ fontSize: 11, color: '#991b1b' }}>{l.motif_rejet}</div>}
                  </td>
                  <td style={{ fontSize: 12 }}>{l.propose_par || '—'}<br /><span style={{ color: 'var(--text-muted)' }}>{fmtDate(l.propose_le)}</span></td>
                  <td style={{ fontSize: 12 }}>{l.decide_par || '—'}<br /><span style={{ color: 'var(--text-muted)' }}>{fmtDate(l.decide_le)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

// ── Import en lot (copier-coller depuis Excel / SAGE) ────────────────────────
function ImportModal({ rubriques, peutValider, onClose, onSaved }) {
  const [texte, setTexte] = useState('');
  const [rapport, setRapport] = useState(null);
  const [erreur, setErreur] = useState('');
  const [saving, setSaving] = useState(false);

  const reprendre = () => {
    const lignes = rubriques
      .filter((r) => !r.est_virement_interne && r.etat === 'non_mappe' && r.code_comptable)
      .map((r) => `${r.code};${r.code_comptable}`);
    setTexte(lignes.join('\n'));
    if (lignes.length === 0) setErreur('Aucune rubrique sans compte validé ne porte de code comptable à reprendre.');
  };

  const lire = () => texte.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((l) => l.split(/[;\t,]/).map((x) => x.trim()))
    .filter((c) => c.length >= 2 && c[0] && c[1] && !/^code/i.test(c[0]))
    .map(([rubrique_code, compte]) => ({ rubrique_code, compte }));

  const onImport = async () => {
    const lignes = lire();
    if (lignes.length === 0) { setErreur('Aucune ligne « code rubrique ; compte » reconnue.'); return; }
    setSaving(true); setErreur('');
    const res = await api.post('/passerelle/equivalences/lot', { lignes });
    setSaving(false);
    if (res.error) { setErreur(res.error); return; }
    setRapport(res);
  };

  return (
    <Modal titre="Importer les comptes des rubriques" onClose={rapport ? () => onSaved('Import terminé ✓') : onClose} pied={rapport ? (
      <button className="btn-primary" style={{ width: 'auto', marginTop: 0 }} onClick={() => onSaved('Import terminé ✓')}>Fermer</button>
    ) : (
      <>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" style={{ width: 'auto', marginTop: 0 }} onClick={onImport} disabled={saving}>
          {peutValider ? '✓ Importer et valider' : '📨 Importer comme propositions'}
        </button>
      </>
    )}>
      {!rapport && (
        <>
          <p style={{ fontSize: 13, marginBottom: 8 }}>
            Une ligne par rubrique : <code>code rubrique ; compte</code> (séparateur point-virgule, tabulation ou virgule — un copier-coller depuis Excel fonctionne).
          </p>
          <button type="button" className="btn-ghost" style={{ fontSize: 12, marginBottom: 8 }} onClick={reprendre}>
            ↺ Reprendre les codes comptables déjà saisis sur les rubriques
          </button>
          <textarea value={texte} onChange={(e) => setTexte(e.target.value)} rows={10}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: 13, padding: 8, border: '1px solid var(--border)', borderRadius: 8 }}
            placeholder={'1;6047\n2;6181\n3;6052'} />
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>{lire().length} ligne(s) reconnue(s)</div>
        </>
      )}
      {rapport && (
        <div style={{ fontSize: 13, lineHeight: 1.8 }}>
          <div>✓ {rapport.traitees} ligne(s) traitée(s) : {rapport.valide} validée(s), {rapport.brouillon} proposée(s), {rapport.inchange} inchangée(s).</div>
          {(rapport.avertissements || []).length > 0 && (
            <div style={{ marginTop: 10, background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: 8, padding: '8px 10px', fontSize: 12.5 }}>
              <strong>{rapport.avertissements.length} avertissement(s) — accepté(s), à vérifier :</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{rapport.avertissements.map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
          )}
          {rapport.erreurs.length > 0 && (
            <div className="alert-err" style={{ marginTop: 10 }}>
              <strong>{rapport.erreurs.length} ligne(s) non importée(s) :</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{rapport.erreurs.map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
          )}
        </div>
      )}
      {erreur && <div className="alert-err" style={{ marginTop: 12 }}>{erreur}</div>}
    </Modal>
  );
}

// ── Ligne journal (édition en place, cabinet) ────────────────────────────────
function LigneJournal({ j, peutValider, onSaved }) {
  const [compte, setCompte] = useState(j.compte_tresorerie || j.suggestion?.compte_tresorerie || '');
  const [code, setCode] = useState(j.code_journal_compta || j.suggestion?.code_journal_compta || '');
  const [erreur, setErreur] = useState('');
  const [saving, setSaving] = useState(false);
  const modifie = compte !== (j.compte_tresorerie || '') || code !== (j.code_journal_compta || '');

  const onSave = async () => {
    setSaving(true); setErreur('');
    const res = await api.put(`/passerelle/journaux/${j.id}`, { compte_tresorerie: compte.trim(), code_journal_compta: code.trim() });
    setSaving(false);
    if (res.error) { setErreur(res.error); return; }
    onSaved(`Journal ${j.code} paramétré ✓`, res.avertissement);
  };

  return (
    <tr style={j.actif ? undefined : { opacity: 0.55 }}>
      <td><span className="badge-rubrique">{j.code}</span></td>
      <td style={{ fontWeight: 500 }}>{j.nom}{!j.actif && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}> (inactif)</span>}</td>
      <td style={{ minWidth: 170 }}>
        {peutValider ? (
          <PlanComptableAutocomplete value={compte} onChange={setCompte} placeholder="571, 521, 552…" inputStyle={{ padding: '6px 8px' }} />
        ) : (
          <span style={{ fontFamily: 'monospace' }}>{j.compte_tresorerie || '—'}</span>
        )}
        {j.intitule_compte && !modifie && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{j.intitule_compte}</div>}
        {!j.compte_tresorerie && j.suggestion?.compte_tresorerie && peutValider && <div style={{ fontSize: 11, color: '#92400e', marginTop: 2 }}>Suggestion à confirmer</div>}
        {j.alerte && <div style={{ fontSize: 11, color: '#9a3412', marginTop: 2, maxWidth: 280 }}>⚠ {j.alerte}</div>}
      </td>
      <td style={{ width: 110 }}>
        {peutValider ? (
          <input type="text" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} maxLength={6} title="1 à 6 lettres ou chiffres" style={{ fontFamily: 'monospace', padding: '6px 8px', width: '100%' }} />
        ) : (
          <span style={{ fontFamily: 'monospace' }}>{j.code_journal_compta || '—'}</span>
        )}
      </td>
      <td><Badge etat={j.etat} /></td>
      {peutValider && (
        <td>
          <button className="btn-icon" title="Enregistrer" onClick={onSave} disabled={saving || (!modifie && j.etat === 'ok')}>💾</button>
          {erreur && <div style={{ fontSize: 11, color: '#991b1b', maxWidth: 220 }}>{erreur}</div>}
        </td>
      )}
    </tr>
  );
}

// ── Paramètres généraux (cabinet) ────────────────────────────────────────────
function Parametres({ parametres, peutValider, onSaved }) {
  const [compte, setCompte] = useState(parametres.compte_virements || '585');
  const [erreur, setErreur] = useState('');
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    setSaving(true); setErreur('');
    const res = await api.put('/passerelle/parametres', { compte_virements: compte.trim(), format_export: 'csv' });
    setSaving(false);
    if (res.error) { setErreur(res.error); return; }
    onSaved('Paramètres enregistrés ✓');
  };

  return (
    <div className="fgrid2 passerelle-form" style={{ alignItems: 'start' }}>
      <div>
        <label>Compte des virements internes</label>
        {peutValider ? (
          <PlanComptableAutocomplete value={compte} onChange={setCompte} placeholder="585" />
        ) : (
          <div style={{ fontFamily: 'monospace', padding: '8px 0' }}>{parametres.compte_virements}</div>
        )}
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          {parametres.intitule_compte_virements || 'Compte de transit entre caisses (SYSCOHADA : 585 Virements de fonds).'}
        </div>
      </div>
      <div>
        <label>Format d'export</label>
        <select value={parametres.format_export} disabled={!peutValider} onChange={() => {}}>
          {parametres.formats_disponibles.map((f) => (
            <option key={f.code} value={f.code} disabled={!f.actif}>{f.libelle}</option>
          ))}
        </select>
        {peutValider && (
          <button className="btn-primary" style={{ width: 'auto', marginTop: 10 }} onClick={onSave} disabled={saving}>💾 Enregistrer</button>
        )}
      </div>
      {erreur && <div className="alert-err" style={{ gridColumn: '1 / -1' }}>{erreur}</div>}
    </div>
  );
}

export default function PasserelleTab() {
  const { can } = useApp();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [erreur, setErreur] = useState('');
  const [modal, setModal] = useState(null); // { type, rubrique? }
  const [version, setVersion] = useState(0); // remonte les lignes journal après enregistrement

  const charger = useCallback(async () => {
    const res = await api.get('/passerelle');
    if (res.error) { setErreur(res.error); return; }
    setErreur(''); setData(res); setVersion((v) => v + 1);
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const peutValider = Boolean(data?.droits?.valider);
  const peutProposer = peutValider || can('passerelle.proposer');

  const apres = (msg, avertissement) => {
    setModal(null); toast(msg, 'success');
    if (avertissement) toast(`⚠ ${avertissement}`, 'warning', 9000);
    charger();
  };

  if (erreur) return <div className="alert-err">{erreur}</div>;
  if (!data) return <div className="loading-msg">Chargement de la passerelle comptable…</div>;

  const c = data.completude;

  return (
    <>
      <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Contrôle de régularité formelle <span style={{ fontWeight: 500, color: 'var(--text-muted)', fontSize: 13 }}>— passerelle comptable</span></h3>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
        Associe chaque rubrique et chaque journal à un compte du plan comptable. Ce paramétrage permettra
        d'exporter les mouvements des mois arrêtés sous forme d'écritures (CSV, puis SAGE i7).
        {!peutValider && ' Vos propositions sont validées par le cabinet.'}
      </p>

      {/* Complétude */}
      <div className="card" style={{ padding: 16, marginBottom: 20, borderLeft: `4px solid ${c.pret ? 'var(--accent-green)' : '#f59e0b'}` }}>
        <div style={{ fontWeight: 700, marginBottom: 10, color: c.pret ? '#166534' : '#92400e' }}>
          {c.pret ? '✓ Paramétrage complet — prêt pour l\'export' : '⚠ Paramétrage incomplet'}
        </div>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <Jauge ok={c.rubriques_ok} total={c.rubriques_total} libelle="Rubriques validées" />
          <Jauge ok={c.journaux_ok} total={c.journaux_total} libelle="Journaux paramétrés" />
        </div>
        {c.propositions_en_attente > 0 && (
          <div style={{ fontSize: 12, marginTop: 10, color: '#92400e' }}>
            {c.propositions_en_attente} proposition(s) en attente de validation par le cabinet.
          </div>
        )}
        {data.anomalies.length > 0 && (
          <details style={{ marginTop: 10, fontSize: 12 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>{data.anomalies.length} point(s) à régler</summary>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>{data.anomalies.map((a) => <li key={a}>{a}</li>)}</ul>
          </details>
        )}
      </div>

      {/* Mode d'emploi : valider un compte */}
      <details className="card" style={{ padding: '10px 16px', marginBottom: 16 }} open={!c.pret}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>📘 Comment valider le paramétrage, étape par étape</summary>
        <ol style={{ margin: '10px 0 4px', paddingLeft: 20, fontSize: 12.5, lineHeight: 1.75 }}>
          <li><b>Journaux de trésorerie</b> (tableau ci-dessous) : pour chaque caisse, choisissez un compte de <b>détail</b> de classe 5
            (ex. 5711, pas 571) et un code journal unique (CA, BQ1, OM…), puis 💾.</li>
          <li><b>Rubriques</b> : filtre <b>« À traiter »</b> (classé par montant à exporter). Tapez le compte <b>directement dans la ligne</b>
            (numéro ou mot-clé, choix dans la liste), puis <b>{peutValider ? '« Valider »' : '« Proposer »'}</b> ou la touche <kbd>Entrée</kbd>.
            {peutValider && <> Une proposition du client s'<b>accepte</b> d'un clic, ou se <b>rejette</b> (✕) avec un motif.</>}
            {' '}En nombre : <b>✨ Reprendre les suggestions</b>, cochez les lignes, puis <b>{peutValider ? 'Valider' : 'Proposer'} la sélection</b> ;
            ou <b>⇪ Importer</b> (« code rubrique ; compte », copier-coller depuis Excel).</li>
          <li><b>Paramètres d'export</b> (en bas) : compte des virements internes (585).</li>
          <li>Quand la jauge affiche <b>« Paramétrage complet »</b>, lancez la <b>balance de contrôle</b> sur un mois : tout doit être ✓
            (avertissements ⚠ acceptés). C'est la preuve que les écritures seront justes.</li>
        </ol>
      </details>

      <SimulationExport rubriques={data.rubriques} onDefinirCompte={peutProposer ? (r) => setModal({ type: 'compte', rubrique: r }) : null} />

      {/* Journaux */}
      <h4 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: 'var(--text-muted)', marginBottom: 6 }}>
        Journaux de trésorerie ({data.journaux.length})
      </h4>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
        Compte de classe 5 mouvementé par chaque caisse, et code du journal dans le logiciel comptable.
        {!peutValider && ' Paramétrage réservé au cabinet.'}
      </p>
      <div className="table-wrap passerelle-table" style={{ marginBottom: 24 }}>
        <table>
          <thead>
            <tr><th>Code</th><th>Journal</th><th>Compte de trésorerie</th><th>Code journal</th><th>État</th>{peutValider && <th />}</tr>
          </thead>
          <tbody>
            {data.journaux.map((j) => <LigneJournal key={`${j.id}-${version}`} j={j} peutValider={peutValider} onSaved={apres} />)}
            {data.journaux.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Aucun journal défini.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Rubriques — écran interactif (28/10/2026) : saisie, validation et
          décision directement dans le tableau. */}
      <RubriquesPasserelle
        rubriques={data.rubriques}
        compteVirements={data.parametres.compte_virements}
        peutValider={peutValider}
        peutProposer={peutProposer}
        onRecharger={charger}
        onImporter={() => setModal({ type: 'import' })}
        onHistorique={(r) => setModal({ type: 'historique', rubrique: r })}
      />

      {/* Paramètres */}
      <h4 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: 'var(--text-muted)', marginBottom: 10 }}>
        Paramètres d'export
      </h4>
      <div className="card" style={{ padding: 16 }}>
        <Parametres key={version} parametres={data.parametres} peutValider={peutValider} onSaved={apres} />
      </div>

      {modal?.type === 'compte' && <CompteRubriqueModal rubrique={modal.rubrique} peutValider={peutValider} onClose={() => setModal(null)} onSaved={apres} />}
      {modal?.type === 'decision' && <DecisionModal rubrique={modal.rubrique} onClose={() => setModal(null)} onSaved={apres} />}
      {modal?.type === 'historique' && <HistoriqueModal rubrique={modal.rubrique} onClose={() => setModal(null)} />}
      {modal?.type === 'import' && <ImportModal rubriques={data.rubriques} peutValider={peutValider} onClose={() => setModal(null)} onSaved={apres} />}
    </>
  );
}
