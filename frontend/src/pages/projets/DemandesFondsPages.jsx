// Gestion des activités simplifiée (ONG et associations) — migration 083.
//   • Demandes de fonds : le responsable d'activité saisit ses lignes budgétaires ;
//     le chef de projet valide, puis le directeur approuve ; la caissière décaisse.
//   • Dépenses et justificatifs : déclarées avec pièce, contrôlées par le comptable ;
//     le reliquat est reversé en caisse ou en banque.
//   • Rapport financier : par projet et activité, à tout moment.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { Tiroir, Champ } from '@/components/commercial/ui';
import { ouvrirFichier, lireFichier } from '@/components/commercial/achats';
import { Erreur, fmtCompta, fmtDate, aujourdhui } from '@/pages/comptabilite/commun';
import { exporterExcel } from '@/lib/export';

const TONS = {
  Brouillon: 'gris', 'Chez le chef de projet': 'orange', 'Chez le directeur': 'orange', Rejetée: 'rouge-plein', Annulée: 'gris',
  'À décaisser': 'bleu', 'Décaissée en partie': 'bleu', 'Décaissée en partie, justifiée': 'bleu', 'À justifier': 'orange',
  'Dépenses à contrôler': 'orange', Justifiée: 'vert',
};
export const Etat = ({ etat }) => <span className={`fin-pastille fin-pastille-${TONS[etat] || 'gris'}`}>{etat}</span>;
const STATUT_DEPENSE = { declaree: ['À contrôler', 'orange'], validee: ['Validée', 'vert'], rejetee: ['Rejetée', 'rouge-plein'] };
const m = (v) => fmtCompta(v, { zero: '0' });
const useContexte = () => {
  const [ctx, setCtx] = useState(null);
  const [erreur, setErreur] = useState('');
  useEffect(() => {
    api.get('/projets/demandes/contexte').then((r) => (r?.error ? setErreur(r.error) : setCtx(r)));
  }, []);
  return { ctx, erreur };
};

