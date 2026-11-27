// NJ FINANCE — Missions (migration 087), PME et ONG.
//   • Ordre de mission : missionnaire, objet, destination, dates, frais prévus en
//     saisie libre (quantité × jours × prix) ; approuvé par le directeur.
//   • Avance facultative versée par la caisse (compte 42x avance au personnel).
//   • Justification : dépenses réelles avec pièces et rapport, contrôlée par le
//     directeur ou le comptable (jamais par celui qui l'a présentée).
//   • Régularisation : reliquat reversé ou complément payé ; clôture et écriture
//     D charges / C 42x.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { Tiroir, Champ } from '@/components/commercial/ui';
import { ouvrirFichier, lireFichier } from '@/components/commercial/achats';
import { Erreur, fmtCompta, fmtDate, aujourdhui } from '@/pages/comptabilite/commun';

const m = (v) => fmtCompta(v, { zero: '0' });
const TONS = { brouillon: 'gris', soumise: 'orange', approuvee: 'bleu', a_controler: 'orange', justifiee: 'orange', cloturee: 'vert', rejetee: 'rouge-plein', annulee: 'gris' };
const Etat = ({ x }) => <span className={`fin-pastille fin-pastille-${TONS[x.statut] || 'gris'}`}>{x.statut_libelle}</span>;
const NATURES = { transport: 'Transport', hebergement: 'Hébergement', restauration: 'Restauration', perdiem: 'Per diem', autre: 'Autres frais' };
const nb = (v) => Number(String(v ?? '').replace(/[\s  ]/g, '').replace(',', '.')) || 0;
const useContexte = () => {
  const [ctx, setCtx] = useState(null);
  const [erreur, setErreur] = useState('');
  useEffect(() => { api.get('/finance/missions/contexte').then((r) => (r?.error ? setErreur(r.error) : setCtx(r))); }, []);
  return { ctx, erreur };
};
const imprimerOrdre = (x, toast) => ouvrirFichier(api, `/finance/missions/${x.id}/pdf`, `ordre-de-mission-${x.numero}.pdf`, 'application/pdf', toast);

// ── Liste ───────────────────────────────────────────────────────────────────
const VUES = [['', 'Toutes'], ['a_approuver', 'À approuver'], ['avance_a_verser', 'Avance à verser'], ['en_cours', 'En cours'],
  ['a_controler', 'Justifications à contrôler'], ['a_regulariser', 'À régulariser'], ['cloturees', 'Clôturées']];
