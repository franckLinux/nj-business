import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { STATUTS_BUDGET, libelleNature } from '@/lib/projets';
import { Modale, ProjetModal, dateFr, fcfa, pct } from './ProjetsPage';

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

/** Budget en préparation (brouillon / rejeté) ou soumis, et ses actions. */
function BudgetEnCours({ projet, budget, activites, budgetValide, acces, devise, onChange }) {
  const toast = useToast();
  const editable = acces.gerer && ['brouillon', 'rejete'].includes(budget.statut);
  const initiales = useMemo(() => Object.fromEntries(budget.lignes.map((l) => [l.activite_id, String(l.montant)])), [budget]);
  const [montants, setMontants] = useState(initiales);
  const [commentaire, setCommentaire] = useState(budget.commentaire || '');
  const [enCours, setEnCours] = useState(false);
  const [rejet, setRejet] = useState(false);
  useEffect(() => { setMontants(initiales); setCommentaire(budget.commentaire || ''); }, [initiales, budget.commentaire]);

  const enVigueur = Object.fromEntries((budgetValide?.lignes || []).map((l) => [l.activite_id, l.montant]));
  const lignesAffichees = activites.filter((a) => a.actif || montants[a.id] !== undefined);
  const total = lignesAffichees.reduce((s, a) => s + (lireMontant(montants[a.id]) || 0), 0);
  const totalVigueur = budgetValide?.total || 0;
  const invalides = lignesAffichees.filter((a) => Number.isNaN(lireMontant(montants[a.id])) || lireMontant(montants[a.id]) < 0);
  const sousAlloue = lignesAffichees.filter((a) => (lireMontant(montants[a.id]) || 0) < a.alloue);
  const modifie = JSON.stringify(montants) !== JSON.stringify(initiales) || commentaire !== (budget.commentaire || '');

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
    lignes: lignesAffichees.map((a) => ({ activite_id: a.id, montant: lireMontant(montants[a.id]) || 0 })),
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

      <div className="table-wrap">
        <table className="pj-table">
          <thead>
            <tr>
              <th>Activité</th><th>Responsable</th>
              <th className="n">Budget en vigueur</th><th className="n">Déjà remis</th>
              <th className="n">{editable ? 'Nouveau montant' : 'Montant proposé'}</th><th className="n">Écart</th>
            </tr>
          </thead>
          <tbody>
            {lignesAffichees.map((a) => {
              const m = lireMontant(montants[a.id]);
              const ecart = (Number.isNaN(m) ? 0 : m) - (enVigueur[a.id] || 0);
              const sous = !Number.isNaN(m) && m < a.alloue;
              return (
                <tr key={a.id} className={a.actif ? '' : 'pj-inactif'}>
                  <td><strong>{a.nom}</strong>{!a.actif && <span className="pj-badge pj-b-ardoise">désactivée</span>}</td>
                  <td className="pj-muted">{a.responsable_nom || '—'}</td>
                  <td className="n">{enVigueur[a.id] !== undefined ? fcfa(enVigueur[a.id]) : '—'}</td>
                  <td className="n" style={{ color: 'var(--projet-alloue)' }}>{fcfa(a.alloue)}</td>
                  <td className="n">
                    {editable ? (
                      <input className={`pj-in-montant${sous || Number.isNaN(m) ? ' erreur' : ''}`} inputMode="decimal" value={montants[a.id] ?? ''}
                        onChange={(e) => setMontants({ ...montants, [a.id]: e.target.value })} placeholder="0" aria-label={`Montant ${a.nom}`} />
                    ) : <b>{fcfa(m)}</b>}
                    {sous && <div className="pj-err-ligne">Inférieur au déjà remis</div>}
                  </td>
                  <td className={`n ${ecart > 0 ? 'pj-hausse' : ecart < 0 ? 'pj-baisse' : 'pj-muted'}`}>{ecart === 0 ? '—' : `${ecart > 0 ? '+' : ''}${fcfa(ecart)}`}</td>
                </tr>
              );
            })}
            {lignesAffichees.length === 0 && (
              <tr><td colSpan={6} className="pj-muted" style={{ textAlign: 'center', padding: 20 }}>Ajoutez d'abord les activités du projet.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>Total</td>
              <td className="n">{budgetValide ? fcfa(totalVigueur) : '—'}</td>
              <td className="n">{fcfa(activites.reduce((s, a) => s + a.alloue, 0))}</td>
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
                        <div key={l.activite_id} className="pj-kv"><span>{nomActivite[l.activite_id] || `Activité ${l.activite_id}`}</span><b>{fcfa(l.montant)}</b></div>
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
        </div>
      </div>

      <div className="pj-cascade">
        {[
          ['Budget validé', chiffres.budget_valide, 'var(--projet-budget)', budgetValide ? `version ${budgetValide.version}` : 'aucun'],
          ...(chiffres.recu !== null ? [['Financement reçu', chiffres.recu, 'var(--projet-recu)', `${pct(chiffres.recu, chiffres.budget_valide)} % du budget`]] : []),
          ['Alloué aux responsables', chiffres.alloue, 'var(--projet-alloue)', `${pct(chiffres.alloue, chiffres.budget_valide)} % du budget`],
          ...(chiffres.disponible !== null ? [['Disponible (reçu − alloué)', chiffres.disponible, 'var(--projet-justifie)', 'solde comptable du projet']] : []),
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
        <div className="pj-carte">
          <div className="pj-carte-t">
            Activités et responsables
            {acces.gerer && <button type="button" className="btn-primary btn-auto pj-ml" onClick={() => setModale({ type: 'activite' })}>＋ Activité</button>}
          </div>
          {activites.length === 0 ? (
            <div className="pj-vide-mini">{acces.gerer ? 'Ajoutez les activités du projet, puis préparez le budget.' : 'Aucune activité.'}</div>
          ) : (
            <div className="table-wrap">
              <table className="pj-table">
                <thead><tr><th>Activité</th><th>Responsable</th><th className="n">Budget validé</th><th className="n">Alloué</th><th className="n">Reste</th><th style={{ width: 160 }}>Consommation</th>{acces.gerer && <th />}</tr></thead>
                <tbody>
                  {activites.map((a) => {
                    const taux = a.budget ? pct(a.alloue, a.budget) : 0;
                    return (
                      <tr key={a.id} className={a.actif ? '' : 'pj-inactif'}>
                        <td><strong>{a.code && <span className="pj-code">{a.code}</span>}{a.nom}</strong>{!a.actif && <span className="pj-badge pj-b-ardoise">désactivée</span>}</td>
                        <td>{a.responsable_nom || <span className="pj-muted">à désigner</span>}</td>
                        <td className="n">{a.budget === null ? <span className="pj-muted">—</span> : fcfa(a.budget)}</td>
                        <td className="n" style={{ color: 'var(--projet-alloue)' }}>{fcfa(a.alloue)}</td>
                        <td className="n"><b>{a.reste === null ? '—' : fcfa(a.reste)}</b></td>
                        <td>
                          <div className="pj-jauge"><span className={taux >= 100 ? 'plein' : taux >= 80 ? 'haut' : ''} style={{ width: `${taux}%` }} /></div>
                          <div className="pj-muted pj-petit">{a.budget ? `${taux} %` : 'pas de budget validé'} · {a.nb_remises} remise(s)</div>
                        </td>
                        {acces.gerer && <td><button type="button" className="btn-icon" title="Modifier" onClick={() => setModale({ type: 'activite', activite: a })}>✏️</button></td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {onglet === 'budget' && <OngletBudget d={d} devise={devise} onChange={charger} />}

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
