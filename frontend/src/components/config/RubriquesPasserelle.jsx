import { useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { fmt } from '@/lib/format';
import PlanComptableAutocomplete from '@/components/PlanComptableAutocomplete';
import '@/styles/passerelle-pro.css';

// Rubriques de la passerelle — écran interactif (28/10/2026).
// Le compte se saisit DANS la ligne ; « Valider » (cabinet) ou « Proposer »
// (directeur) d'un clic ou avec Entrée ; une proposition s'accepte ou se rejette
// sur place ; sélection multiple pour valider en série. Les règles restent
// celles du serveur (compte de détail, sens, version) : l'écran affiche ses
// réponses ligne par ligne, sans recharger ni perdre sa place.

const ETATS = {
  valide:          { label: 'Validé',             ton: 'ok' },
  a_valider:       { label: 'À valider',          ton: 'attente' },
  non_mappe:       { label: 'Sans compte',        ton: 'neutre' },
  ecart:           { label: 'Écart',              ton: 'alerte' },
  compte_invalide: { label: 'Compte invalide',    ton: 'erreur' },
  virement:        { label: 'Virement interne',   ton: 'violet' },
  incoherent:      { label: 'Sens contraire',     ton: 'erreur' },
  regroupement:    { label: 'Compte à détailler', ton: 'alerte' },
};
const Etat = ({ etat }) => {
  const e = ETATS[etat] || ETATS.non_mappe;
  return <span className={`pp-etat pp-${e.ton}`}>{e.label}</span>;
};

const FILTRES = [
  { id: 'attention', label: 'À traiter', test: (r) => !['valide', 'virement'].includes(r.etat) || r.proposition },
  { id: 'a_valider', label: 'Propositions', test: (r) => Boolean(r.proposition) },
  { id: 'valide', label: 'Validées', test: (r) => r.etat === 'valide' || r.etat === 'virement' },
  { id: 'tous', label: 'Toutes', test: () => true },
];

const valeurInitiale = (r) => r.proposition?.compte || r.suggestion?.compte || r.validee?.compte || '';
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '');

