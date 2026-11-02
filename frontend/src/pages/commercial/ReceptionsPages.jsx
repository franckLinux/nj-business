// NJ COMMERCIAL — lot 5 : réceptions sur bon de commande (liste, saisie, fiche).
// La marchandise n'entre en stock qu'à la validation, par une autre personne que l'auteur.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { Entete, Section, Champ, useListe, useDiffere, fmtMontant, fmtQte } from '@/components/commercial/ui';
import { dateFr } from '@/components/commercial/achats';
import { StatutStock, lireNombre } from '@/components/commercial/stock';
import { useFiche, ActionsCircuit, EtatCircuit, PiecesDoc, MouvementsDoc, HistoriqueDoc, STATUTS_DOC } from '@/components/commercial/fiche';

const aujourdhui = () => new Date().toISOString().slice(0, 10);
const virgule = (n) => (n === null || n === undefined ? '' : String(n).replace('.', ','));

function ARecevoir() {
  const navigate = useNavigate();
  const { can } = useApp();
  const { donnees, erreur } = useListe('/commercial/receptions/a-recevoir');
  const liste = donnees || [];
  return (
    <>
      <p className="cm-aide" style={{ margin: '0 0 10px' }}>Bons de commande émis dont une partie au moins n'est pas encore reçue.</p>
      {erreur && <div className="cm-erreur">{erreur}</div>}
      <div className="cm-table-wrap">
        <table className="cm-table">
          <thead><tr><th>Bon de commande</th><th>Émis le</th><th>Fournisseur</th><th>Livraison</th><th className="cm-num">Reçu / commandé</th><th>État</th><th /></tr></thead>
          <tbody>
            {!donnees ? <tr><td colSpan={7} className="cm-vide">Chargement…</td></tr>
              : liste.length === 0 ? <tr><td colSpan={7} className="cm-vide"><strong>Rien à recevoir</strong>Tous les bons émis sont entièrement reçus.</td></tr>
                : liste.map((b) => (
                  <tr key={b.id}>
                    <td><span className="cm-code">{b.numero_complet}</span>{b.delai_livraison && <span className="cm-sous">{b.delai_livraison}</span>}</td>
                    <td>{dateFr(b.emis_le)}</td>
                    <td><strong>{b.fournisseur_nom}</strong></td>
                    <td>{b.magasin_code}</td>
                    <td className="cm-num">{fmtQte(b.recu)} / {fmtQte(b.commande)}</td>
                    <td>
                      <span className={`cm-pastille ${b.etat === 'partiel' ? 'cm-info' : 'cm-alerte'}`}>{b.etat === 'partiel' ? 'Reçu en partie' : 'À recevoir'}</span>
                      {b.en_cours > 0 && <span className="cm-sous">{b.en_cours} réception(s) en cours</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {can('com.receptions.saisir') && <button type="button" className="cm-btn cm-primaire" onClick={() => navigate(`/commercial/receptions/nouvelle?bc=${b.id}`)}>Réceptionner</button>}
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function ListeDocsAchat({ url, lien, colonnes, ligne, vide, statutInitial = '' }) {
  const navigate = useNavigate();
  const [statut, setStatut] = useState(statutInitial);
  const [q, setQ] = useState('');
  const [du, setDu] = useState('');
  const [au, setAu] = useState('');
  const qd = useDiffere(q);
  const sep = url.includes('?') ? '&' : '?';
  const { donnees, erreur } = useListe(`${url}${sep}statut=${statut}&q=${encodeURIComponent(qd)}&du=${du}&au=${au}`);
  const liste = donnees || [];
  return (
    <>
      <div className="cm-outils">
        <input className="cm-recherche" type="search" placeholder="Numéro, fournisseur, pièce…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher" />
        <select className="cm-select" value={statut} onChange={(e) => setStatut(e.target.value)} aria-label="Statut">
          <option value="">Tous les statuts</option>
          {Object.entries(STATUTS_DOC).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input className="cm-select" type="date" value={du} onChange={(e) => setDu(e.target.value)} aria-label="Du" title="Du" />
        <input className="cm-select" type="date" value={au} onChange={(e) => setAu(e.target.value)} aria-label="Au" title="Au" />
        <span className="cm-compteur">{donnees ? `${liste.length} document${liste.length > 1 ? 's' : ''}` : ''}</span>
      </div>
      {erreur && <div className="cm-erreur">{erreur}</div>}
      <div className="cm-table-wrap">
        <table className="cm-table" style={{ minWidth: 760 }}>
          <thead><tr>{colonnes.map((c) => <th key={c} className={/montant|TTC/i.test(c) ? 'cm-num' : ''}>{c}</th>)}<th>Statut</th></tr></thead>
          <tbody>
            {!donnees ? <tr><td colSpan={colonnes.length + 1} className="cm-vide">Chargement…</td></tr>
              : liste.length === 0 ? <tr><td colSpan={colonnes.length + 1} className="cm-vide"><strong>Aucun document</strong>{vide}</td></tr>
                : liste.map((d) => (
                  <tr key={d.id} className="cm-cliquable" tabIndex={0} onClick={() => navigate(lien(d))} onKeyDown={(e) => { if (e.key === 'Enter') navigate(lien(d)); }}>
                    {ligne(d)}
                    <td><StatutStock statut={d.statut} /></td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function ReceptionsPage() {
  const { can } = useApp();
  const saisit = can('com.receptions.saisir') || can('com.receptions.valider');
  const [vue, setVue] = useState(saisit ? 'a_recevoir' : 'liste');
  return (
    <div className="cm-page">
      <Entete titre="Réceptions"
        description="La réception constate ce que le fournisseur a livré sur un bon de commande, avec son bon de livraison. Elle peut être partielle ; la marchandise entre en stock à la validation, au prix net du bon." />
      {saisit && (
        <div className="cm-onglets" role="tablist">
          <button type="button" role="tab" aria-selected={vue === 'a_recevoir'} onClick={() => setVue('a_recevoir')}>À recevoir</button>
          <button type="button" role="tab" aria-selected={vue === 'liste'} onClick={() => setVue('liste')}>Réceptions</button>
        </div>
      )}
      {vue === 'a_recevoir' && saisit ? <ARecevoir /> : (
        <ListeDocsAchat url="/commercial/receptions" lien={(d) => `/commercial/receptions/${d.id}`}
          colonnes={['Réception', 'Date', 'Fournisseur', 'Bon de commande', 'Magasin']} vide="Les réceptions se saisissent depuis l'onglet « À recevoir »."
          ligne={(d) => (
            <>
              <td><span className="cm-code">{d.numero}</span>{d.bl_numero && <span className="cm-sous">BL {d.bl_numero}</span>}</td>
              <td>{dateFr(d.date_reception)}</td>
              <td><strong>{d.fournisseur_nom}</strong></td>
              <td>{d.bc_numero}</td>
              <td>{d.magasin_code}</td>
            </>
          )} />
      )}
    </div>
  );
}

export function ReceptionFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [entete, setEntete] = useState(null);   // bon de commande
  const [f, setF] = useState(null);
  const [lignes, setLignes] = useState([]);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [numero, setNumero] = useState('');

  useEffect(() => {
    (async () => {
      let bc = params.get('bc'); let existant = null;
      if (id) {
        existant = await api.get(`/commercial/receptions/${id}`);
        if (existant?.error) { setErreur(existant.error); return; }
        if (!existant.droits.modifier) { navigate(`/commercial/receptions/${id}`, { replace: true }); return; }
        bc = existant.bc_id; setNumero(existant.numero);
      }
      const p = await api.get(`/commercial/receptions/proposition/${bc}`);
      if (p?.error) { setErreur(p.error); return; }
      setEntete(p);
      const deja = new Map((existant?.lignes || []).map((l) => [l.bc_ligne_id, l]));
      setLignes(p.lignes.map((l) => ({ ...l, saisie: existant ? virgule(deja.get(l.id)?.quantite ?? '') : virgule(l.reste || ''), observation: deja.get(l.id)?.observation || '' })));
      setF(existant
        ? { date_reception: String(existant.date_reception).slice(0, 10), bl_numero: existant.bl_numero, bl_date: existant.bl_date ? String(existant.bl_date).slice(0, 10) : '',
          observations: existant.observations, motif_ecart: existant.motif_ecart }
        : { date_reception: aujourdhui(), bl_numero: '', bl_date: '', observations: '', motif_ecart: '' });
    })();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const exces = lignes.filter((l) => (lireNombre(l.saisie) || 0) > l.reste + 1e-9);
  const corps = () => ({ bc_id: entete.bc_id, ...f, lignes: lignes.map((l) => ({ bc_ligne_id: l.id, quantite: l.saisie, observation: l.observation })) });
  const enregistrer = async (soumettre) => {
    setEnCours(true); setErreur('');
    const r = id ? await api.put(`/commercial/receptions/${id}`, corps()) : await api.post('/commercial/receptions', corps());
    if (r?.error) { setEnCours(false); setErreur(r.error); return; }
    if (soumettre) {
      const s = await api.post(`/commercial/receptions/${r.id}/soumission`, { motif_ecart: f.motif_ecart });
      setEnCours(false);
      if (s?.error) { setErreur(s.error); if (!id) navigate(`/commercial/receptions/${r.id}/modifier`, { replace: true }); return; }
      toast(`${s.numero} soumise : elle attend la validation d'une autre personne.`, 'success');
    } else { setEnCours(false); toast(`Brouillon ${r.numero} enregistré.`, 'success'); }
    navigate(`/commercial/receptions/${r.id}`);
  };

  if (!entete || !f) return <div className="cm-page">{erreur ? <div className="cm-erreur">{erreur}</div> : <div className="loading-msg">Chargement…</div>}</div>;
  return (
    <div className="cm-page">
      <Link to={id ? `/commercial/receptions/${id}` : '/commercial/receptions'} className="cm-retour">‹ {id ? numero : 'Réceptions'}</Link>
      <div className="cm-fiche-tete">
        <div>
          <h2>{id ? `Modifier ${numero}` : 'Nouvelle réception'}</h2>
          <span className="cm-sous">Bon {entete.bc_numero} · {entete.fournisseur_nom} · livraison {entete.magasin_code} — {entete.magasin_nom}</span>
        </div>
        <div className="cm-actions">
          <button type="button" className="cm-btn cm-secondaire" onClick={() => enregistrer(false)} disabled={enCours}>Enregistrer le brouillon</button>
          <button type="button" className="cm-btn cm-primaire" onClick={() => enregistrer(true)} disabled={enCours}>{enCours ? 'Envoi…' : 'Soumettre pour validation'}</button>
        </div>
      </div>
      <div className="cm-note">Saisissez ce qui a réellement été livré. Le stock ne bouge qu'à la validation.</div>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      <Section titre="Livraison">
        <div className="cm-grille">
          <Champ label="Date de réception" requis id="rd"><input id="rd" type="date" max={aujourdhui()} value={f.date_reception} onChange={set('date_reception')} /></Champ>
          <Champ label="N° du bon de livraison du fournisseur" id="rbl"><input id="rbl" value={f.bl_numero} onChange={set('bl_numero')} maxLength={60} placeholder="Ex. BL-0458" /></Champ>
          <Champ label="Date du bon de livraison" id="rbd"><input id="rbd" type="date" max={aujourdhui()} value={f.bl_date} onChange={set('bl_date')} /></Champ>
          <Champ label="Observations" id="rob" pleine><textarea id="rob" value={f.observations} onChange={set('observations')} maxLength={2000} placeholder="État des colis, réserves émises au livreur…" /></Champ>
        </div>
      </Section>
      <Section titre="Articles livrés">
        <table className="cm-lignes">
          <thead><tr><th>Article</th><th style={{ textAlign: 'right' }}>Commandé</th><th style={{ textAlign: 'right' }}>Déjà reçu</th><th style={{ textAlign: 'right' }}>Reste</th><th style={{ textAlign: 'right' }}>Reçu ce jour</th></tr></thead>
          <tbody>
            {lignes.map((l, i) => {
              const q = lireNombre(l.saisie) || 0;
              return (
                <tr key={l.id}>
                  <td className="cm-l-article"><strong>{l.designation}</strong><span className="cm-sous">{l.reference}</span></td>
                  <td className="cm-num"><span className="cm-l-lib">Commandé</span>{fmtQte(l.quantite)} {l.unite}</td>
                  <td className="cm-num"><span className="cm-l-lib">Déjà reçu</span>{fmtQte(l.recu)}{l.en_cours > 0 && <span className="cm-sous">+ {fmtQte(l.en_cours)} en cours</span>}</td>
                  <td className="cm-num"><span className="cm-l-lib">Reste</span>{fmtQte(l.reste)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <input className="cm-qte-input" inputMode="decimal" value={l.saisie} onChange={(e) => setLignes((ls) => ls.map((x, j) => (j === i ? { ...x, saisie: e.target.value } : x)))}
                      aria-label={`Quantité reçue de ${l.designation}`} style={q > l.reste + 1e-9 ? { borderColor: '#d97706' } : undefined} />
                    <span className="cm-sous">{l.unite}</span>
                    {l.coefficient !== 1 && q > 0 && <span className="cm-conv">= {fmtQte(Math.round(q * l.coefficient * 1000) / 1000)} {l.unite_stock}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="cm-aide" style={{ marginTop: 8 }}>Laissez vide ou 0 ce qui n'a pas été livré : le reste pourra être reçu plus tard.</p>
      </Section>
      {exces.length > 0 && (
        <Section titre="Excédent">
          <div className="cm-note" style={{ background: '#fffbeb', color: '#92400e' }}>
            Quantité supérieure au reste à recevoir pour : <strong>{exces.map((l) => l.designation).join(', ')}</strong>. Indiquez le motif (geste commercial, erreur du fournisseur acceptée…).
          </div>
          <Champ label="Motif de l'excédent" requis id="rme"><textarea id="rme" value={f.motif_ecart} onChange={set('motif_ecart')} maxLength={500} /></Champ>
        </Section>
      )}
    </div>
  );
}

export function ReceptionPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { d, setD, erreur, enCours, agir } = useFiche(`/commercial/receptions/${id}`);
  if (!d) return <div className="cm-page"><Link to="/commercial/receptions" className="cm-retour">‹ Réceptions</Link>{erreur ? <div className="cm-erreur">{erreur}</div> : <div className="loading-msg">Chargement…</div>}</div>;
  const prix = d.lignes.some((l) => l.prix_net !== null);
  return (
    <div className="cm-page">
      <Link to="/commercial/receptions" className="cm-retour">‹ Réceptions</Link>
      <div className="cm-fiche-tete">
        <div>
          <h2><span className="cm-code" style={{ fontSize: 15 }}>{d.numero}</span>Réception <StatutStock statut={d.statut} /></h2>
          <span className="cm-sous">Saisie par {d.cree_par_nom} le {dateFr(d.cree_le, true)}{d.valide_le ? ` · validée par ${d.valide_par_nom} le ${dateFr(d.valide_le, true)}` : ''}</span>
        </div>
        <ActionsCircuit d={d} base="/commercial/receptions" agir={agir} enCours={enCours} libelle={{ stock: true }}
          onSupprime={() => navigate('/commercial/receptions')} onModifier={() => navigate(`/commercial/receptions/${d.id}/modifier`)}
          extra={d.droits.retourner && <button type="button" className="cm-btn cm-secondaire" onClick={() => navigate(`/commercial/retours-fournisseurs/nouveau?reception=${d.id}`)}>Retour au fournisseur</button>} />
      </div>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      <EtatCircuit d={d} attente="En attente de validation : la marchandise n'est pas encore entrée en stock." />
      <div className="cm-deux">
        <div>
          <Section titre="Livraison">
            <dl className="cm-infos">
              <div><dt>Bon de commande</dt><dd><Link to={`/commercial/bons/${d.bc_id}`}>{d.bc_numero}</Link></dd></div>
              <div><dt>Fournisseur</dt><dd>{d.fournisseur_nom}</dd></div>
              <div><dt>Magasin</dt><dd>{d.magasin_code} — {d.magasin_nom}</dd></div>
              <div><dt>Date de réception</dt><dd>{dateFr(d.date_reception)}</dd></div>
              <div><dt>Bon de livraison</dt><dd>{d.bl_numero || '—'}{d.bl_date ? ` du ${dateFr(d.bl_date)}` : ''}</dd></div>
            </dl>
            {d.motif_ecart && <p className="cm-aide" style={{ marginTop: 10 }}><strong>Motif de l'excédent :</strong> {d.motif_ecart}</p>}
            {d.observations && <p className="cm-aide" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}><strong>Observations :</strong> {d.observations}</p>}
          </Section>
          <Section titre={`Articles (${d.lignes.length})`}>
            <table className="cm-lignes cm-bc-lecture">
              <thead><tr><th>Article</th><th style={{ textAlign: 'right' }}>Commandé</th><th style={{ textAlign: 'right' }}>Reçu</th>{prix && <th style={{ textAlign: 'right' }}>Prix net</th>}<th style={{ textAlign: 'right' }}>Retourné</th></tr></thead>
              <tbody>
                {d.lignes.map((l) => (
                  <tr key={l.id}>
                    <td className="cm-l-article"><strong>{l.designation}</strong><span className="cm-sous">{l.reference}</span>{l.exces && <span className="cm-pastille cm-alerte">Excédent</span>}</td>
                    <td className="cm-num"><span className="cm-l-lib">Commandé</span>{fmtQte(l.commande)} {l.unite}</td>
                    <td className="cm-num"><span className="cm-l-lib">Reçu</span><strong>{fmtQte(l.quantite)}</strong> {l.unite}{l.coefficient !== 1 && <span className="cm-conv">= {fmtQte(l.quantite_stock)} {l.unite_stock}</span>}</td>
                    {prix && <td className="cm-num"><span className="cm-l-lib">Prix net</span>{fmtMontant(l.prix_net, '')}</td>}
                    <td className="cm-num"><span className="cm-l-lib">Retourné</span>{l.retourne ? fmtQte(l.retourne) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
          <MouvementsDoc mouvements={d.mouvements} />
          {d.retours.length > 0 && (
            <Section titre="Retours au fournisseur">
              <ul className="cm-pieces">{d.retours.map((r) => <li key={r.id}><Link to={`/commercial/retours-fournisseurs/${r.id}`}>{r.numero}</Link><span className="cm-sous">{dateFr(r.date_retour)} · {STATUTS_DOC[r.statut]}</span></li>)}</ul>
            </Section>
          )}
        </div>
        <div>
          <PiecesDoc d={d} base="/commercial/receptions" onMaj={setD} aide="Joignez le bon de livraison du fournisseur (scan ou photo)." />
          <HistoriqueDoc historique={d.historique} />
        </div>
      </div>
    </div>
  );
}