// ── Liste des demandes ──────────────────────────────────────────────────────
const VUES = [['a_valider', 'À valider'], ['a_decaisser', 'À décaisser'], ['a_justifier', 'À justifier'], ['mes', 'Mes demandes'], ['', 'Toutes']];
export function DemandesFondsPage() {
  const [params, setParams] = useSearchParams();
  const { ctx, erreur: errCtx } = useContexte();
  const vue = params.get('vue') ?? '';
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState('');
  useEffect(() => {
    setD(null);
    api.get(`/projets/demandes${vue ? `?vue=${vue}` : ''}`).then((r) => (r?.error ? setErreur(r.error) : setD(r)));
  }, [vue]);
  return (
    <div className="cm-page fin-page">
      <div className="cm-entete">
        <div>
          <h2>Demandes de fonds</h2>
          <p>Le responsable d'activité demande les fonds ligne par ligne. Le chef de projet valide, puis le directeur approuve :
            la demande devient le budget approuvé et passe à la caisse pour le décaissement.</p>
        </div>
        {ctx?.peut_demander && <Link className="cm-btn cm-primaire" to="/projets/demandes/nouvelle">+ Nouvelle demande</Link>}
      </div>
      <Erreur message={errCtx || erreur} />
      <div className="fin-onglets" role="tablist">
        {VUES.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={vue === k} className={vue === k ? 'actif' : ''}
            onClick={() => setParams(k ? { vue: k } : {})}>
            {l}{d?.compteurs?.[k] ? ` (${d.compteurs[k]})` : ''}
          </button>
        ))}
      </div>
      {!d && !erreur && <div className="loading-msg">Chargement…</div>}
      {d && (d.demandes.length === 0 ? (
        <div className="fin-vide"><div className="fin-vide-icone" aria-hidden="true">📝</div><h3>Aucune demande</h3>
          <p>{ctx?.peut_demander ? 'Créez une demande de fonds pour une de vos activités.' : 'Rien dans cette vue.'}</p></div>
      ) : (
        <div className="cm-table-wrap">
          <table className="cm-table fin-table">
            <thead><tr><th>N°</th><th>Projet / activité</th><th>Objet</th><th>Demandeur</th><th className="fin-num">Montant</th>
              <th className="fin-num">Décaissé</th><th className="fin-num">Reste à justifier</th><th>État</th></tr></thead>
            <tbody>
              {d.demandes.map((x) => (
                <tr key={x.id}>
                  <td className="fin-mono"><Link to={`/projets/demandes/${x.id}`}>{x.numero || 'Brouillon'}</Link></td>
                  <td><b>{x.projet}</b><div className="cm-sous">{x.activite}</div></td>
                  <td>{x.objet}{x.date_besoin && <div className="cm-sous">pour le {fmtDate(x.date_besoin)}</div>}</td>
                  <td>{x.demandeur}</td>
                  <td className="fin-num">{m(x.total)}</td>
                  <td className="fin-num">{x.statut === 'approuvee' ? m(x.decaisse) : '—'}</td>
                  <td className="fin-num">{x.statut === 'approuvee' ? m(x.reste_a_justifier) : '—'}</td>
                  <td><Etat etat={x.etat} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

// ── Saisie d'une demande ────────────────────────────────────────────────────
const ligneVide = () => ({ designation: '', quantite: '1', jours: '', prix_unitaire: '' });
const montantLigne = (l) => Math.round((Number(String(l.quantite).replace(',', '.')) || 0) * (Number(String(l.jours).replace(',', '.')) || 1)
  * (Number(String(l.prix_unitaire).replace(/\s/g, '').replace(',', '.')) || 0));
export function DemandeSaisiePage() {
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
      setF({ activite_id: ctx.activites.length === 1 ? String(ctx.activites[0].id) : '', objet: '', date_besoin: '', lignes: [ligneVide()] });
      return;
    }
    api.get(`/projets/demandes/${id}`).then((r) => {
      if (r?.error) { setErreur(r.error); return; }
      if (!r.actions.modifier) { setErreur('Cette demande ne se modifie plus.'); return; }
      setF({ activite_id: String(r.demande.activite_id), objet: r.demande.objet, date_besoin: r.demande.date_besoin || '', motif: r.demande.motif,
        lignes: r.lignes.map((l) => ({ designation: l.designation, quantite: String(l.quantite), jours: l.jours === null ? '' : String(l.jours), prix_unitaire: String(l.prix_unitaire) })) });
    });
  }, [ctx, id]);
  const total = useMemo(() => (f ? f.lignes.reduce((s, l) => s + montantLigne(l), 0) : 0), [f]);
  if (errCtx || erreur) return <div className="cm-page fin-page"><Erreur message={errCtx || erreur} /></div>;
  if (!f) return <div className="loading-msg">Chargement…</div>;
  if (!ctx.activites.length) {
    return (
      <div className="cm-page fin-page"><div className="fin-vide"><h3>Aucune activité à votre nom</h3>
        <p>Les demandes de fonds se font par le responsable de l'activité (ou le chef du projet). Les désignations se font dans
          Configuration → Activités / projets.</p></div></div>
    );
  }
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setL = (i, k) => (e) => setF((x) => ({ ...x, lignes: x.lignes.map((l, j) => (j === i ? { ...l, [k]: e.target.value } : l)) }));
  const parProjet = ctx.activites.reduce((acc, a) => { (acc[a.projet] = acc[a.projet] || []).push(a); return acc; }, {});
  const enregistrer = async (soumettre) => {
    setEnCours(true); setErreur('');
    const corps = { ...f, soumettre, lignes: f.lignes.filter((l) => l.designation.trim() || l.prix_unitaire) };
    const r = id ? await api.put(`/projets/demandes/${id}`, corps) : await api.post('/projets/demandes', corps);
    setEnCours(false);
    if (r?.error) { setErreur(r.error); return; }
    toast(soumettre ? `Demande ${r.numero} envoyée ${r.statut === 'soumise' ? 'au chef de projet' : 'au directeur'}.` : 'Brouillon enregistré.', 'success');
    navigate(`/projets/demandes/${r.id}`);
  };
  return (
    <div className="cm-page fin-page">
      <Link to="/projets/demandes" className="fin-lien">← Demandes de fonds</Link>
      <div className="cm-entete"><div><h2>{id ? 'Modifier la demande' : 'Nouvelle demande de fonds'}</h2>
        <p>Détaillez les besoins ligne par ligne : montant = quantité × jours × prix unitaire (laissez « jours » vide s'il ne s'applique pas).</p></div></div>
      {f.motif && <div className="fin-bandeau">Renvoyée pour correction : {f.motif}</div>}
      <Erreur message={erreur} />
      <section className="fin-carte">
        <div className="cm-grille">
          <Champ label="Projet / activité" requis id="df-a">
            <select id="df-a" value={f.activite_id} onChange={set('activite_id')}>
              <option value="">— Choisir —</option>
              {Object.entries(parProjet).map(([p, acts]) => (
                <optgroup key={p} label={p}>{acts.map((a) => <option key={a.id} value={a.id}>{a.nom}</option>)}</optgroup>))}
            </select>
          </Champ>
          <Champ label="Date du besoin" id="df-d"><input id="df-d" type="date" value={f.date_besoin} onChange={set('date_besoin')} /></Champ>
          <Champ label="Objet de la demande" requis pleine id="df-o"><input id="df-o" value={f.objet} maxLength={300} onChange={set('objet')} placeholder="ex. Atelier de formation des relais communautaires" /></Champ>
        </div>
      </section>
      <section className="fin-carte">
        <h3 className="fin-titre-section">Lignes budgétaires</h3>
        <div className="cm-table-wrap">
          <table className="cm-table fin-table fin-lignes">
            <thead><tr><th>Désignation</th><th className="fin-num">Quantité</th><th className="fin-num">Jours</th><th className="fin-num">Prix unitaire</th><th className="fin-num">Montant</th><th aria-label="Retirer" /></tr></thead>
            <tbody>
              {f.lignes.map((l, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <tr key={i}>
                  <td><input aria-label={`Désignation ligne ${i + 1}`} value={l.designation} maxLength={300} onChange={setL(i, 'designation')} /></td>
                  <td><input aria-label="Quantité" className="fin-num" inputMode="decimal" value={l.quantite} onChange={setL(i, 'quantite')} /></td>
                  <td><input aria-label="Jours" className="fin-num" inputMode="decimal" value={l.jours} onChange={setL(i, 'jours')} placeholder="—" /></td>
                  <td><input aria-label="Prix unitaire" className="fin-num" inputMode="decimal" value={l.prix_unitaire} onChange={setL(i, 'prix_unitaire')} /></td>
                  <td className="fin-num">{m(montantLigne(l))}</td>
                  <td>{f.lignes.length > 1 && <button type="button" className="cm-btn cm-secondaire cm-petit" aria-label="Retirer la ligne"
                    onClick={() => setF((x) => ({ ...x, lignes: x.lignes.filter((_, j) => j !== i) }))}>✕</button>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={4}><button type="button" className="cm-btn cm-secondaire cm-petit" onClick={() => setF((x) => ({ ...x, lignes: [...x.lignes, ligneVide()] }))}>+ Ajouter une ligne</button></td>
              <td className="fin-num"><b>{m(total)}</b></td><td /></tr></tfoot>
          </table>
        </div>
      </section>
      <div className="fin-barre-actions">
        <Link className="cm-btn cm-secondaire" to="/projets/demandes">Annuler</Link>
        <button type="button" className="cm-btn cm-secondaire" disabled={enCours} onClick={() => enregistrer(false)}>Enregistrer le brouillon</button>
        <button type="button" className="cm-btn cm-primaire" disabled={enCours || !f.activite_id || total <= 0} onClick={() => enregistrer(true)}>Envoyer pour validation</button>
      </div>
    </div>
  );
}

// ── Fiche d'une demande ─────────────────────────────────────────────────────
export function DemandeFichePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { ctx } = useContexte();
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState('');
  const [tiroir, setTiroir] = useState(null);      // 'decaisser' | 'reverser' | 'depense' | { motif: action }
  const charger = useCallback(() => {
    api.get(`/projets/demandes/${id}`).then((r) => (r?.error ? setErreur(r.error) : setD(r)));
  }, [id]);
  useEffect(() => { charger(); }, [charger]);
  if (erreur) return <div className="cm-page fin-page"><Link to="/projets/demandes" className="fin-lien">← Demandes de fonds</Link><Erreur message={erreur} /></div>;
  if (!d) return <div className="loading-msg">Chargement…</div>;
  const x = d.demande; const a = d.actions;
  const agir = async (action, corps) => {
    const r = await api.post(`/projets/demandes/${id}/${action}`, corps);
    if (r?.error) { toast(r.error, 'error'); return false; }
    toast({ soumettre: 'Demande envoyée.', valider: r.statut === 'approuvee' ? 'Demande approuvée : elle part à la caisse.' : 'Demande validée : elle part chez le directeur.',
      renvoyer: 'Demande renvoyée pour correction.', rejeter: 'Demande rejetée.', annuler: 'Demande annulée.' }[action], 'success');
    charger(); return true;
  };
  const supprimer = async () => {
    const r = await api.delete(`/projets/demandes/${id}`);
    if (r?.error) { toast(r.error, 'error'); return; }
    toast('Brouillon supprimé.', 'success'); navigate('/projets/demandes');
  };
  const controler = async (dep, decision, motif) => {
    const r = await api.post(`/projets/depenses/${dep.id}/controler`, { decision, motif });
    if (r?.error) { toast(r.error, 'error'); return false; }
    toast(decision === 'valider' ? 'Dépense validée.' : 'Dépense rejetée.', 'success'); charger(); return true;
  };
  return (
    <div className="cm-page fin-page">
      <Link to="/projets/demandes" className="fin-lien">← Demandes de fonds</Link>
      <div className="fin-fiche-tete">
        <div>
          <h2>{x.numero || 'Demande en brouillon'} <Etat etat={x.etat} /></h2>
          <p className="cm-sous"><b>{x.projet}</b> · {x.activite} · demandée par {x.demandeur || '—'}{x.date_besoin ? ` · pour le ${fmtDate(x.date_besoin)}` : ''}</p>
          <p>{x.objet}</p>
        </div>
        <div className="fin-actions">
          {a.modifier && <Link className="cm-btn cm-secondaire" to={`/projets/demandes/${id}/modifier`}>Modifier</Link>}
          {a.modifier && <button type="button" className="cm-btn cm-secondaire" onClick={supprimer}>Supprimer</button>}
          {a.modifier && <button type="button" className="cm-btn cm-primaire" onClick={() => agir('soumettre')}>Envoyer pour validation</button>}
          {(a.valider_chef || a.approuver) && <button type="button" className="cm-btn cm-primaire" onClick={() => agir('valider')}>{a.approuver ? 'Approuver (directeur)' : 'Valider (chef de projet)'}</button>}
          {a.renvoyer && <button type="button" className="cm-btn cm-secondaire" onClick={() => setTiroir({ motif: 'renvoyer' })}>Renvoyer pour correction</button>}
          {a.renvoyer && <button type="button" className="cm-btn cm-secondaire" onClick={() => setTiroir({ motif: 'rejeter' })}>Rejeter</button>}
          {a.decaisser && <button type="button" className="cm-btn cm-primaire" onClick={() => setTiroir('decaisser')}>💵 Décaisser</button>}
          {a.declarer && <button type="button" className="cm-btn cm-primaire" onClick={() => setTiroir('depense')}>+ Déclarer une dépense</button>}
          {a.reverser && <button type="button" className="cm-btn cm-secondaire" onClick={() => setTiroir('reverser')}>↩ Encaisser le reliquat</button>}
          {a.annuler && <button type="button" className="cm-btn cm-secondaire" onClick={() => setTiroir({ motif: 'annuler' })}>Annuler la demande</button>}
        </div>
      </div>
      {x.motif && ['brouillon', 'rejetee', 'annulee'].includes(x.statut) && <div className="fin-bandeau">Motif : {x.motif}</div>}

      <div className="fin-totaux-cartes">
        {[['Approuvé', x.statut === 'approuvee' ? x.total : null, `Demandé : ${m(x.total)}`], ['Décaissé', x.decaisse, x.reste_a_decaisser ? `Reste à décaisser : ${m(x.reste_a_decaisser)}` : ''],
          ['Dépenses déclarées', x.depenses, `dont validées : ${m(x.depenses_validees)}`], ['Reversé', x.reverse, ''], ['Reste à justifier', x.reste_a_justifier, '']]
          .map(([l, v, s]) => (
            <div key={l} className="fin-carte fin-chiffre"><span className="cm-sous">{l}</span><b>{v === null ? '—' : m(v)}</b>{s && <span className="cm-sous">{s}</span>}</div>
          ))}
      </div>

      <section className="fin-carte">
        <h3 className="fin-titre-section">Lignes budgétaires</h3>
        <table className="cm-table fin-table">
          <thead><tr><th>Désignation</th><th className="fin-num">Quantité</th><th className="fin-num">Jours</th><th className="fin-num">Prix unitaire</th><th className="fin-num">Montant</th></tr></thead>
          <tbody>{d.lignes.map((l) => (
            <tr key={l.id}><td>{l.designation}</td><td className="fin-num">{l.quantite.toLocaleString('fr-FR')}</td><td className="fin-num">{l.jours ?? '—'}</td>
              <td className="fin-num">{m(l.prix_unitaire)}</td><td className="fin-num">{m(l.montant)}</td></tr>))}</tbody>
          <tfoot><tr><td colSpan={4}><b>Total</b></td><td className="fin-num"><b>{m(x.total)}</b></td></tr></tfoot>
        </table>
        <p className="cm-sous">Circuit : {x.soumis_le ? `envoyée le ${fmtDate(x.soumis_le)}` : 'pas encore envoyée'}
          {x.chef_le ? ` · validée par le chef de projet${x.chef_nom ? ` (${x.chef_nom})` : ''} le ${fmtDate(x.chef_le)}` : x.chef_projet_nom ? ` · chef de projet : ${x.chef_projet_nom}` : ''}
          {x.directeur_le ? ` · approuvée par ${x.directeur_nom} le ${fmtDate(x.directeur_le)}` : ''}</p>
      </section>

      {d.mouvements.length > 0 && (
        <section className="fin-carte">
          <h3 className="fin-titre-section">Mouvements de caisse et de banque</h3>
          <table className="cm-table fin-table">
            <thead><tr><th>Date</th><th>Caisse / banque</th><th>N°</th><th>Nature</th><th className="fin-num">Montant</th><th>Saisi par</th></tr></thead>
            <tbody>{d.mouvements.map((mv) => (
              <tr key={mv.journal_id} className={mv.annule ? 'fin-annule' : undefined}>
                <td>{fmtDate(mv.date)}</td><td>{mv.caisse} — {mv.caisse_nom}</td><td className="fin-mono">{mv.numero}</td>
                <td>{mv.sens === 'decaissement' ? 'Décaissement' : 'Reliquat reversé'}{mv.annule ? ' (annulé)' : ''}</td>
                <td className="fin-num">{m(mv.sens === 'decaissement' ? mv.sortie : mv.entree)}</td><td>{mv.saisi_par}</td></tr>))}</tbody>
          </table>
        </section>
      )}

      {x.statut === 'approuvee' && (
        <section className="fin-carte">
          <h3 className="fin-titre-section">Dépenses effectuées et justificatifs</h3>
          {d.depenses.length === 0 ? <p className="cm-sous">Aucune dépense déclarée.{a.declarer ? ' Déclarez chaque dépense avec sa pièce (facture, reçu).' : ''}</p> : (
            <TableDepenses depenses={d.depenses} peutControler={a.controler} onControler={controler} onRetirer={async (dep) => {
              const r = await api.delete(`/projets/depenses/${dep.id}`);
              if (r?.error) toast(r.error, 'error'); else { toast('Déclaration retirée.', 'success'); charger(); }
            }} />
          )}
        </section>
      )}

      {(tiroir === 'decaisser' || tiroir === 'reverser') && ctx && (
        <MouvementTiroir sens={tiroir} demande={x} ctx={ctx} onFermer={() => setTiroir(null)} onFait={() => { setTiroir(null); charger(); }} />
      )}
      {tiroir === 'depense' && <DepenseTiroir demande={x} lignes={d.lignes} onFermer={() => setTiroir(null)} onFait={() => { setTiroir(null); charger(); }} />}
      {tiroir?.motif && (
        <MotifTiroir titre={{ renvoyer: 'Renvoyer pour correction', rejeter: 'Rejeter la demande', annuler: 'Annuler la demande' }[tiroir.motif]}
          onFermer={() => setTiroir(null)} onValider={async (motif) => { if (await agir(tiroir.motif, { motif })) setTiroir(null); }} />
      )}
    </div>
  );
}

function TableDepenses({ depenses, peutControler, onControler, onRetirer, avecDemande }) {
  const toast = useToast();
  const [rejet, setRejet] = useState(null);
  return (
    <>
      <div className="cm-table-wrap">
        <table className="cm-table fin-table">
          <thead><tr>{avecDemande && <th>Demande</th>}<th>Date</th><th>Désignation</th><th>Bénéficiaire</th><th className="fin-num">Montant</th><th>Pièce</th><th>Contrôle</th><th aria-label="Actions" /></tr></thead>
          <tbody>{depenses.map((x) => {
            const [lib, ton] = STATUT_DEPENSE[x.statut];
            return (
              <tr key={x.id}>
                {avecDemande && <td><Link className="fin-mono" to={`/projets/demandes/${x.demande_id}`}>{x.numero}</Link><div className="cm-sous">{x.projet} · {x.activite}</div></td>}
                <td>{fmtDate(x.date_depense)}</td>
                <td>{x.designation}{x.ligne && <div className="cm-sous">Ligne : {x.ligne}</div>}<div className="cm-sous">par {x.declare_par_nom}</div></td>
                <td>{x.beneficiaire || '—'}</td>
                <td className="fin-num">{m(x.montant)}</td>
                <td>{x.fichier_nom ? <button type="button" className="cm-lien" onClick={() => ouvrirFichier(api, `/projets/depenses/${x.id}/fichier`, x.fichier_nom, x.mime, toast)}>📎 {x.fichier_nom}</button> : '—'}</td>
                <td><span className={`fin-pastille fin-pastille-${ton}`}>{lib}</span>{x.controle_par_nom && <div className="cm-sous">{x.controle_par_nom}</div>}{x.motif && <div className="cm-sous">{x.motif}</div>}</td>
                <td className="fin-actions-ligne">
                  {x.statut === 'declaree' && peutControler && !x.de_moi && (<>
                    <button type="button" className="cm-btn cm-primaire cm-petit" onClick={() => onControler(x, 'valider')}>Valider</button>
                    <button type="button" className="cm-btn cm-secondaire cm-petit" onClick={() => setRejet(x)}>Rejeter</button></>)}
                  {x.statut === 'declaree' && x.de_moi && onRetirer && <button type="button" className="cm-btn cm-secondaire cm-petit" onClick={() => onRetirer(x)}>Retirer</button>}
                </td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      {rejet && <MotifTiroir titre="Rejeter la dépense" onFermer={() => setRejet(null)} onValider={async (motif) => { if (await onControler(rejet, 'rejeter', motif)) setRejet(null); }} />}
    </>
  );
}

function MotifTiroir({ titre, onFermer, onValider }) {
  const [motif, setMotif] = useState('');
  return (
    <Tiroir titre={titre} onFermer={onFermer} pied={<>
      <button type="button" className="cm-btn cm-secondaire" onClick={onFermer}>Fermer</button>
      <button type="button" className="cm-btn cm-primaire" disabled={!motif.trim()} onClick={() => onValider(motif)}>Confirmer</button>
    </>}>
      <Champ label="Motif" requis pleine id="df-motif"><textarea id="df-motif" rows={4} maxLength={500} value={motif} onChange={(e) => setMotif(e.target.value)} /></Champ>
    </Tiroir>
  );
}

function MouvementTiroir({ sens, demande, ctx, onFermer, onFait }) {
  const toast = useToast();
  const decaissement = sens === 'decaisser';
  const rubriques = ctx.rubriques.filter((r) => (decaissement ? r.type !== 'entree' : r.type === 'entree'));
  const plafond = decaissement ? demande.reste_a_decaisser : demande.reste_a_justifier;
  const [v, setV] = useState({ journal_id: ctx.journaux[0]?.id || '', rubrique_code: rubriques.find((r) => (decaissement ? /ACTIV|PROJET/i : /REVERS|RELIQUAT|REMBOURS/i).test(r.intitule))?.code || rubriques[0]?.code || '',
    date: aujourdhui(), montant: String(plafond), beneficiaire: decaissement ? demande.demandeur || '' : '' });
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  const valider = async () => {
    setEnCours(true); setErreur('');
    const r = await api.post(`/projets/demandes/${demande.id}/${decaissement ? 'decaisser' : 'reverser'}`, v);
    setEnCours(false);
    if (r?.error) { setErreur(r.error); return; }
    toast(`${decaissement ? 'Décaissement' : 'Reliquat'} enregistré (n° ${r.numero}).`, 'success');
    onFait();
  };
  return (
    <Tiroir titre={decaissement ? 'Décaisser les fonds' : 'Encaisser le reliquat'}
      sousTitre={`${demande.numero} — ${decaissement ? 'reste à décaisser' : 'reliquat'} : ${m(plafond)} FCFA`} onFermer={onFermer} pied={<>
        <button type="button" className="cm-btn cm-secondaire" onClick={onFermer}>Annuler</button>
        <button type="button" className="cm-btn cm-primaire" disabled={enCours || !v.journal_id || !v.rubrique_code || !(Number(v.montant) > 0)} onClick={valider}>Enregistrer</button>
      </>}>
      <p className="cm-sous">{decaissement
        ? 'Une sortie est écrite dans la caisse ou la banque choisie, sur l\'activité de la demande, avec les contrôles habituels (période ouverte, solde).'
        : 'Une entrée est écrite dans la caisse ou la banque choisie : les fonds non dépensés reviennent à la structure.'}</p>
      <Erreur message={erreur} />
      <div className="cm-grille">
        <Champ label="Caisse ou banque" requis id="mv-j"><select id="mv-j" value={v.journal_id} onChange={set('journal_id')}>
          {ctx.journaux.map((j) => <option key={j.id} value={j.id}>{j.code} — {j.nom}</option>)}</select></Champ>
        <Champ label="Rubrique" requis id="mv-r"><select id="mv-r" value={v.rubrique_code} onChange={set('rubrique_code')}>
          {rubriques.map((r) => <option key={r.code} value={r.code}>{r.intitule}</option>)}</select></Champ>
        <Champ label="Date" requis id="mv-d"><input id="mv-d" type="date" value={v.date} onChange={set('date')} /></Champ>
        <Champ label="Montant" requis id="mv-m" aide={`Au plus ${m(plafond)}`}><input id="mv-m" inputMode="decimal" value={v.montant} onChange={set('montant')} /></Champ>
        {decaissement && <Champ label="Bénéficiaire" pleine id="mv-b"><input id="mv-b" value={v.beneficiaire} maxLength={150} onChange={set('beneficiaire')} /></Champ>}
      </div>
    </Tiroir>
  );
}

function DepenseTiroir({ demande, lignes, onFermer, onFait }) {
  const toast = useToast();
  const [v, setV] = useState({ date_depense: aujourdhui(), designation: '', beneficiaire: '', montant: '', ligne_id: '' });
  const [fichier, setFichier] = useState(null);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  const valider = async () => {
    setEnCours(true); setErreur('');
    let data;
    try { data = await lireFichier(fichier); } catch (e) { setEnCours(false); setErreur(e.message); return; }
    const r = await api.post(`/projets/demandes/${demande.id}/depenses`, { ...v, nom_fichier: fichier.name, data_base64: data });
    setEnCours(false);
    if (r?.error) { setErreur(r.error); return; }
    toast('Dépense déclarée : elle attend le contrôle du comptable.', 'success');
    onFait();
  };
  return (
    <Tiroir titre="Déclarer une dépense" sousTitre={`${demande.numero} — reste à justifier : ${m(demande.reste_a_justifier)} FCFA`} onFermer={onFermer} pied={<>
      <button type="button" className="cm-btn cm-secondaire" onClick={onFermer}>Annuler</button>
      <button type="button" className="cm-btn cm-primaire" disabled={enCours || !fichier || !v.designation.trim() || !(Number(v.montant) > 0)} onClick={valider}>Déclarer</button>
    </>}>
      <Erreur message={erreur} />
      <div className="cm-grille">
        <Champ label="Date" requis id="dp-d"><input id="dp-d" type="date" value={v.date_depense} onChange={set('date_depense')} /></Champ>
        <Champ label="Montant" requis id="dp-m"><input id="dp-m" inputMode="decimal" value={v.montant} onChange={set('montant')} /></Champ>
        <Champ label="Désignation" requis pleine id="dp-des"><input id="dp-des" value={v.designation} maxLength={300} onChange={set('designation')} /></Champ>
        <Champ label="Bénéficiaire (fournisseur, prestataire)" pleine id="dp-b"><input id="dp-b" value={v.beneficiaire} maxLength={200} onChange={set('beneficiaire')} /></Champ>
        <Champ label="Ligne budgétaire" pleine id="dp-l"><select id="dp-l" value={v.ligne_id} onChange={set('ligne_id')}>
          <option value="">— Toute la demande —</option>{lignes.map((l) => <option key={l.id} value={l.id}>{l.designation} ({m(l.montant)})</option>)}</select></Champ>
        <Champ label="Pièce justificative" requis pleine id="dp-f" aide="PDF ou photo, 5 Mo au plus">
          <input id="dp-f" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFichier(e.target.files?.[0] || null)} /></Champ>
      </div>
    </Tiroir>
  );
}

// ── Dépenses et justificatifs ───────────────────────────────────────────────
const VUES_DEP = [['a_controler', 'À contrôler'], ['mes', 'Mes déclarations'], ['', 'Toutes']];
export function DepensesProjetsPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState('');
  const vue = params.get('vue') ?? (null);
  const [justifier, setJustifier] = useState(null);
  const vueEff = vue ?? (d?.comptable ? 'a_controler' : 'mes');
  const charger = useCallback(() => {
    api.get(`/projets/depenses${vueEff ? `?vue=${vueEff}` : ''}`).then((r) => (r?.error ? setErreur(r.error) : setD(r)));
    api.get('/projets/demandes?vue=a_justifier').then((r) => !r?.error && setJustifier(r.demandes));
  }, [vueEff]);
  useEffect(() => { charger(); }, [charger]);
  const controler = async (dep, decision, motif) => {
    const r = await api.post(`/projets/depenses/${dep.id}/controler`, { decision, motif });
    if (r?.error) { toast(r.error, 'error'); return false; }
    toast(decision === 'valider' ? 'Dépense validée.' : 'Dépense rejetée.', 'success'); charger(); return true;
  };
  return (
    <div className="cm-page fin-page">
      <div className="cm-entete"><div><h2>Dépenses et justificatifs</h2>
        <p>Chaque dépense effectuée sur des fonds reçus est déclarée avec sa pièce. Le comptable la contrôle. Le reliquat non dépensé est reversé
          en caisse ou en banque.</p></div></div>
      <Erreur message={erreur} />
      {justifier?.length > 0 && (
        <section className="fin-carte">
          <h3 className="fin-titre-section">Fonds reçus à justifier</h3>
          <table className="cm-table fin-table">
            <thead><tr><th>Demande</th><th>Projet / activité</th><th className="fin-num">Reçu</th><th className="fin-num">Déclaré</th><th className="fin-num">Reste à justifier</th><th aria-label="Action" /></tr></thead>
            <tbody>{justifier.map((x) => (
              <tr key={x.id}><td className="fin-mono">{x.numero}</td><td><b>{x.projet}</b><div className="cm-sous">{x.activite}</div></td>
                <td className="fin-num">{m(x.decaisse)}</td><td className="fin-num">{m(x.depenses)}</td><td className="fin-num"><b>{m(x.reste_a_justifier)}</b></td>
                <td className="fin-actions-ligne"><Link className="cm-btn cm-secondaire cm-petit" to={`/projets/demandes/${x.id}`}>Ouvrir</Link></td></tr>))}</tbody>
          </table>
        </section>
      )}
      <div className="fin-onglets" role="tablist">
        {VUES_DEP.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={vueEff === k} className={vueEff === k ? 'actif' : ''} onClick={() => setParams({ vue: k })}>
            {l}{k === 'a_controler' && d?.compteurs?.a_controler ? ` (${d.compteurs.a_controler})` : ''}
          </button>
        ))}
      </div>
      {d && (d.depenses.length === 0 ? <div className="fin-vide"><h3>Aucune dépense</h3><p>Rien dans cette vue.</p></div>
        : <TableDepenses avecDemande depenses={d.depenses} peutControler={d.comptable} onControler={controler} />)}
    </div>
  );
}

// ── Rapport financier ───────────────────────────────────────────────────────
export function RapportFinancierPage() {
  const toast = useToast();
  const { ctx } = useContexte();
  const [projet, setProjet] = useState('');
  const [r, setR] = useState(null);
  const [erreur, setErreur] = useState('');
  useEffect(() => {
    setR(null);
    api.get(`/projets/rapport-financier${projet ? `?projet_id=${projet}` : ''}`).then((x) => (x?.error ? setErreur(x.error) : setR(x)));
  }, [projet]);
  const pdf = () => ouvrirFichier(api, `/projets/rapport-financier/pdf${projet ? `?projet_id=${projet}` : ''}`, 'rapport-financier.pdf', 'application/pdf', toast);
  const excel = () => exporterExcel(`Rapport_financier_${new Date().toISOString().slice(0, 10)}`,
    ['Projet', 'Activité', 'Responsable', 'Approuvé', 'Décaissé', 'Dépenses validées', 'Dépenses à contrôler', 'Reversé', 'Reste à justifier'],
    r.projets.flatMap((p) => p.activites.map((a) => [p.nom, a.nom, a.responsable || '', a.approuve, a.decaisse, a.depenses_validees, a.depenses_attente, a.reverse, a.reste_a_justifier])),
    [`Rapport financier — établi le ${new Date().toLocaleDateString('fr-FR')}`]);
  return (
    <div className="cm-page fin-page">
      <div className="cm-entete">
        <div><h2>Rapport financier</h2><p>Par projet et par activité : fonds approuvés, décaissés, dépenses justifiées, reliquats reversés.
          Il se génère à tout moment ; les dépenses pas encore contrôlées par le comptable y sont signalées.</p></div>
        <div className="fin-actions">
          {ctx?.projets?.length > 1 && (
            <select aria-label="Projet" value={projet} onChange={(e) => setProjet(e.target.value)}>
              <option value="">Tous les projets</option>{ctx.projets.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}</select>)}
          <button type="button" className="cm-btn cm-secondaire" disabled={!r?.projets?.length} onClick={excel}>Excel</button>
          <button type="button" className="cm-btn cm-primaire" disabled={!r?.projets?.length} onClick={pdf}>📄 PDF</button>
        </div>
      </div>
      <Erreur message={erreur} />
      {!r && !erreur && <div className="loading-msg">Chargement…</div>}
      {r?.projets?.length === 0 && <div className="fin-vide"><h3>Aucun projet</h3><p>Déclarez les projets dans Configuration → Activités / projets.</p></div>}
      {r?.projets?.map((p) => (
        <section key={p.id} className="fin-carte">
          <h3 className="fin-titre-section">{p.nom}</h3>
          <p className="cm-sous">{p.chef ? `Chef de projet : ${p.chef}` : 'Pas de chef de projet désigné'}
            {p.date_debut ? ` · du ${fmtDate(p.date_debut)}${p.date_fin ? ` au ${fmtDate(p.date_fin)}` : ''}` : ''} · financements reçus : {m(p.financements_recus)}</p>
          {p.provisoire && <div className="fin-bandeau">Provisoire : {m(p.totaux.depenses_attente)} FCFA de dépenses déclarées attendent le contrôle du comptable.</div>}
          <div className="cm-table-wrap">
            <table className="cm-table fin-table">
              <thead><tr><th>Activité</th><th className="fin-num">Approuvé</th><th className="fin-num">Décaissé</th><th className="fin-num">Dépenses validées</th>
                <th className="fin-num">À contrôler</th><th className="fin-num">Reversé</th><th className="fin-num">Reste à justifier</th></tr></thead>
              <tbody>{p.activites.map((a) => (
                <tr key={a.id}><td><b>{a.nom}</b>{a.responsable && <div className="cm-sous">{a.responsable}</div>}
                  {a.demandes_en_cours > 0 && <div className="cm-sous">{a.demandes_en_cours} demande(s) en validation</div>}</td>
                  <td className="fin-num">{m(a.approuve)}</td><td className="fin-num">{m(a.decaisse)}</td><td className="fin-num">{m(a.depenses_validees)}</td>
                  <td className="fin-num">{m(a.depenses_attente)}</td><td className="fin-num">{m(a.reverse)}</td><td className="fin-num"><b>{m(a.reste_a_justifier)}</b></td></tr>))}</tbody>
              <tfoot><tr><td><b>Total</b></td>{['approuve', 'decaisse', 'depenses_validees', 'depenses_attente', 'reverse', 'reste_a_justifier'].map((k) => <td key={k} className="fin-num"><b>{m(p.totaux[k])}</b></td>)}</tr></tfoot>
            </table>
          </div>
          {p.totaux.hors_demande > 0 && <p className="cm-sous">Remises de fonds antérieures à la procédure des demandes : {m(p.totaux.hors_demande)} FCFA.</p>}
        </section>
      ))}
    </div>
  );
}
