import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { STATUTS_BUDGET, libelleNature } from '@/lib/projets';
import { Modale, ProjetModal, dateFr, fcfa, pct } from './ProjetsPage';
import { OngletJustificatifs } from '@/components/projets/Justificatifs';

const STATUT_ACT = {
  non_financee: { lib: 'Non financée', cls: 'pj-b-gris' },
  en_attente: { lib: 'En attente de justification', cls: 'pj-b-ambre' },
  validee: { lib: 'Justifiée', cls: 'pj-b-vert' },
  sur_global: { lib: 'Justifiée (remise globale)', cls: 'pj-b-vert' },
};

// Fiche d'un projet (069, lot P2) : chiffres en cascade, activités et
// responsables, budget (préparation → soumission → validation / rejet),
// financements reçus et fonds remis, tous relus dans le journal et ouverts en
// lecture seule. Ce que chacun peut faire est décidé par le serveur.

const lireMontant = (v) => {
  const t = String(v ?? '').replace(/[\s  ]/g, '').replace(',', '.');
  if (t === '') return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

function ActiviteModal({ projetId, activite, onFermer, onEnregistre }) {
  const toast = useToast();
  const [utilisateurs, setUtilisateurs] = useState([]);
  const [f, setF] = useState({ nom: activite?.nom || '', code: activite?.code || '', responsable_id: activite?.responsable_id || '', actif: activite ? activite.actif : true });
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  useEffect(() => { api.get('/projets/utilisateurs').then((r) => { if (Array.isArray(r)) setUtilisateurs(r); }); }, []);

  const supprimer = async () => {
    if (!window.confirm(`Supprimer l'activité « ${activite.nom} » ?\n\nPossible seulement si aucune remise de fonds ni aucun justificatif ne la concerne et si elle n'est pas dans un budget soumis ou validé. Sinon, décochez « Activité active ».`)) return;
    setEnCours(true);
    const r = await api.delete(`/projets/${projetId}/activites/${activite.id}`);
    setEnCours(false);
    if (r.error) { setErreur(r.error); return; }
    toast(r.message || 'Activité supprimée.', 'success');
    onEnregistre();
  };

  const enregistrer = async () => {
    if (!f.nom.trim()) { setErreur('Le nom de l\'activité est obligatoire.'); return; }
    setEnCours(true);
    const corps = { ...f, responsable_id: f.responsable_id || null };
    const r = activite
      ? await api.put(`/projets/${projetId}/activites/${activite.id}`, corps)
      : await api.post(`/projets/${projetId}/activites`, corps);
    setEnCours(false);
    if (r.error) { setErreur(r.error); return; }
    toast(activite ? 'Activité mise à jour.' : 'Activité ajoutée.', 'success');
    onEnregistre();
  };

  return (
    <Modale
      titre={activite ? 'Modifier l\'activité' : 'Nouvelle activité'} onFermer={onFermer} enCours={enCours} largeur={500}
      pied={<>
        {activite && <button type="button" className="btn-ghost pj-btn-rouge-c" onClick={supprimer} disabled={enCours} style={{ marginRight: 'auto' }}>🗑 Supprimer</button>}
        <button type="button" className="btn-ghost" onClick={onFermer} disabled={enCours}>Annuler</button>
        <button type="button" className="btn-primary" onClick={enregistrer} disabled={enCours}>{enCours ? 'Enregistrement…' : '💾 Enregistrer'}</button>
      </>}
    >
      {erreur && <div className="alert-err">{erreur}</div>}
      <div className="pj-grille-2">
        <div className="pj-col-2">
          <label>Activité <span className="req">*</span></label>
          <input type="text" maxLength={120} value={f.nom} autoFocus onChange={(e) => { setF({ ...f, nom: e.target.value }); setErreur(''); }} placeholder="Ex. : Forages" />
        </div>
        <div>
          <label>Code <span className="field-hint pj-inline">(facultatif)</span></label>
          <input type="text" maxLength={20} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} style={{ textTransform: 'uppercase' }} />
        </div>
        <div>
          <label>Responsable d'activité</label>
          <select value={f.responsable_id} onChange={(e) => setF({ ...f, responsable_id: e.target.value })}>
            <option value="">— À désigner —</option>
            {utilisateurs.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
          </select>
        </div>
        {activite && (
          <label className="pj-col-2 pj-case">
            <input type="checkbox" checked={f.actif} onChange={(e) => setF({ ...f, actif: e.target.checked })} />
            Activité active (proposée à la saisie des remises de fonds)
          </label>
        )}
      </div>
      <div className="field-hint">Le responsable voit cette activité, son budget et les fonds qui lui sont remis.</div>
    </Modale>
  );
}

function EcritureModal({ ecriture, type, devise, onFermer }) {
  const ligne = (lib, val) => (val ? <div className="pj-kv"><span>{lib}</span><b>{val}</b></div> : null);
  return (
    <Modale titre={`Écriture n° ${ecriture.numero} — ${ecriture.journal_code || ''}`} onFermer={onFermer} largeur={520}
      pied={<>
        <Link to={`/journal/${ecriture.journal_id}`} className="btn-ghost">Ouvrir le journal</Link>
        <button type="button" className="btn-primary btn-auto" onClick={onFermer}>Fermer</button>
      </>}
    >
      <div className={`pj-ecriture-montant ${type === 'entree' ? 'vert' : 'orange'}${ecriture.annule ? ' annule' : ''}`}>
        {type === 'entree' ? '+' : '−'} {fcfa(type === 'entree' ? ecriture.entree : ecriture.sortie)} {devise}
      </div>
      {ecriture.annule && <div className="alert-err">Écriture annulée (contre-passée){ecriture.motif_annulation ? ` : ${ecriture.motif_annulation}` : ''}. Elle n'est pas comptée.</div>}
      <div className="pj-kvs">
        {ligne('Journal', `${ecriture.journal_code} — ${ecriture.journal_nom}`)}
        {ligne('N° de pièce', String(ecriture.numero))}
        {ligne('Date', dateFr(ecriture.date))}
        {ligne('Rubrique', `${ecriture.rubrique_code} — ${ecriture.intitule}`)}
        {ligne('Compte comptable', ecriture.compte || 'non encore validé (passerelle)')}
        {ligne('Nature', libelleNature(ecriture.nature_recette))}
        {ligne(type === 'entree' ? 'Bailleur / tiers' : 'Bénéficiaire', ecriture.beneficiaire)}
        {ligne('Activité', ecriture.activite_nom)}
        {ligne('Référence du financement', ecriture.reference_financement)}
        {ligne('Objet', ecriture.objet)}
        {ligne('Saisi par', ecriture.saisi_par)}
      </div>
      <div className="field-hint">Lecture seule : une erreur se corrige dans le journal, par annulation (contre-passation) puis nouvelle saisie.</div>
    </Modale>
  );
}

function RejetModal({ onFermer, onConfirmer }) {
  const [motif, setMotif] = useState('');
  const [enCours, setEnCours] = useState(false);
  return (
    <Modale titre="Rejeter le budget" onFermer={onFermer} enCours={enCours} largeur={480}
      pied={<>
        <button type="button" className="btn-ghost" onClick={onFermer} disabled={enCours}>Annuler</button>
        <button type="button" className="btn-primary btn-auto pj-btn-rouge" disabled={enCours || !motif.trim()}
          onClick={async () => { setEnCours(true); await onConfirmer(motif.trim()); setEnCours(false); }}>
          Rejeter
        </button>
      </>}
    >
      <label>Motif du rejet <span className="req">*</span></label>
      <textarea rows={4} maxLength={2000} value={motif} autoFocus onChange={(e) => setMotif(e.target.value)} placeholder="Ce que le chef de projet doit corriger…" />
      <div className="field-hint">Le chef de projet est prévenu et voit ce motif ; il corrige puis soumet à nouveau.</div>
    </Modale>
  );
}

/** Budget en préparation (brouillon / rejeté) ou soumis, et ses actions.
 *  Une activité peut se détailler en lignes budgétaires (lot P4) : son
 *  montant est alors la somme de ses lignes, et chaque justificatif choisit
 *  sa ligne. */
function BudgetEnCours({ projet, budget, activites, budgetValide, acces, devise, onChange }) {
  const toast = useToast();
  const editable = acces.gerer && ['brouillon', 'rejete'].includes(budget.statut);
  const initiales = useMemo(() => Object.fromEntries(budget.lignes.map((l) => [l.activite_id, {
    montant: String(l.montant),
    postes: (l.postes || []).map((po) => ({ cle: po.cle, libelle: po.libelle, montant: String(po.montant) })),
  }])), [budget]);
  const [lignes, setLignes] = useState(initiales);
  const [commentaire, setCommentaire] = useState(budget.commentaire || '');
  const [enCours, setEnCours] = useState(false);
  const [rejet, setRejet] = useState(false);
  useEffect(() => { setLignes(initiales); setCommentaire(budget.commentaire || ''); }, [initiales, budget.commentaire]);

  const enVigueur = Object.fromEntries((budgetValide?.lignes || []).map((l) => [l.activite_id, l]));
  const affichees = activites.filter((a) => a.actif || lignes[a.id] !== undefined);
  const ligneDe = (id) => lignes[id] || { montant: '', postes: [] };
  const montantDe = (id) => {
    const l = ligneDe(id);
    return l.postes.length ? l.postes.reduce((t, po) => t + (lireMontant(po.montant) || 0), 0) : lireMontant(l.montant);
  };
  const majLigne = (id, f) => setLignes((x) => ({ ...x, [id]: f(ligneDe(id)) }));
  const total = affichees.reduce((t, a) => t + (montantDe(a.id) || 0), 0);
  const totalVigueur = budgetValide?.total || 0;
  const invalides = affichees.filter((a) => Number.isNaN(montantDe(a.id)) || montantDe(a.id) < 0
    || ligneDe(a.id).postes.some((po) => !po.libelle.trim() || Number.isNaN(lireMontant(po.montant))));
  const sousAlloue = affichees.filter((a) => (montantDe(a.id) || 0) < a.alloue);
  const modifie = JSON.stringify(lignes) !== JSON.stringify(initiales) || commentaire !== (budget.commentaire || '');
  // Justifié par ligne (budget en vigueur) : une ligne ne descend pas en dessous.
  const justifieLigne = Object.fromEntries(activites.flatMap((a) => (a.postes || []).map((po) => [po.cle, po.justifie + po.a_controler])));

  const appel = async (fn, ok) => {
    setEnCours(true);
    const r = await fn();
    setEnCours(false);
    if (r?.error) { toast(r.error, 'error', 9000); return false; }
    if (ok) toast(ok, 'success');
    onChange();
    return true;
  };
  const enregistrer = (silencieux) => appel(() => api.put(`/projets/${projet.id}/budgets/${budget.id}`, {
    commentaire,
    lignes: affichees.map((a) => {
      const l = ligneDe(a.id);
      return {
        activite_id: a.id, montant: montantDe(a.id) || 0,
        postes: l.postes.map((po) => ({ cle: po.cle || null, libelle: po.libelle.trim(), montant: lireMontant(po.montant) || 0 })),
      };
    }),
  }), silencieux ? null : 'Budget enregistré.');
  const soumettre = async () => {
    if (modifie && !(await enregistrer(true))) return;
    if (!window.confirm(`Soumettre le budget (${fcfa(total)} ${devise}) au directeur ? Il ne sera plus modifiable.`)) return;
    appel(() => api.post(`/projets/${projet.id}/budgets/${budget.id}/soumettre`), 'Budget soumis au directeur.');
  };

  const st = STATUTS_BUDGET[budget.statut];
  return (
    <div className="pj-carte">
      <div className="pj-carte-t">
        Budget version {budget.version}
        <span className={`pj-badge ${st.cls}`}>{st.lib}</span>
        <small>préparé par {budget.cree_par_nom || '—'} le {dateFr(budget.cree_le)}</small>
      </div>

      {budget.statut === 'rejete' && (
        <div className="pj-alerte rouge">
          <b>Rejeté par {budget.decide_par_nom || 'le directeur'} le {dateFr(budget.decide_le)}.</b> Motif : {budget.motif_rejet}
          {editable && <div>Corrigez les montants puis soumettez à nouveau.</div>}
        </div>
      )}
      {budget.statut === 'soumis' && (
        <div className="pj-alerte ambre">
          <b>Soumis par {budget.soumis_par_nom || '—'} le {dateFr(budget.soumis_le)} :</b> en attente de la décision du directeur.
          Les montants sont figés.
        </div>
      )}
      {editable && (
        <div className="pj-aide">
          Détaillez une activité en <b>lignes budgétaires à justifier</b> (ex. pause café, déjeuner, transport) avec « ＋ ligne » :
          son montant devient la somme de ses lignes, et chaque justificatif devra indiquer sa ligne.
        </div>
      )}

      <div className="table-wrap">
        <table className="pj-table">
          <thead>
            <tr>
              <th>Activité / ligne budgétaire</th><th>Responsable</th>
              <th className="n">Budget en vigueur</th><th className="n">Déjà remis</th>
              <th className="n">{editable ? 'Nouveau montant' : 'Montant proposé'}</th><th className="n">Écart</th>
            </tr>
          </thead>
          <tbody>
            {affichees.map((a) => {
              const l = ligneDe(a.id);
              const m = montantDe(a.id);
              const vig = enVigueur[a.id];
              const ecart = (Number.isNaN(m) ? 0 : m) - (vig?.montant || 0);
              const sous = !Number.isNaN(m) && m < a.alloue;
              const vigPoste = Object.fromEntries((vig?.postes || []).map((po) => [po.cle, po.montant]));
              return (
                <Fragment key={a.id}>
                  <tr className={`${a.actif ? '' : 'pj-inactif'} ${l.postes.length ? 'pj-act-mere' : ''}`}>
                    <td>
                      <strong>{a.nom}</strong>{!a.actif && <span className="pj-badge pj-b-ardoise">désactivée</span>}
                      {editable && (
                        <button type="button" className="pj-ajout-ligne" onClick={() => majLigne(a.id, (x) => ({ ...x, postes: [...x.postes, { cle: null, libelle: '', montant: '' }] }))}>
                          ＋ ligne
                        </button>
                      )}
                    </td>
                    <td className="pj-muted">{a.responsable_nom || '—'}</td>
                    <td className="n">{vig ? fcfa(vig.montant) : '—'}</td>
                    <td className="n" style={{ color: 'var(--projet-alloue)' }}>{fcfa(a.alloue)}</td>
                    <td className="n">
                      {editable && !l.postes.length ? (
                        <input className={`pj-in-montant${sous || Number.isNaN(m) ? ' erreur' : ''}`} inputMode="decimal" value={l.montant ?? ''}
                          onChange={(e) => majLigne(a.id, (x) => ({ ...x, montant: e.target.value }))} placeholder="0" aria-label={`Montant ${a.nom}`} />
                      ) : <b>{fcfa(m)}</b>}
                      {l.postes.length > 0 && <div className="pj-muted pj-petit">somme des lignes</div>}
                      {sous && <div className="pj-err-ligne">Inférieur au déjà remis</div>}
                    </td>
                    <td className={`n ${ecart > 0 ? 'pj-hausse' : ecart < 0 ? 'pj-baisse' : 'pj-muted'}`}>{ecart === 0 ? '—' : `${ecart > 0 ? '+' : ''}${fcfa(ecart)}`}</td>
                  </tr>
                  {l.postes.map((po, i) => {
                    const pm = lireMontant(po.montant);
                    const pris = po.cle ? (justifieLigne[po.cle] || 0) : 0;
                    const sousJ = !Number.isNaN(pm) && pm < pris;
                    const majPoste = (k, v) => majLigne(a.id, (x) => ({ ...x, postes: x.postes.map((y, j) => (j === i ? { ...y, [k]: v } : y)) }));
                    return (
                      <tr key={`${a.id}-${po.cle || i}`} className="pj-poste">
                        <td colSpan={2}>
                          <span className="pj-poste-trait">└</span>
                          {editable ? (
                            <input className="pj-in-libelle" value={po.libelle} maxLength={150} placeholder="Ligne budgétaire (ex. pause café)"
                              onChange={(e) => majPoste('libelle', e.target.value)} aria-label="Libellé de la ligne" />
                          ) : po.libelle}
                          {pris > 0 && <span className="pj-muted pj-petit"> · justifié ou déposé {fcfa(pris)}</span>}
                        </td>
                        <td className="n pj-muted">{po.cle && vigPoste[po.cle] !== undefined ? fcfa(vigPoste[po.cle]) : '—'}</td>
                        <td />
                        <td className="n">
                          {editable ? (
                            <input className={`pj-in-montant pj-in-poste${sousJ || Number.isNaN(pm) ? ' erreur' : ''}`} inputMode="decimal" value={po.montant}
                              onChange={(e) => majPoste('montant', e.target.value)} placeholder="0" aria-label={`Montant ${po.libelle}`} />
                          ) : fcfa(pm)}
                          {sousJ && <div className="pj-err-ligne">Inférieur au justifié</div>}
                        </td>
                        <td className="n">
                          {editable && pris === 0 && (
                            <button type="button" className="pj-suppr-ligne" title="Retirer la ligne"
                              onClick={() => majLigne(a.id, (x) => ({ ...x, postes: x.postes.filter((_, j) => j !== i) }))}>✕</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
            {affichees.length === 0 && (
              <tr><td colSpan={6} className="pj-muted" style={{ textAlign: 'center', padding: 20 }}>Ajoutez d'abord les activités du projet.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>Total</td>
              <td className="n">{budgetValide ? fcfa(totalVigueur) : '—'}</td>
              <td className="n">{fcfa(activites.reduce((t, a) => t + a.alloue, 0))}</td>
              <td className="n" style={{ color: 'var(--projet-budget)' }}>{fcfa(total)} {devise}</td>
              <td className="n">{budgetValide ? `${total - totalVigueur >= 0 ? '+' : ''}${fcfa(total - totalVigueur)}` : ''}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="pj-budget-pied">
        {editable ? (
          <textarea rows={2} maxLength={2000} value={commentaire} onChange={(e) => setCommentaire(e.target.value)} placeholder="Commentaire pour le directeur (facultatif)" />
        ) : budget.commentaire ? <div className="pj-commentaire">« {budget.commentaire} »</div> : <span />}
        <div className="pj-actions">
          {editable && budget.statut === 'brouillon' && (
            <button type="button" className="btn-ghost" disabled={enCours}
              onClick={() => window.confirm('Supprimer ce budget en préparation ?') && appel(() => api.delete(`/projets/${projet.id}/budgets/${budget.id}`), 'Budget supprimé.')}>
              Supprimer
            </button>
          )}
          {editable && <button type="button" className="btn-ghost" disabled={enCours || !modifie || invalides.length > 0} onClick={() => enregistrer(false)}>💾 Enregistrer</button>}
          {editable && (
            <button type="button" className="btn-primary btn-auto" disabled={enCours || invalides.length > 0 || sousAlloue.length > 0 || total <= 0} onClick={soumettre}>
              Soumettre au directeur ›
            </button>
          )}
          {budget.statut === 'soumis' && acces.gerer && (
            <button type="button" className="btn-ghost" disabled={enCours} onClick={() => appel(() => api.post(`/projets/${projet.id}/budgets/${budget.id}/retirer`), 'Budget repris : il est de nouveau modifiable.')}>
              Reprendre
            </button>
          )}
          {budget.statut === 'soumis' && acces.valider && (
            <>
              <button type="button" className="btn-ghost pj-btn-rouge-c" disabled={enCours} onClick={() => setRejet(true)}>Rejeter…</button>
              <button type="button" className="btn-primary btn-auto pj-btn-vert" disabled={enCours}
                onClick={() => window.confirm(`Valider le budget de ${fcfa(total)} ${devise} ? Il deviendra le budget en vigueur et ouvrira les remises de fonds.`)
                  && appel(() => api.post(`/projets/${projet.id}/budgets/${budget.id}/valider`), 'Budget validé.')}>
                ✓ Valider le budget
              </button>
            </>
          )}
        </div>
      </div>
      {rejet && (
        <RejetModal onFermer={() => setRejet(false)}
          onConfirmer={async (motif) => { if (await appel(() => api.post(`/projets/${projet.id}/budgets/${budget.id}/rejeter`, { motif }), 'Budget rejeté : le chef de projet est prévenu.')) setRejet(false); }} />
      )}
    </div>
  );
}

function OngletBudget({ d, devise, onChange }) {
  const toast = useToast();
  const [ouvert, setOuvert] = useState(null);
  const { projet, acces, activites, budgets } = d;
  const budgetValide = budgets.find((b) => b.statut === 'valide');
  const enCours = budgets.find((b) => ['brouillon', 'soumis'].includes(b.statut))
    || (budgets[0]?.statut === 'rejete' ? budgets[0] : null);
  const nomActivite = Object.fromEntries(activites.map((a) => [a.id, a.nom]));
  const preparer = async () => {
    const r = await api.post(`/projets/${projet.id}/budgets`);
    if (r.error) { toast(r.error, 'error', 8000); return; }
    toast(budgetValide ? 'Révision préparée à partir du budget en vigueur.' : 'Budget en préparation.', 'success');
    onChange();
  };
  return (
    <div className="pj-onglet">
      {enCours ? (
        <BudgetEnCours key={`${enCours.id}-${enCours.statut}`} projet={projet} budget={enCours} activites={activites}
          budgetValide={budgetValide} acces={acces} devise={devise} onChange={onChange} />
      ) : (
        <div className="pj-carte pj-appel">
          <div>
            <strong>{budgetValide ? `Budget en vigueur : version ${budgetValide.version} — ${fcfa(budgetValide.total)} ${devise}` : 'Aucun budget validé'}</strong>
            <div className="pj-muted">
              {budgetValide
                ? `Validé par ${budgetValide.decide_par_nom || '—'} le ${dateFr(budgetValide.decide_le)}. Une révision repart de ces montants et ne peut pas descendre sous les fonds déjà remis.`
                : 'Tant que le directeur n\'a pas validé un budget, aucune remise de fonds aux activités n\'est possible.'}
            </div>
          </div>
          {acces.gerer && (
            <button type="button" className="btn-primary btn-auto" onClick={preparer} disabled={activites.length === 0}
              title={activites.length === 0 ? 'Ajoutez d\'abord les activités' : undefined}>
              {budgetValide ? '✎ Préparer une révision' : '＋ Préparer le budget'}
            </button>
          )}
        </div>
      )}

      <div className="pj-carte">
        <div className="pj-carte-t">Historique des budgets <small>chaque version reste archivée</small></div>
        {budgets.length === 0 ? <div className="pj-vide-mini">Aucun budget pour l'instant.</div> : (
          <div className="pj-histo">
            {budgets.map((b) => {
              const st = STATUTS_BUDGET[b.statut];
              return (
                <div key={b.id} className="pj-histo-l">
                  <button type="button" className="pj-histo-tete" onClick={() => setOuvert(ouvert === b.id ? null : b.id)} aria-expanded={ouvert === b.id}>
                    <span className="pj-histo-v">v{b.version}</span>
                    <span className={`pj-badge ${st.cls}`}>{st.lib}</span>
                    <span className="pj-montant">{fcfa(b.total)} {devise}</span>
                    <span className="pj-muted">
                      {b.decide_le ? `${b.statut === 'rejete' ? 'rejeté' : 'décidé'} par ${b.decide_par_nom || '—'} le ${dateFr(b.decide_le)}`
                        : b.soumis_le ? `soumis le ${dateFr(b.soumis_le)}` : `préparé le ${dateFr(b.cree_le)}`}
                    </span>
                    <span className="pj-chevron">{ouvert === b.id ? '▾' : '›'}</span>
                  </button>
                  {ouvert === b.id && (
                    <div className="pj-histo-detail">
                      {b.motif_rejet && <div className="pj-alerte rouge">Motif du rejet : {b.motif_rejet}</div>}
                      {b.commentaire && <div className="pj-commentaire">« {b.commentaire} »</div>}
                      {b.lignes.map((l) => (
                        <Fragment key={l.activite_id}>
                          <div className="pj-kv"><span>{nomActivite[l.activite_id] || `Activité ${l.activite_id}`}</span><b>{fcfa(l.montant)}</b></div>
                          {(l.postes || []).map((po) => (
                            <div key={po.cle} className="pj-kv pj-kv-poste"><span>└ {po.libelle}</span><span>{fcfa(po.montant)}</span></div>
                          ))}
                        </Fragment>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProjetPage() {
  const toast = useToast();
  const { id } = useParams();
  const { devise } = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const onglet = params.get('onglet') || 'activites';
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState('');
  const [modale, setModale] = useState(null);

  const charger = useCallback(async () => {
    const r = await api.get(`/projets/${id}`);
    if (r.error) { setErreur(r.error); return; }
    setErreur('');
    setD(r);
  }, [id]);
  useEffect(() => { charger(); }, [charger]);

  const supprimerProjet = async () => {
    if (!window.confirm(`Supprimer définitivement le projet « ${d.projet.nom} », ses activités et ses budgets ?\n\nPossible seulement si aucun financement, aucune remise de fonds et aucun justificatif ne le concerne. Sinon, clôturez-le.`)) return;
    const r = await api.delete(`/projets/${d.projet.id}`);
    if (r.error) { toast(r.error, 'error', 12000); return; }
    toast(r.message || 'Projet supprimé.', 'success');
    navigate('/projets');
  };

  if (erreur) {
    return (
      <div className="page-content pj-page">
        <div className="pj-vide"><div className="pj-vide-ic">🔍</div><h3>{erreur}</h3>
          <button type="button" className="btn-ghost" onClick={() => navigate('/projets')}>‹ Retour aux projets</button></div>
      </div>
    );
  }
  if (!d) return <div className="page-content pj-page"><div className="loading-msg">Chargement du projet…</div></div>;

  const { projet, acces, chiffres, activites, financements, remises, budgets } = d;
  const budgetValide = budgets.find((b) => b.statut === 'valide');
  const budgetSoumis = budgets.find((b) => b.statut === 'soumis');
  const statut = !projet.actif ? { lib: 'Clôturé', cls: 'pj-b-ardoise' }
    : budgetSoumis ? { lib: 'Budget à valider', cls: 'pj-b-ambre' }
      : budgetValide ? { lib: `Budget v${budgetValide.version} validé`, cls: 'pj-b-vert' } : { lib: 'Sans budget validé', cls: 'pj-b-gris' };
  const onglets = [
    ['activites', `Activités (${activites.length})`],
    ['budget', 'Budget'],
    ...(acces.voir_tout ? [['financements', `Financements reçus (${financements.length})`]] : []),
    ['remises', `Fonds remis (${remises.length})`],
    ['justificatifs', 'Justificatifs'],
  ];
  const base = Math.max(chiffres.budget_valide, chiffres.recu || 0, chiffres.alloue, 1);

  return (
    <div className="page-content pj-page">
      <Link to="/projets" className="pj-retour">‹ Projets</Link>
      <div className="pj-tete">
        <div>
          <h2>{projet.code && <span className="pj-code">{projet.code}</span>}{projet.nom} <span className={`pj-badge ${statut.cls}`}>{statut.lib}</span></h2>
          <p>
            Chef de projet : <b>{projet.chef_nom || 'à désigner'}</b>
            {projet.date_debut && <> · du {dateFr(projet.date_debut)} au {dateFr(projet.date_fin) || '…'}</>}
            {projet.description && <> · {projet.description}</>}
          </p>
        </div>
        <div className="pj-tete-actions">
          {acces.chef && <span className="pj-badge pj-b-bleu">Vous êtes chef de ce projet</span>}
          {acces.modifier_projet && (
            <button type="button" className="btn-ghost" onClick={() => setModale({ type: 'projet' })}>✎ Modifier le projet</button>
          )}
          {acces.modifier_projet && (
            <button type="button" className="btn-ghost pj-btn-rouge-c" onClick={supprimerProjet} title="Possible tant qu'aucun argent n'a touché le projet">🗑 Supprimer</button>
          )}
        </div>
      </div>

      <div className="pj-cascade">
        {[
          ['Budget validé', chiffres.budget_valide, 'var(--projet-budget)', budgetValide ? `version ${budgetValide.version}` : 'aucun'],
          ...(chiffres.recu !== null ? [['Financement reçu', chiffres.recu, 'var(--projet-recu)', `${pct(chiffres.recu, chiffres.budget_valide)} % du budget`]] : []),
          ['Alloué aux responsables', chiffres.alloue, 'var(--projet-alloue)', `${pct(chiffres.alloue, chiffres.budget_valide)} % du budget`],
          ['Justifié', chiffres.justifie, 'var(--projet-justifie)', `${pct(chiffres.justifie, chiffres.alloue)} % du remis`],
          ['En attente de justification', chiffres.en_attente, 'var(--projet-attente)', 'remis − justifié − remboursé'],
          ...(chiffres.disponible !== null ? [['Disponible (reçu − alloué)', chiffres.disponible, '#0f766e', 'solde comptable du projet']] : []),
          ...(chiffres.reste_a_recevoir !== null ? [['Reste à recevoir', chiffres.reste_a_recevoir, '#64748b', 'budget non encore financé']] : []),
        ].map(([lib, val, coul, sous]) => (
          <div key={lib} className="pj-cascade-c">
            <div className="pj-kpi-t">{lib}</div>
            <div className="pj-cascade-v" style={{ color: coul }}>{fcfa(val)} <small>{devise}</small></div>
            <div className="pj-cascade-b"><span style={{ width: `${Math.max(0, (val / base) * 100)}%`, background: coul }} /></div>
            <div className="pj-kpi-s">{sous}</div>
          </div>
        ))}
      </div>
      {chiffres.disponible !== null && (
        <div className="field-hint pj-note">Les fonds du projet sont sur un journal (banque, caisse) partagé avec les autres opérations : le disponible est un solde comptable du projet, pas la trésorerie du journal.</div>
      )}

      <div className="pj-onglets" role="tablist">
        {onglets.map(([k, lib]) => (
          <button type="button" key={k} role="tab" aria-selected={onglet === k} className={`pj-onglet-b${onglet === k ? ' on' : ''}`}
            onClick={() => setParams(k === 'activites' ? {} : { onglet: k })}>
            {lib}{k === 'budget' && budgetSoumis && <span className="pj-pastille">1</span>}
          </button>
        ))}
      </div>

      {onglet === 'activites' && (
        <>
          {d.remise_globale && d.remise_globale.alloue > 0 && (
            <div className="pj-carte pj-globale">
              <div className="pj-globale-t">◆ Remise globale au projet <small>fonds remis sans activité précise, justifiés activité par activité</small></div>
              <div className="pj-globale-c">
                <span>Remis <b style={{ color: 'var(--projet-alloue)' }}>{fcfa(d.remise_globale.alloue)}</b></span>
                <span>Justifié via les activités <b style={{ color: 'var(--projet-justifie)' }}>{fcfa(d.remise_globale.justifie)}</b></span>
                {d.remise_globale.rembourse > 0 && <span>Remboursé <b>{fcfa(d.remise_globale.rembourse)}</b></span>}
                <span>Reste à justifier <b style={{ color: 'var(--projet-attente)' }}>{fcfa(d.remise_globale.en_attente)}</b></span>
              </div>
            </div>
          )}
          <div className="pj-carte">
            <div className="pj-carte-t">
              Activités et responsables
              {d.budget_reste_a_allouer !== null && <small>reste à allouer sur le budget : {fcfa(d.budget_reste_a_allouer)} {devise}</small>}
              {acces.gerer && <button type="button" className="btn-primary btn-auto pj-ml" onClick={() => setModale({ type: 'activite' })}>＋ Activité</button>}
            </div>
            {activites.length === 0 ? (
              <div className="pj-vide-mini">{acces.gerer ? 'Ajoutez les activités du projet, puis préparez le budget.' : 'Aucune activité.'}</div>
            ) : (
              <div className="table-wrap">
                <table className="pj-table">
                  <thead>
                    <tr>
                      <th>Activité / ligne</th><th>Responsable</th>
                      <th className="n" title="Budget validé par le directeur">Budget</th>
                      <th className="n" title="Fonds remis au responsable par le journal">Remis</th>
                      <th className="n" title="Dépenses justifiées par des pièces validées">Utilisé</th>
                      <th style={{ width: 170 }}>Utilisation</th>
                      <th className="n" title="Remis − utilisé − remboursé">Reste à justifier</th>
                      <th>Justification</th>{acces.gerer && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {activites.map((a) => {
                      const base = a.budget || 0;
                      const wJ = base ? Math.min(100, (a.justifie / base) * 100) : 0;
                      const wR = base ? Math.min(100 - wJ, (Math.max(a.alloue - a.justifie, 0) / base) * 100) : 0;
                      const st = STATUT_ACT[a.statut_justification] || STATUT_ACT.non_financee;
                      return (
                        <Fragment key={a.id}>
                          <tr className={a.actif ? '' : 'pj-inactif'}>
                            <td><strong>{a.code && <span className="pj-code">{a.code}</span>}{a.nom}</strong>{!a.actif && <span className="pj-badge pj-b-ardoise">désactivée</span>}</td>
                            <td>{a.responsable_nom || <span className="pj-muted">à désigner</span>}</td>
                            <td className="n">{a.budget === null ? <span className="pj-muted">—</span> : fcfa(a.budget)}</td>
                            <td className="n" style={{ color: 'var(--projet-alloue)' }}>{fcfa(a.alloue)}</td>
                            <td className="n" style={{ color: 'var(--projet-justifie)' }}><b>{fcfa(a.justifie)}</b>
                              {a.a_controler > 0 && <div className="pj-muted pj-petit">+ {fcfa(a.a_controler)} à contrôler</div>}</td>
                            <td>
                              <div className="pj-jauge pj-jauge-2" title={`Utilisé ${fcfa(a.justifie)} · remis non justifié ${fcfa(Math.max(a.alloue - a.justifie, 0))} · budget ${fcfa(a.budget)}`}>
                                <span style={{ width: `${wJ}%`, background: 'var(--projet-justifie)' }} />
                                <span style={{ width: `${wR}%`, background: 'var(--projet-alloue)', opacity: 0.45 }} />
                              </div>
                              <div className="pj-muted pj-petit">
                                {a.taux_utilisation !== null ? `${a.taux_utilisation} % du remis utilisé` : a.justifie > 0 ? 'sur la remise globale' : 'rien remis'}
                                {a.budget ? ` · ${pct(a.justifie, a.budget)} % du budget` : ''}
                              </div>
                            </td>
                            <td className="n">{a.en_attente > 0 ? <b style={{ color: 'var(--projet-attente)' }}>{fcfa(a.en_attente)}</b> : <span className="pj-muted">0</span>}
                              {a.rembourse > 0 && <div className="pj-muted pj-petit">remboursé {fcfa(a.rembourse)}</div>}</td>
                            <td>
                              <button type="button" className={`pj-badge ${st.cls} pj-badge-btn`} style={{ marginLeft: 0 }}
                                onClick={() => setParams({ onglet: 'justificatifs', activite: String(a.id) })} title="Voir les justificatifs">
                                {st.lib}
                              </button>
                            </td>
                            {acces.gerer && <td><button type="button" className="btn-icon" title="Modifier" onClick={() => setModale({ type: 'activite', activite: a })}>✏️</button></td>}
                          </tr>
                          {(a.postes || []).map((po) => (
                            <tr key={po.cle} className="pj-poste">
                              <td colSpan={2}><span className="pj-poste-trait">└</span>{po.libelle}</td>
                              <td className="n pj-muted">{fcfa(po.budget)}</td>
                              <td />
                              <td className="n" style={{ color: 'var(--projet-justifie)' }}>{fcfa(po.justifie)}
                                {po.a_controler > 0 && <div className="pj-muted pj-petit">+ {fcfa(po.a_controler)} à contrôler</div>}</td>
                              <td>
                                <div className="pj-jauge"><span className={po.justifie + po.a_controler >= po.budget && po.budget > 0 ? 'plein' : ''}
                                  style={{ width: `${po.budget ? Math.min(100, ((po.justifie + po.a_controler) / po.budget) * 100) : 0}%`, background: 'var(--projet-justifie)' }} /></div>
                              </td>
                              <td className="n pj-muted pj-petit" colSpan={acces.gerer ? 3 : 2}>reste sur la ligne {fcfa(po.reste)}</td>
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="pj-legende">
              <span><i style={{ background: 'var(--projet-justifie)' }} />Utilisé (justifié, pièces validées)</span>
              <span><i style={{ background: 'var(--projet-alloue)', opacity: 0.45 }} />Remis, pas encore justifié</span>
              <span><i style={{ background: '#f1f5f9', border: '1px solid #e2e8f0' }} />Budget non encore remis</span>
            </div>
          </div>
        </>
      )}

      {onglet === 'budget' && <OngletBudget d={d} devise={devise} onChange={charger} />}

      {onglet === 'justificatifs' && <OngletJustificatifs key={params.get('activite') || 'tout'} d={d} activiteFiltre={params.get('activite') || ''} onChange={charger} />}

      {onglet === 'financements' && acces.voir_tout && (
        <div className="pj-carte">
          <div className="pj-carte-t">Financements reçus <small>entrées des journaux imputées à ce projet — saisies une seule fois, dans le journal</small></div>
          {financements.length === 0 ? (
            <div className="pj-vide-mini">Aucun financement reçu. Il s'enregistre dans le journal (banque, caisse), sur une rubrique de financement, en choisissant ce projet.</div>
          ) : (
            <div className="table-wrap">
              <table className="pj-table pj-cliquable">
                <thead><tr><th>Date</th><th>Journal · pièce</th><th>Rubrique</th><th>Compte</th><th>Bailleur</th><th>Référence</th><th className="n">Montant</th><th>Saisi par</th></tr></thead>
                <tbody>
                  {financements.map((f) => (
                    <tr key={f.id} className={f.annule ? 'pj-annule' : ''} onClick={() => setModale({ type: 'ecriture', ecriture: f, sens: 'entree' })}>
                      <td>{dateFr(f.date)}</td>
                      <td><span className="pj-code">{f.journal_code}</span> n° {f.numero}</td>
                      <td>{f.rubrique_code} <span className="pj-muted">{libelleNature(f.nature_recette)}</span></td>
                      <td className="pj-mono">{f.compte || '—'}</td>
                      <td>{f.beneficiaire || '—'}</td>
                      <td>{f.reference_financement || '—'}</td>
                      <td className="n" style={{ color: 'var(--projet-recu)' }}><b>{fcfa(f.entree)}</b>{f.annule && <span className="pj-badge pj-b-rouge">Annulée</span>}</td>
                      <td className="pj-muted">{f.saisi_par}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {onglet === 'remises' && (
        <div className="pj-carte">
          <div className="pj-carte-t">Fonds remis aux responsables <small>sorties des journaux rattachées aux activités</small></div>
          {remises.length === 0 ? (
            <div className="pj-vide-mini">Aucune remise de fonds. Elle s'enregistre dans le journal, en sortie, en choisissant l'activité du projet.</div>
          ) : (
            <div className="table-wrap">
              <table className="pj-table pj-cliquable">
                <thead><tr><th>Date</th><th>Journal · pièce</th><th>Activité</th><th>Bénéficiaire</th><th>Rubrique</th><th className="n">Montant</th><th>Saisi par</th></tr></thead>
                <tbody>
                  {remises.map((r) => (
                    <tr key={r.id} className={r.annule ? 'pj-annule' : ''} onClick={() => setModale({ type: 'ecriture', ecriture: r, sens: 'sortie' })}>
                      <td>{dateFr(r.date)}</td>
                      <td><span className="pj-code">{r.journal_code}</span> n° {r.numero}</td>
                      <td><strong>{r.activite_nom}</strong></td>
                      <td>{r.beneficiaire || '—'}</td>
                      <td>{r.rubrique_code}</td>
                      <td className="n" style={{ color: 'var(--projet-alloue)' }}><b>{fcfa(r.sortie)}</b>{r.annule && <span className="pj-badge pj-b-rouge">Annulée</span>}</td>
                      <td className="pj-muted">{r.saisi_par}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {modale?.type === 'projet' && (
        <ProjetModal projet={projet} onFermer={() => setModale(null)} onEnregistre={() => { setModale(null); charger(); }} />
      )}
      {modale?.type === 'activite' && (
        <ActiviteModal projetId={projet.id} activite={modale.activite} onFermer={() => setModale(null)} onEnregistre={() => { setModale(null); charger(); }} />
      )}
      {modale?.type === 'ecriture' && (
        <EcritureModal ecriture={modale.ecriture} type={modale.sens} devise={devise} onFermer={() => setModale(null)} />
      )}
    </div>
  );
}