export function MissionsPage() {
  const [params, setParams] = useSearchParams();
  const { ctx, erreur: errCtx } = useContexte();
  const vue = params.get('vue') ?? '';
  const [q, setQ] = useState('');
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState('');
  const [parametres, setParametres] = useState(false);
  useEffect(() => {
    setD(null);
    api.get(`/finance/missions${vue ? `?vue=${vue}` : ''}`).then((r) => (r?.error ? setErreur(r.error) : setD(r)));
  }, [vue]);
  const liste = useMemo(() => (d?.missions || []).filter((x) => !q.trim()
    || [x.numero, x.missionnaire_nom, x.objet, x.destination].some((s) => String(s || '').toLowerCase().includes(q.trim().toLowerCase()))), [d, q]);
  return (
    <div className="cm-page fin-page">
      <div className="cm-entete">
        <div>
          <h2>Missions</h2>
          <p>L'ordre de mission est approuvé par le directeur. L'avance est facultative ; au retour, le missionnaire présente ses
            dépenses avec les pièces et son rapport, puis la caisse régularise (reliquat ou complément).</p>
        </div>
        <div className="fin-actions">
          {(ctx?.droits.directeur || ctx?.droits.comptable) && <button type="button" className="cm-btn cm-secondaire" onClick={() => setParametres(true)}>⚙ Comptes</button>}
          {ctx?.droits.demander && <Link className="cm-btn cm-primaire" to="/finance/missions/nouvelle">+ Nouvel ordre de mission</Link>}
        </div>
      </div>
      <Erreur message={errCtx || erreur} />
      <div className="fin-onglets" role="tablist">
        {VUES.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={vue === k} className={vue === k ? 'actif' : ''} onClick={() => setParams(k ? { vue: k } : {})}>
            {l}{k && d?.compteurs?.[k] ? ` (${d.compteurs[k]})` : ''}
          </button>
        ))}
      </div>
      <div className="fin-filtres"><input type="search" className="fin-recherche" placeholder="Rechercher : n°, missionnaire, objet, destination" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher" /></div>
      {!d && !erreur && <div className="loading-msg">Chargement…</div>}
      {d && (liste.length === 0 ? (
        <div className="fin-vide"><div className="fin-vide-icone" aria-hidden="true">🧳</div><h3>Aucune mission</h3>
          <p>{ctx?.droits.demander ? 'Établissez un ordre de mission : il part chez le directeur pour approbation.' : 'Rien dans cette vue.'}</p></div>
      ) : (
        <div className="cm-table-wrap">
          <table className="cm-table fin-table">
            <thead><tr><th>N°</th><th>Missionnaire</th><th>Objet et destination</th><th>Dates</th><th className="fin-num">Frais prévus</th>
              <th className="fin-num">Avance nette</th><th className="fin-num">Dépenses</th><th>État</th></tr></thead>
            <tbody>
              {liste.map((x) => (
                <tr key={x.id}>
                  <td className="fin-mono"><Link to={`/finance/missions/${x.id}`}>{x.numero || 'Brouillon'}</Link></td>
                  <td><b>{x.missionnaire_nom}</b>{x.fonction && <div className="cm-sous">{x.fonction}</div>}</td>
                  <td>{x.objet}<div className="cm-sous">{x.destination}{x.activite ? ` · ${x.activite}` : ''}</div></td>
                  <td>{fmtDate(x.date_depart)}<div className="cm-sous">au {fmtDate(x.date_retour)} · {x.jours} j</div></td>
                  <td className="fin-num">{m(x.prevu)}</td>
                  <td className="fin-num">{x.avance_nette ? m(x.avance_nette) : '—'}</td>
                  <td className="fin-num">{x.depenses ? m(x.depenses) : '—'}</td>
                  <td><Etat x={x} />{x.reliquat > 0 && <div className="cm-sous">reliquat {m(x.reliquat)}</div>}
                    {x.complement > 0 && <div className="cm-sous">complément {m(x.complement)}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {parametres && <ParametresTiroir onFermer={() => setParametres(false)} />}
    </div>
  );
}

function ParametresTiroir({ onFermer }) {
  const toast = useToast();
  const [v, setV] = useState(null);
  const [erreur, setErreur] = useState('');
  useEffect(() => { api.get('/finance/missions/parametres').then((r) => (r?.error ? setErreur(r.error) : setV(r))); }, []);
  const valider = async () => {
    const r = await api.put('/finance/missions/parametres', v);
    if (r?.error) { setErreur(r.error); return; }
    toast('Comptes des missions enregistrés.', 'success'); onFermer();
  };
  return (
    <Tiroir titre="Comptes des missions" onFermer={onFermer} pied={<>
      <button type="button" className="cm-btn cm-secondaire" onClick={onFermer}>Fermer</button>
      <button type="button" className="cm-btn cm-primaire" disabled={!v} onClick={valider}>Enregistrer</button>
    </>}>
      <Erreur message={erreur} />
      {v && (<>
        <p className="cm-sous">L'avance versée passe au compte d'avance au personnel ; à la clôture, les dépenses justifiées passent au compte de
          charge (une dépense peut porter son propre compte) et soldent l'avance. Laissez vide pour reprendre le compte proposé par le plan.</p>
        <div className="cm-grille">
          <Champ label="Avance au personnel (42…)" id="mp-a"><input id="mp-a" value={v.compte_avance} onChange={(e) => setV({ ...v, compte_avance: e.target.value.trim() })} /></Champ>
          <Champ label="Charge par défaut (618…)" id="mp-c"><input id="mp-c" value={v.compte_charge} onChange={(e) => setV({ ...v, compte_charge: e.target.value.trim() })} /></Champ>
        </div>
      </>)}
    </Tiroir>
  );
}

// ── Saisie de l'ordre de mission ────────────────────────────────────────────
const fraisVide = () => ({ nature: 'transport', designation: '', quantite: '1', jours: '', prix_unitaire: '' });
const montantFrais = (l) => Math.round(nb(l.quantite) * (nb(l.jours) || 1) * nb(l.prix_unitaire));
export function MissionSaisiePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { ctx, erreur: errCtx } = useContexte();
  const [f, setF] = useState(null);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  useEffect(() => {
    if (!ctx) return;
    if (!id) {
      setF({ missionnaire_id: '', missionnaire_nom: '', fonction: '', objet: '', destination: '', date_depart: aujourdhui(), date_retour: aujourdhui(),
        transport: '', activite_id: '', frais: [fraisVide()] });
      return;
    }
    api.get(`/finance/missions/${id}`).then((r) => {
      if (r?.error) { setErreur(r.error); return; }
      if (!r.actions.modifier) { setErreur('Cet ordre de mission ne se modifie plus.'); return; }
      const x = r.mission;
      setF({ missionnaire_id: x.missionnaire_id || '', missionnaire_nom: x.missionnaire_id ? '' : x.missionnaire_nom, fonction: x.fonction, objet: x.objet,
        destination: x.destination, date_depart: x.date_depart, date_retour: x.date_retour, transport: x.transport, activite_id: x.activite_id ? String(x.activite_id) : '',
        motif: x.motif, frais: r.frais.length ? r.frais.map((l) => ({ nature: l.nature, designation: l.designation, quantite: String(l.quantite),
          jours: l.jours === null ? '' : String(l.jours), prix_unitaire: String(l.prix_unitaire) })) : [fraisVide()] });
    });
  }, [ctx, id]);
  const total = useMemo(() => (f ? f.frais.reduce((s, l) => s + montantFrais(l), 0) : 0), [f]);
  if (errCtx || erreur) return <div className="cm-page fin-page"><Link to="/finance/missions" className="fin-lien">← Missions</Link><Erreur message={errCtx || erreur} /></div>;
  if (!f) return <div className="loading-msg">Chargement…</div>;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setL = (i, k) => (e) => setF((x) => ({ ...x, frais: x.frais.map((l, j) => (j === i ? { ...l, [k]: e.target.value } : l)) }));
  const enregistrer = async (soumettre) => {
    setEnCours(true); setErreur('');
    const corps = { ...f, soumettre, frais: f.frais.filter((l) => l.designation.trim() || nb(l.prix_unitaire) > 0) };
    const r = id ? await api.put(`/finance/missions/${id}`, corps) : await api.post('/finance/missions', corps);
    setEnCours(false);
    if (r?.error) { setErreur(r.error); return; }
    toast(soumettre ? `Ordre de mission ${r.mission.numero} envoyé au directeur.` : 'Brouillon enregistré.', 'success');
    navigate(`/finance/missions/${r.mission.id}`);
  };
  const externe = !f.missionnaire_id;
  const dates = f.date_depart && f.date_retour && f.date_retour >= f.date_depart;
  return (
    <div className="cm-page fin-page">
      <Link to="/finance/missions" className="fin-lien">← Missions</Link>
      <div className="cm-entete"><div><h2>{id ? 'Modifier l\'ordre de mission' : 'Nouvel ordre de mission'}</h2>
        <p>Frais prévus en saisie libre : montant = quantité × jours × prix unitaire (laissez « jours » vide s'il ne s'applique pas).</p></div></div>
      {f.motif && <div className="fin-bandeau">Renvoyé pour correction : {f.motif}</div>}
      <Erreur message={erreur} />
      <section className="fin-carte">
        <h3 className="fin-titre-section">Missionnaire et mission</h3>
        <div className="cm-grille">
          <Champ label="Missionnaire" requis id="mi-u">
            <select id="mi-u" value={f.missionnaire_id} onChange={set('missionnaire_id')}>
              <option value="">— Personne sans compte (saisir le nom) —</option>
              {ctx.utilisateurs.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
            </select>
          </Champ>
          {externe && <Champ label="Nom du missionnaire" requis id="mi-n"><input id="mi-n" value={f.missionnaire_nom} maxLength={150} onChange={set('missionnaire_nom')} /></Champ>}
          <Champ label="Fonction" id="mi-f"><input id="mi-f" value={f.fonction} maxLength={150} onChange={set('fonction')} /></Champ>
          <Champ label="Destination" requis id="mi-d"><input id="mi-d" value={f.destination} maxLength={200} onChange={set('destination')} /></Champ>
          <Champ label="Départ" requis id="mi-dd"><input id="mi-dd" type="date" value={f.date_depart} onChange={set('date_depart')} /></Champ>
          <Champ label="Retour" requis id="mi-dr" aide={dates ? '' : 'Le retour suit le départ'}><input id="mi-dr" type="date" value={f.date_retour} onChange={set('date_retour')} /></Champ>
          <Champ label="Moyen de transport" id="mi-t"><input id="mi-t" value={f.transport} maxLength={150} onChange={set('transport')} placeholder="ex. Véhicule de service, car de ligne" /></Champ>
          {ctx.ong && ctx.activites.length > 0 && (
            <Champ label="Activité (projet)" id="mi-a"><select id="mi-a" value={f.activite_id} onChange={set('activite_id')}>
              <option value="">— Aucune —</option>
              {ctx.activites.map((a) => <option key={a.id} value={a.id}>{a.projet ? `${a.projet} / ` : ''}{a.nom}</option>)}</select></Champ>
          )}
          <Champ label="Objet de la mission" requis pleine id="mi-o"><textarea id="mi-o" rows={2} value={f.objet} maxLength={500} onChange={set('objet')} /></Champ>
        </div>
      </section>
      <section className="fin-carte">
        <h3 className="fin-titre-section">Frais prévus</h3>
        <div className="cm-table-wrap">
          <table className="cm-table fin-table fin-lignes">
            <thead><tr><th>Nature</th><th>Désignation</th><th className="fin-num">Quantité</th><th className="fin-num">Jours</th><th className="fin-num">Prix unitaire</th><th className="fin-num">Montant</th><th aria-label="Retirer" /></tr></thead>
            <tbody>
              {f.frais.map((l, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <tr key={i}>
                  <td><select aria-label={`Nature ligne ${i + 1}`} value={l.nature} onChange={setL(i, 'nature')}>
                    {Object.entries(NATURES).map(([k, lib]) => <option key={k} value={k}>{lib}</option>)}</select></td>
                  <td><input aria-label={`Désignation ligne ${i + 1}`} value={l.designation} maxLength={300} onChange={setL(i, 'designation')} placeholder={NATURES[l.nature]} /></td>
                  <td><input aria-label="Quantité" className="fin-num" inputMode="decimal" value={l.quantite} onChange={setL(i, 'quantite')} /></td>
                  <td><input aria-label="Jours" className="fin-num" inputMode="decimal" value={l.jours} onChange={setL(i, 'jours')} placeholder="—" /></td>
                  <td><input aria-label="Prix unitaire" className="fin-num" inputMode="decimal" value={l.prix_unitaire} onChange={setL(i, 'prix_unitaire')} /></td>
                  <td className="fin-num">{m(montantFrais(l))}</td>
                  <td>{f.frais.length > 1 && <button type="button" className="cm-btn cm-secondaire cm-petit" aria-label="Retirer la ligne"
                    onClick={() => setF((x) => ({ ...x, frais: x.frais.filter((_, j) => j !== i) }))}>✕</button>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={5}><button type="button" className="cm-btn cm-secondaire cm-petit" onClick={() => setF((x) => ({ ...x, frais: [...x.frais, fraisVide()] }))}>+ Ajouter une ligne</button></td>
              <td className="fin-num"><b>{m(total)}</b></td><td /></tr></tfoot>
          </table>
        </div>
      </section>
      <div className="fin-barre-actions">
        <Link className="cm-btn cm-secondaire" to="/finance/missions">Annuler</Link>
        <button type="button" className="cm-btn cm-secondaire" disabled={enCours} onClick={() => enregistrer(false)}>Enregistrer le brouillon</button>
        <button type="button" className="cm-btn cm-primaire" disabled={enCours || !dates || !f.objet.trim() || !f.destination.trim() || (externe && !f.missionnaire_nom.trim())}
          onClick={() => enregistrer(true)}>Envoyer au directeur</button>
      </div>
    </div>
  );
}

// ── Fiche ───────────────────────────────────────────────────────────────────
export function MissionFichePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { ctx } = useContexte();
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState('');
  const [tiroir, setTiroir] = useState(null);   // 'depense' | 'rapport' | { caisse: sens } | { motif: action }
  const charger = useCallback(() => {
    api.get(`/finance/missions/${id}`).then((r) => (r?.error ? setErreur(r.error) : setD(r)));
  }, [id]);
  useEffect(() => { charger(); }, [charger]);
  if (erreur) return <div className="cm-page fin-page"><Link to="/finance/missions" className="fin-lien">← Missions</Link><Erreur message={erreur} /></div>;
  if (!d) return <div className="loading-msg">Chargement…</div>;
  const x = d.mission; const a = d.actions;
  const agir = async (chemin, corps, message) => {
    const r = await api.post(`/finance/missions/${id}/${chemin}`, corps);
    if (r?.error) { toast(r.error, 'error'); return false; }
    toast(typeof message === 'function' ? message(r) : message, 'success'); setTiroir(null); charger(); return true;
  };
  const supprimer = async () => {
    if (!window.confirm('Supprimer ce brouillon ?')) return;
    const r = await api.delete(`/finance/missions/${id}`);
    if (r?.error) { toast(r.error, 'error'); return; }
    toast('Brouillon supprimé.', 'success'); navigate('/finance/missions');
  };
  const retirer = async (dep) => {
    const r = await api.delete(`/finance/missions/${id}/depenses/${dep.id}`);
    if (r?.error) { toast(r.error, 'error'); return; }
    charger();
  };
  const motifs = {
    renvoyer: ['Renvoyer pour correction', 'decider', (motif) => ({ decision: 'renvoyer', motif }), 'Ordre renvoyé pour correction.'],
    rejeter: ['Rejeter l\'ordre de mission', 'decider', (motif) => ({ decision: 'rejeter', motif }), 'Ordre de mission rejeté.'],
    annuler: ['Annuler la mission', 'annuler', (motif) => ({ motif }), 'Mission annulée.'],
    justif_renvoyer: ['Renvoyer la justification', 'controler', (motif) => ({ decision: 'renvoyer', motif }), 'Justification renvoyée au missionnaire.'],
  };
  const cloture = (r) => (r.cloture?.cloturee ? 'Mission soldée et clôturée : l\'écriture comptable est passée.'
    : r.cloture?.erreur ? `Justification validée, mais la clôture attend : ${r.cloture.erreur}` : 'Justification validée : la caisse régularise.');
  return (
    <div className="cm-page fin-page">
      <Link to="/finance/missions" className="fin-lien">← Missions</Link>
      <div className="fin-fiche-tete">
        <div>
          <h2>{x.numero || 'Ordre de mission en brouillon'} <Etat x={x} /></h2>
          <p className="cm-sous"><b>{x.missionnaire_nom}</b>{x.fonction ? ` · ${x.fonction}` : ''} · {x.destination} · du {fmtDate(x.date_depart)} au {fmtDate(x.date_retour)} ({x.jours} j)
            {x.transport ? ` · ${x.transport}` : ''}{x.activite ? ` · ${x.projet ? `${x.projet} / ` : ''}${x.activite}` : ''}</p>
          <p>{x.objet}</p>
        </div>
        <div className="fin-actions">
          {x.numero && <button type="button" className="cm-btn cm-secondaire" onClick={() => imprimerOrdre(x, toast)}>🖨 Ordre de mission</button>}
          {a.modifier && <Link className="cm-btn cm-secondaire" to={`/finance/missions/${id}/modifier`}>Modifier</Link>}
          {a.supprimer && <button type="button" className="cm-btn cm-secondaire" onClick={supprimer}>Supprimer</button>}
          {a.soumettre && <button type="button" className="cm-btn cm-primaire" onClick={() => agir('soumettre', {}, 'Ordre de mission envoyé au directeur.')}>Envoyer au directeur</button>}
          {a.decider && <button type="button" className="cm-btn cm-primaire" onClick={() => agir('decider', { decision: 'approuver' }, 'Ordre de mission approuvé.')}>Approuver</button>}
          {a.decider && <button type="button" className="cm-btn cm-secondaire" onClick={() => setTiroir({ motif: 'renvoyer' })}>Renvoyer</button>}
          {a.decider && <button type="button" className="cm-btn cm-secondaire" onClick={() => setTiroir({ motif: 'rejeter' })}>Rejeter</button>}
          {a.verser_avance && <button type="button" className="cm-btn cm-primaire" onClick={() => setTiroir({ caisse: 'avance' })}>💵 Verser une avance</button>}
          {a.declarer && <button type="button" className="cm-btn cm-primaire" onClick={() => setTiroir('depense')}>+ Déclarer une dépense</button>}
          {a.declarer && <button type="button" className="cm-btn cm-secondaire" onClick={() => setTiroir('rapport')}>📝 Rapport de mission</button>}
          {a.soumettre_justification && <button type="button" className="cm-btn cm-primaire"
            onClick={() => agir('justifier', {}, 'Justification envoyée au contrôle.')}>Envoyer la justification</button>}
          {a.controler && <button type="button" className="cm-btn cm-primaire" onClick={() => agir('controler', { decision: 'valider' }, cloture)}>Valider la justification</button>}
          {a.controler && <button type="button" className="cm-btn cm-secondaire" onClick={() => setTiroir({ motif: 'justif_renvoyer' })}>Renvoyer la justification</button>}
          {a.payer_complement && <button type="button" className="cm-btn cm-primaire" onClick={() => setTiroir({ caisse: 'complement' })}>💵 Payer le complément</button>}
          {a.reverser_reliquat && <button type="button" className="cm-btn cm-primaire" onClick={() => setTiroir({ caisse: 'reliquat' })}>↩ Encaisser le reliquat</button>}
          {a.cloturer && <button type="button" className="cm-btn cm-primaire" onClick={() => agir('cloturer', {}, 'Mission clôturée.')}>Clôturer</button>}
          {a.annuler && <button type="button" className="cm-btn cm-secondaire" onClick={() => setTiroir({ motif: 'annuler' })}>Annuler la mission</button>}
        </div>
      </div>
      {x.motif && <div className="fin-bandeau">Motif : {x.motif}</div>}
      {x.statut === 'justifiee' && (x.reliquat > 0 || x.complement > 0) && (
        <div className="fin-bandeau">{x.reliquat > 0 ? `Le missionnaire doit reverser ${m(x.reliquat)} FCFA en caisse.`
          : `La caisse doit payer ${m(x.complement)} FCFA au missionnaire.`} La mission sera clôturée dès que c'est fait.</div>
      )}

      <div className="fin-totaux-cartes">
        {[['Frais prévus', x.prevu, x.approuve_par_nom ? `Approuvé par ${x.approuve_par_nom}` : ''], ['Avance versée', x.verse, x.reste_avance ? `Possible encore : ${m(x.reste_avance)}` : 'Facultative'],
          ['Dépenses justifiées', x.depenses, `${d.depenses.length} pièce${d.depenses.length > 1 ? 's' : ''}`], ['Reliquat reversé', x.reverse, ''],
          [x.complement > 0 ? 'Complément dû' : 'Reliquat dû', x.complement > 0 ? x.complement : x.reliquat, x.statut === 'cloturee' ? 'Mission soldée' : '']]
          .map(([l, v, s]) => (
            <div key={l} className="fin-carte fin-chiffre"><span className="cm-sous">{l}</span><b>{m(v)}</b>{s && <span className="cm-sous">{s}</span>}</div>
          ))}
      </div>

      <section className="fin-carte">
        <h3 className="fin-titre-section">Frais prévus</h3>
        {d.frais.length === 0 ? <p className="cm-sous">Aucun frais prévu.</p> : (
          <table className="cm-table fin-table">
            <thead><tr><th>Nature</th><th>Désignation</th><th className="fin-num">Quantité</th><th className="fin-num">Jours</th><th className="fin-num">Prix unitaire</th><th className="fin-num">Montant</th></tr></thead>
            <tbody>{d.frais.map((l) => (
              <tr key={l.id}><td>{NATURES[l.nature]}</td><td>{l.designation}</td><td className="fin-num">{l.quantite.toLocaleString('fr-FR')}</td><td className="fin-num">{l.jours ?? '—'}</td>
                <td className="fin-num">{m(l.prix_unitaire)}</td><td className="fin-num">{m(l.montant)}</td></tr>))}</tbody>
            <tfoot><tr><td colSpan={5}><b>Total</b></td><td className="fin-num"><b>{m(x.prevu)}</b></td></tr></tfoot>
          </table>
        )}
      </section>

      {d.mouvements.length > 0 && (
        <section className="fin-carte">
          <h3 className="fin-titre-section">Mouvements de caisse</h3>
          <table className="cm-table fin-table">
            <thead><tr><th>Date</th><th>Nature</th><th>Caisse / banque</th><th>N°</th><th className="fin-num">Sortie</th><th className="fin-num">Entrée</th><th>Par</th></tr></thead>
            <tbody>{d.mouvements.map((v) => (
              <tr key={v.journal_id} className={v.annule ? 'fin-ligne-annulee' : ''}><td>{fmtDate(v.date)}</td>
                <td>{{ avance: 'Avance', complement: 'Complément', reliquat: 'Reliquat reversé' }[v.sens]}{v.annule ? ' (annulé)' : ''}</td>
                <td>{v.caisse_code} — {v.caisse}</td><td className="fin-mono">{v.numero}</td><td className="fin-num">{v.sortie ? m(v.sortie) : ''}</td>
                <td className="fin-num">{v.entree ? m(v.entree) : ''}</td><td>{v.par}</td></tr>))}</tbody>
          </table>
        </section>
      )}

      {(d.depenses.length > 0 || a.declarer) && (
        <section className="fin-carte">
          <h3 className="fin-titre-section">Dépenses réelles et pièces</h3>
          {d.depenses.length === 0 ? <p className="cm-sous">Aucune dépense déclarée.</p> : (
            <table className="cm-table fin-table">
              <thead><tr><th>Date</th><th>Nature</th><th>Désignation</th><th>Compte</th><th className="fin-num">Montant</th><th>Pièce</th><th aria-label="Actions" /></tr></thead>
              <tbody>{d.depenses.map((dep) => (
                <tr key={dep.id}><td>{fmtDate(dep.date_depense)}</td><td>{NATURES[dep.nature]}</td><td>{dep.designation}</td>
                  <td className="fin-mono">{dep.compte || <span className="cm-sous">par défaut</span>}</td><td className="fin-num">{m(dep.montant)}</td>
                  <td>{dep.a_piece && <button type="button" className="cm-btn cm-secondaire cm-petit"
                    onClick={() => ouvrirFichier(api, `/finance/missions/${id}/depenses/${dep.id}/piece`, dep.fichier_nom || 'piece', null, toast)}>📎 Voir</button>}</td>
                  <td>{a.declarer && <button type="button" className="cm-btn cm-secondaire cm-petit" onClick={() => retirer(dep)}>Retirer</button>}</td></tr>))}</tbody>
              <tfoot><tr><td colSpan={4}><b>Total</b></td><td className="fin-num"><b>{m(x.depenses)}</b></td><td colSpan={2} /></tr></tfoot>
            </table>
          )}
        </section>
      )}

      {(x.rapport || a.declarer) && (
        <section className="fin-carte">
          <h3 className="fin-titre-section">Rapport de mission</h3>
          {x.rapport ? <p style={{ whiteSpace: 'pre-wrap' }}>{x.rapport}</p> : <p className="cm-sous">À rédiger avant d'envoyer la justification.</p>}
        </section>
      )}

      <section className="fin-carte">
        <p className="cm-sous">Circuit : {x.soumise_le ? `envoyé le ${fmtDate(x.soumise_le)}` : 'pas encore envoyé'}
          {x.approuve_le ? ` · approuvé par ${x.approuve_par_nom} le ${fmtDate(x.approuve_le)}` : ''}
          {x.justif_soumise_le ? ` · justification présentée le ${fmtDate(x.justif_soumise_le)}` : ''}
          {x.controle_le ? ` · contrôlée par ${x.controle_par_nom} le ${fmtDate(x.controle_le)}` : ''}
          {x.cloture_le ? ` · clôturée le ${fmtDate(x.cloture_le)}` : ''}
          {x.compte_avance ? ` · compte d'avance ${x.compte_avance}` : ''}</p>
      </section>

      {tiroir?.motif && (
        <MotifTiroir titre={motifs[tiroir.motif][0]} onFermer={() => setTiroir(null)}
          onValider={(motif) => agir(motifs[tiroir.motif][1], motifs[tiroir.motif][2](motif), motifs[tiroir.motif][3])} />
      )}
      {tiroir === 'depense' && <DepenseTiroir mission={x} onFermer={() => setTiroir(null)} onFait={() => { setTiroir(null); charger(); }} />}
      {tiroir === 'rapport' && <RapportTiroir mission={x} onFermer={() => setTiroir(null)} onFait={() => { setTiroir(null); charger(); }} />}
      {tiroir?.caisse && ctx && <CaisseTiroir sens={tiroir.caisse} mission={x} ctx={ctx} onFermer={() => setTiroir(null)} onFait={() => { setTiroir(null); charger(); }} />}
    </div>
  );
}

function MotifTiroir({ titre, onFermer, onValider }) {
  const [motif, setMotif] = useState('');
  return (
    <Tiroir titre={titre} onFermer={onFermer} pied={<>
      <button type="button" className="cm-btn cm-secondaire" onClick={onFermer}>Fermer</button>
      <button type="button" className="cm-btn cm-primaire" disabled={!motif.trim()} onClick={() => onValider(motif)}>Confirmer</button>
    </>}>
      <Champ label="Motif" requis pleine id="mi-motif"><textarea id="mi-motif" rows={4} maxLength={500} value={motif} onChange={(e) => setMotif(e.target.value)} /></Champ>
    </Tiroir>
  );
}

function DepenseTiroir({ mission, onFermer, onFait }) {
  const toast = useToast();
  const [v, setV] = useState({ nature: 'transport', date_depense: mission.date_depart, designation: '', montant: '', compte: '' });
  const [fichier, setFichier] = useState(null);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  const valider = async () => {
    setEnCours(true); setErreur('');
    let data;
    try { data = await lireFichier(fichier); } catch (e) { setEnCours(false); setErreur(e.message); return; }
    const r = await api.post(`/finance/missions/${mission.id}/depenses`, { ...v, nom_fichier: fichier.name, data_base64: data });
    setEnCours(false);
    if (r?.error) { setErreur(r.error); return; }
    toast('Dépense ajoutée à la justification.', 'success');
    onFait();
  };
  return (
    <Tiroir titre="Déclarer une dépense de mission" sousTitre={mission.numero} onFermer={onFermer} pied={<>
      <button type="button" className="cm-btn cm-secondaire" onClick={onFermer}>Annuler</button>
      <button type="button" className="cm-btn cm-primaire" disabled={enCours || !fichier || !(nb(v.montant) > 0)} onClick={valider}>Ajouter</button>
    </>}>
      <Erreur message={erreur} />
      <div className="cm-grille">
        <Champ label="Nature" requis id="md-n"><select id="md-n" value={v.nature} onChange={set('nature')}>
          {Object.entries(NATURES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Champ>
        <Champ label="Date" requis id="md-d"><input id="md-d" type="date" value={v.date_depense} onChange={set('date_depense')} /></Champ>
        <Champ label="Montant" requis id="md-m"><input id="md-m" inputMode="decimal" value={v.montant} onChange={set('montant')} /></Champ>
        <Champ label="Compte de charge" id="md-c" aide="Facultatif : sinon le compte par défaut des missions"><input id="md-c" value={v.compte} maxLength={20} onChange={set('compte')} placeholder="ex. 6181" /></Champ>
        <Champ label="Désignation" pleine id="md-des"><input id="md-des" value={v.designation} maxLength={300} onChange={set('designation')} placeholder={NATURES[v.nature]} /></Champ>
        <Champ label="Pièce justificative" requis pleine id="md-f" aide="PDF ou photo, 5 Mo au plus">
          <input id="md-f" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFichier(e.target.files?.[0] || null)} /></Champ>
      </div>
    </Tiroir>
  );
}

function RapportTiroir({ mission, onFermer, onFait }) {
  const toast = useToast();
  const [rapport, setRapport] = useState(mission.rapport || '');
  const [erreur, setErreur] = useState('');
  const valider = async () => {
    const r = await api.put(`/finance/missions/${mission.id}/rapport`, { rapport });
    if (r?.error) { setErreur(r.error); return; }
    toast('Rapport enregistré.', 'success'); onFait();
  };
  return (
    <Tiroir titre="Rapport de mission" sousTitre={mission.numero} onFermer={onFermer} pied={<>
      <button type="button" className="cm-btn cm-secondaire" onClick={onFermer}>Fermer</button>
      <button type="button" className="cm-btn cm-primaire" onClick={valider}>Enregistrer</button>
    </>}>
      <Erreur message={erreur} />
      <Champ label="Déroulement, résultats, difficultés, recommandations" pleine id="mr-r">
        <textarea id="mr-r" rows={14} maxLength={8000} value={rapport} onChange={(e) => setRapport(e.target.value)} /></Champ>
    </Tiroir>
  );
}

const LIB_CAISSE = {
  avance: ['Verser une avance', 'avance', 'Avance versée'], complement: ['Payer le complément au missionnaire', 'complement', 'Complément payé'],
  reliquat: ['Encaisser le reliquat', 'reliquat', 'Reliquat encaissé'],
};
function CaisseTiroir({ sens, mission, ctx, onFermer, onFait }) {
  const toast = useToast();
  const sortie = sens !== 'reliquat';
  const rubriques = ctx.rubriques.filter((r) => (sortie ? r.type !== 'entree' : r.type === 'entree'));
  const plafond = sens === 'avance' ? mission.reste_avance : sens === 'complement' ? mission.complement : mission.reliquat;
  const [v, setV] = useState({ journal_id: ctx.journaux[0]?.id || '', rubrique_code: rubriques.find((r) => (sortie ? /MISSION|DEPLAC|VOYAGE/i : /REMBOURS|RELIQUAT|REVERS/i).test(r.intitule))?.code || rubriques[0]?.code || '',
    date: aujourdhui(), montant: String(plafond), beneficiaire: mission.missionnaire_nom });
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  const journal = ctx.journaux.find((j) => j.id === v.journal_id);
  const manque = sortie && journal && journal.type !== 'banque' ? Math.max(nb(v.montant) - journal.solde, 0) : 0;
  const valider = async () => {
    setEnCours(true); setErreur('');
    const r = await api.post(`/finance/missions/${mission.id}/${LIB_CAISSE[sens][1]}`, v);
    setEnCours(false);
    if (r?.error) { setErreur(r.error); return; }
    toast(`${LIB_CAISSE[sens][2]} (n° ${r.numero}).${r.cloture?.cloturee ? ' Mission clôturée.' : ''}`, 'success');
    onFait();
  };
  return (
    <Tiroir titre={LIB_CAISSE[sens][0]} sousTitre={`${mission.numero} — ${sens === 'avance' ? 'au plus' : 'montant'} : ${m(plafond)} FCFA`} onFermer={onFermer} pied={<>
      <button type="button" className="cm-btn cm-secondaire" onClick={onFermer}>Annuler</button>
      <button type="button" className="cm-btn cm-primaire" disabled={enCours || !v.journal_id || !v.rubrique_code || !(nb(v.montant) > 0) || manque > 0} onClick={valider}>Enregistrer</button>
    </>}>
      <p className="cm-sous">{sortie ? 'Une sortie est écrite dans la caisse ou la banque choisie ; en comptabilité elle passe au compte d\'avance au personnel, pas en charge.'
        : 'Une entrée est écrite dans la caisse ou la banque choisie ; elle solde l\'avance du missionnaire.'}</p>
      <Erreur message={erreur} />
      {manque > 0 && <div className="fin-bandeau">Solde insuffisant : il manque {m(manque)} FCFA dans {journal.nom}.</div>}
      <div className="cm-grille">
        <Champ label="Caisse ou banque" requis id="mc-j"><select id="mc-j" value={v.journal_id} onChange={set('journal_id')}>
          {ctx.journaux.map((j) => <option key={j.id} value={j.id}>{j.code} — {j.nom} ({m(j.solde)} FCFA)</option>)}</select></Champ>
        <Champ label="Rubrique" requis id="mc-r"><select id="mc-r" value={v.rubrique_code} onChange={set('rubrique_code')}>
          {rubriques.map((r) => <option key={r.code} value={r.code}>{r.intitule}</option>)}</select></Champ>
        <Champ label="Date" requis id="mc-d"><input id="mc-d" type="date" value={v.date} onChange={set('date')} /></Champ>
        <Champ label="Montant" requis id="mc-m" aide={sens === 'avance' ? `Au plus ${m(plafond)}` : 'Montant exact pour solder la mission'}>
          <input id="mc-m" inputMode="decimal" value={v.montant} onChange={set('montant')} readOnly={sens !== 'avance'} /></Champ>
        <Champ label={sortie ? 'Bénéficiaire' : 'Remis par'} pleine id="mc-b"><input id="mc-b" value={v.beneficiaire} maxLength={150} onChange={set('beneficiaire')} /></Champ>
      </div>
    </Tiroir>
  );
}