export default function RubriquesPasserelle({ rubriques, compteVirements, peutValider, peutProposer, onRecharger, onImporter, onHistorique }) {
  const toast = useToast();
  const [filtre, setFiltre] = useState('attention');
  const [q, setQ] = useState('');
  const [saisies, setSaisies] = useState({});        // id → compte saisi (lignes modifiées seulement)
  const [libelles, setLibelles] = useState({});      // id → intitulé du compte choisi dans la liste
  const [etatLigne, setEtatLigne] = useState({});    // id → { enCours, erreur, avertissement, fait }
  const [traitees, setTraitees] = useState(() => new Set()); // restent visibles dans « À traiter » jusqu'au changement de filtre
  const [rejet, setRejet] = useState(null);          // { id, motif }
  const [selection, setSelection] = useState(() => new Set());
  const [serie, setSerie] = useState(null);          // { fait, total } pendant une validation en série
  const champs = useRef({});

  const compteDe = (r) => (saisies[r.id] ?? valeurInitiale(r));
  const majLigne = (id, v) => setEtatLigne((x) => ({ ...x, [id]: { ...x[id], ...v } }));

  const compteurs = useMemo(() => Object.fromEntries(FILTRES.map((f) => [f.id, rubriques.filter(f.test).length])), [rubriques]);
  const visibles = useMemo(() => {
    const f = FILTRES.find((x) => x.id === filtre);
    const s = q.trim().toLowerCase();
    let liste = rubriques.filter((r) => f.test(r) || traitees.has(r.id));
    if (s) {
      liste = liste.filter((r) => [r.code, r.intitule, r.validee?.compte, r.proposition?.compte, r.code_comptable]
        .some((x) => String(x || '').toLowerCase().includes(s)));
    }
    if (filtre === 'attention') liste = [...liste].sort((a, b) => (b.montant_a_exporter || 0) - (a.montant_a_exporter || 0));
    return liste;
  }, [rubriques, filtre, q, traitees]);

  const totalMappables = rubriques.filter((r) => !r.est_virement_interne).length;
  const nbValidees = rubriques.filter((r) => r.etat === 'valide').length;
  const pct = totalMappables ? Math.round((nbValidees / totalMappables) * 100) : 0;

  const changerFiltre = (id) => { setFiltre(id); setTraitees(new Set()); setSelection(new Set()); };

  const focusSuivante = (id) => {
    const ids = visibles.filter((r) => !r.est_virement_interne).map((r) => r.id);
    const suivant = ids[ids.indexOf(id) + 1];
    if (suivant && champs.current[suivant]) champs.current[suivant].focus();
  };

  // ── Actions d'une ligne ────────────────────────────────────────────────────
  const enregistrer = async (r, { silencieux = false } = {}) => {
    const compte = compteDe(r).trim();
    if (!compte) { majLigne(r.id, { erreur: 'Saisissez un compte.' }); return false; }
    majLigne(r.id, { enCours: true, erreur: null, avertissement: null });
    const res = await api.post('/passerelle/equivalences', { rubrique_id: r.id, compte });
    if (res.error) { majLigne(r.id, { enCours: false, erreur: res.error }); return false; }
    const fait = res.statut === 'valide' ? `Validé : ${res.compte}` : res.statut === 'inchange' ? 'Inchangé' : `Proposé : ${res.compte}`;
    majLigne(r.id, { enCours: false, fait, avertissement: res.avertissement || null });
    setSaisies((x) => { const y = { ...x }; delete y[r.id]; return y; });
    setTraitees((t) => new Set(t).add(r.id));
    if (!silencieux) { await onRecharger(); focusSuivante(r.id); }
    return true;
  };

  const decider = async (r, decision, motif = '') => {
    majLigne(r.id, { enCours: true, erreur: null });
    const res = await api.patch(`/passerelle/equivalences/${r.proposition.id}/decision`, { decision, motif });
    if (res.error) { majLigne(r.id, { enCours: false, erreur: res.error }); return false; }
    majLigne(r.id, { enCours: false, fait: decision === 'valider' ? `Accepté : ${r.proposition.compte}` : 'Proposition rejetée', avertissement: res.avertissement || null });
    setTraitees((t) => new Set(t).add(r.id));
    setRejet(null);
    await onRecharger();
    return true;
  };

  // Action principale d'une ligne : accepter la proposition telle quelle si le
  // compte n'a pas été changé, sinon enregistrer le compte saisi.
  const actionPrincipale = (r) => {
    if (peutValider && r.proposition && compteDe(r).trim() === r.proposition.compte) return decider(r, 'valider');
    return enregistrer(r);
  };

  // ── Série : lignes sélectionnées ───────────────────────────────────────────
  const toutCocher = (oui) => setSelection(oui ? new Set(visibles.filter((r) => !r.est_virement_interne).map((r) => r.id)) : new Set());
  const basculer = (id) => setSelection((s) => { const t = new Set(s); if (t.has(id)) t.delete(id); else t.add(id); return t; });
  const validerSerie = async () => {
    const lignes = rubriques.filter((r) => selection.has(r.id) && compteDe(r).trim());
    const ignorees = selection.size - lignes.length;
    setSerie({ fait: 0, total: lignes.length });
    let ok = 0;
    for (const r of lignes) {
      // eslint-disable-next-line no-await-in-loop
      const reussi = (peutValider && r.proposition && compteDe(r).trim() === r.proposition.compte)
        ? await decider(r, 'valider') : await enregistrer(r, { silencieux: true });
      if (reussi) ok += 1;
      setSerie((s) => ({ ...s, fait: s.fait + 1 }));
    }
    setSerie(null); setSelection(new Set());
    await onRecharger();
    const echecs = lignes.length - ok;
    toast(`${ok} rubrique(s) ${peutValider ? 'validée(s)' : 'proposée(s)'}${echecs ? ` · ${echecs} à corriger (voir les lignes en rouge)` : ''}${ignorees ? ` · ${ignorees} sans compte ignorée(s)` : ''}.`, echecs ? 'error' : 'success', 5000);
  };

  const preremplir = () => {
    const n = {};
    const l = {};
    rubriques.forEach((r) => {
      if (!r.validee && !r.proposition && r.suggestion && saisies[r.id] === undefined) { n[r.id] = r.suggestion.compte; l[r.id] = r.suggestion.intitule; }
    });
    setSaisies((x) => ({ ...x, ...n }));
    setLibelles((x) => ({ ...x, ...l }));
    setSelection(new Set(Object.keys(n).map(Number)));
    toast(Object.keys(n).length ? `${Object.keys(n).length} suggestion(s) reprise(s) et sélectionnée(s) : vérifiez puis validez la sélection.` : 'Aucune suggestion à reprendre.', 'success', 5000);
  };
  const nbSuggestions = rubriques.filter((r) => !r.validee && !r.proposition && r.suggestion).length;

  const libelleAction = peutValider ? 'Valider' : 'Proposer';
  const visiblesEditables = visibles.filter((r) => !r.est_virement_interne);
  const toutCoche = visiblesEditables.length > 0 && visiblesEditables.every((r) => selection.has(r.id));

  return (
    <section className="pp" aria-labelledby="pp-titre">
      <div className="pp-entete">
        <div>
          <h4 id="pp-titre" className="pp-titre">Rubriques <span>{rubriques.length}</span></h4>
          <div className="pp-progression" aria-label={`${nbValidees} rubriques validées sur ${totalMappables}`}>
            <div className="pp-barre"><div style={{ width: `${pct}%` }} className={pct === 100 ? 'complet' : ''} /></div>
            <span><b>{nbValidees}</b> / {totalMappables} validées · {pct} %</span>
          </div>
        </div>
        <div className="pp-outils">
          <input type="search" className="pp-recherche" placeholder="🔍 Rubrique ou compte…" value={q}
            onChange={(e) => setQ(e.target.value)} aria-label="Rechercher une rubrique ou un compte" />
          {peutProposer && nbSuggestions > 0 && (
            <button type="button" className="pp-btn pp-secondaire" onClick={preremplir} title="Reprend le code comptable déjà saisi sur chaque rubrique, quand il est valable">
              ✨ Reprendre {nbSuggestions} suggestion(s)
            </button>
          )}
          {peutProposer && <button type="button" className="pp-btn pp-secondaire" onClick={onImporter}>⇪ Importer</button>}
        </div>
      </div>

      <div className="pp-filtres" role="tablist" aria-label="Filtrer les rubriques">
        {FILTRES.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={filtre === f.id}
            className={'pp-filtre' + (filtre === f.id ? ' actif' : '')} onClick={() => changerFiltre(f.id)}>
            {f.label} <span className="pp-compte">{compteurs[f.id]}</span>
          </button>
        ))}
      </div>

      {peutProposer && selection.size > 0 && (
        <div className="pp-serie" role="region" aria-label="Actions sur la sélection">
          <span><b>{selection.size}</b> rubrique(s) sélectionnée(s)</span>
          {serie ? (
            <span className="pp-serie-avance">Traitement… {serie.fait} / {serie.total}</span>
          ) : (
            <>
              <button type="button" className="pp-btn pp-primaire" onClick={validerSerie}>✓ {libelleAction} la sélection</button>
              <button type="button" className="pp-btn pp-lien" onClick={() => setSelection(new Set())}>Tout désélectionner</button>
            </>
          )}
        </div>
      )}

      <div className="pp-table-wrap">
        <table className="pp-table">
          <thead>
            <tr>
              {peutProposer && (
                <th className="pp-col-check">
                  <input type="checkbox" checked={toutCoche} onChange={(e) => toutCocher(e.target.checked)} aria-label="Tout sélectionner" />
                </th>
              )}
              <th>Rubrique</th>
              <th className="pp-col-compte">Compte comptable</th>
              <th>État</th>
              <th className="pp-col-action"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((r) => {
              const el = etatLigne[r.id] || {};
              const valeur = compteDe(r);
              const modifie = saisies[r.id] !== undefined;
              const estProposition = Boolean(r.proposition) && valeur.trim() === r.proposition.compte;
              const intituleAffiche = libelles[r.id] && modifie ? libelles[r.id]
                : estProposition ? r.proposition.intitule
                  : (!modifie && r.suggestion && !r.validee) ? r.suggestion.intitule
                    : (valeur === r.validee?.compte ? r.validee?.intitule : null);
              const dejaValide = r.etat === 'valide' && !modifie && !r.proposition;
              return (
                <tr key={r.id} className={[el.fait && !el.erreur ? 'pp-ligne-faite' : '', el.erreur ? 'pp-ligne-erreur' : '', selection.has(r.id) ? 'pp-ligne-choisie' : ''].join(' ')}>
                  {peutProposer && (
                    <td className="pp-col-check">
                      {!r.est_virement_interne && (
                        <input type="checkbox" checked={selection.has(r.id)} onChange={() => basculer(r.id)} aria-label={`Sélectionner la rubrique ${r.code}`} />
                      )}
                    </td>
                  )}
                  <td>
                    <div className="pp-rubrique">
                      <span className="pp-code">{r.code}</span>
                      <div>
                        <div className="pp-intitule">
                          {r.intitule}
                          {r.archivee && <span className="pp-pastille">archivée</span>}
                        </div>
                        <div className="pp-meta">
                          <span className={r.type === 'entree' ? 'pp-sens pp-entree' : 'pp-sens pp-depense'}>{r.type === 'entree' ? 'Entrée · classe 7' : 'Dépense · classe 6'}</span>
                          {r.nb_a_exporter > 0 && <span>{r.nb_a_exporter} mvt · {fmt(r.montant_a_exporter)}</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="pp-col-compte">
                    {r.est_virement_interne ? (
                      <div className="pp-fixe"><code>{compteVirements}</code> <span>compte des virements internes</span></div>
                    ) : peutProposer ? (
                      <>
                        <PlanComptableAutocomplete
                          value={valeur}
                          onChange={(v) => { setSaisies((x) => ({ ...x, [r.id]: v })); setLibelles((x) => ({ ...x, [r.id]: null })); majLigne(r.id, { erreur: null, fait: null }); }}
                          onSelect={(ligne) => setLibelles((x) => ({ ...x, [r.id]: ligne.intitule }))}
                          onEnter={() => actionPrincipale(r)}
                          placeholder="Compte ou mot-clé (ex. 6052, transport)"
                          inputStyle={{ padding: '8px 10px', borderRadius: 8, border: `1.5px solid ${el.erreur ? '#f87171' : modifie ? 'var(--accent)' : 'var(--border)'}`, fontSize: 13.5 }}
                          inputProps={{ ref: (n) => { champs.current[r.id] = n; }, 'aria-label': `Compte de la rubrique ${r.code}`, disabled: el.enCours }}
                        />
                        <div className="pp-sous-champ">
                          {intituleAffiche && <span className="pp-libelle">{intituleAffiche}</span>}
                          {!modifie && r.proposition && (
                            <span className="pp-info">Proposé par {r.proposition.propose_par || '—'} le {fmtDate(r.proposition.propose_le)}{r.proposition.commentaire ? ` · « ${r.proposition.commentaire} »` : ''}</span>
                          )}
                          {!modifie && !r.proposition && r.suggestion && !r.validee && <span className="pp-info pp-suggere">✨ Suggestion reprise du code de la rubrique</span>}
                          {r.validee && (modifie || r.proposition) && <span className="pp-info">En vigueur : <code>{r.validee.compte}</code> v{r.validee.version}</span>}
                        </div>
                      </>
                    ) : (
                      <div className="pp-fixe"><code>{r.validee?.compte || '—'}</code> {r.validee?.intitule && <span>{r.validee.intitule}</span>}</div>
                    )}
                    {el.erreur && <div className="pp-msg pp-msg-erreur" role="alert">{el.erreur}</div>}
                    {el.avertissement && <div className="pp-msg pp-msg-alerte">⚠ {el.avertissement}</div>}
                    {r.alerte && !el.erreur && <div className="pp-msg pp-msg-alerte">⚠ {r.alerte}</div>}
                  </td>
                  <td>
                    {el.fait && !el.erreur ? <span className="pp-etat pp-ok">✓ {el.fait}</span> : <Etat etat={r.etat} />}
                  </td>
                  <td className="pp-col-action">
                    {!r.est_virement_interne && (
                      <div className="pp-actions">
                        {peutProposer && rejet?.id !== r.id && (
                          <button type="button" className="pp-btn pp-primaire pp-petit" disabled={el.enCours || dejaValide || !valeur.trim()}
                            onClick={() => actionPrincipale(r)}
                            title={estProposition && peutValider ? `Accepter le compte proposé ${r.proposition.compte}` : `${libelleAction} ce compte (Entrée)`}>
                            {el.enCours ? <span className="pp-spin" aria-hidden="true" /> : '✓'} {estProposition && peutValider ? 'Accepter' : libelleAction}
                          </button>
                        )}
                        {peutValider && r.proposition && rejet?.id !== r.id && (
                          <button type="button" className="pp-btn pp-danger pp-petit" disabled={el.enCours} onClick={() => setRejet({ id: r.id, motif: '' })} title="Rejeter la proposition">✕</button>
                        )}
                        <button type="button" className="pp-btn pp-icone" onClick={() => onHistorique(r)} title="Historique des versions" aria-label={`Historique de la rubrique ${r.code}`}>🕘</button>
                      </div>
                    )}
                    {rejet?.id === r.id && (
                      <div className="pp-rejet">
                        <input type="text" autoFocus placeholder="Motif du rejet (obligatoire)" value={rejet.motif} maxLength={500}
                          onChange={(e) => setRejet({ id: r.id, motif: e.target.value })}
                          onKeyDown={(e) => { if (e.key === 'Enter' && rejet.motif.trim()) decider(r, 'rejeter', rejet.motif.trim()); if (e.key === 'Escape') setRejet(null); }}
                          aria-label="Motif du rejet" />
                        <button type="button" className="pp-btn pp-danger pp-petit" disabled={!rejet.motif.trim() || el.enCours} onClick={() => decider(r, 'rejeter', rejet.motif.trim())}>Rejeter</button>
                        <button type="button" className="pp-btn pp-lien" onClick={() => setRejet(null)}>Annuler</button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {visibles.length === 0 && (
              <tr><td colSpan={peutProposer ? 5 : 4} className="pp-vide">
                {q ? 'Aucune rubrique ne correspond à la recherche.'
                  : filtre === 'attention' ? '🎉 Rien à traiter : toutes les rubriques ont un compte validé.' : 'Aucune rubrique.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      {peutProposer && (
        <p className="pp-aide">
          Astuce : tapez un compte ou un mot-clé, choisissez dans la liste (↑ ↓ Entrée), puis <kbd>Entrée</kbd> pour {peutValider ? 'valider' : 'proposer'} et passer à la ligne suivante.
          {!peutValider && ' Vos propositions sont validées par le cabinet ; le compte en vigueur reste utilisé jusque-là.'}
        </p>
      )}
    </section>
  );
}
