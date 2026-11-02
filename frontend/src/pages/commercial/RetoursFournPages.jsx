// NJ COMMERCIAL — lot 5 : retours fournisseurs (liste, saisie, fiche).
// Un retour part d'une réception validée et sort au coût de cette réception.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { Entete, Section, Champ, fmtMontant, fmtQte } from '@/components/commercial/ui';
import { dateFr } from '@/components/commercial/achats';
import { StatutStock, lireNombre } from '@/components/commercial/stock';
import { useFiche, ActionsCircuit, EtatCircuit, PiecesDoc, MouvementsDoc, HistoriqueDoc, STATUTS_DOC } from '@/components/commercial/fiche';
import { ListeDocsAchat } from '@/pages/commercial/ReceptionsPages';

const aujourdhui = () => new Date().toISOString().slice(0, 10);
const virgule = (n) => (n === null || n === undefined ? '' : String(n).replace('.', ','));

export function RetoursFournPage() {
  return (
    <div className="cm-page">
      <Entete titre="Retours fournisseurs"
        description="Marchandise renvoyée au fournisseur après réception (non conforme, abîmée, erreur de livraison). Le retour se crée depuis la fiche de la réception ; il sort du stock au coût de cette réception." />
      <ListeDocsAchat url="/commercial/retours-fournisseurs" lien={(d) => `/commercial/retours-fournisseurs/${d.id}`}
        colonnes={['Retour', 'Date', 'Fournisseur', 'Réception', 'Motif']} vide="Ouvrez une réception validée puis « Retour au fournisseur »."
        ligne={(d) => (
          <>
            <td><span className="cm-code">{d.numero}</span></td>
            <td>{dateFr(d.date_retour)}</td>
            <td><strong>{d.fournisseur_nom}</strong></td>
            <td>{d.reception_numero}<span className="cm-sous">{d.magasin_code}</span></td>
            <td>{d.motif || '—'}</td>
          </>
        )} />
    </div>
  );
}

export function RetourFournFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [entete, setEntete] = useState(null);
  const [f, setF] = useState(null);
  const [lignes, setLignes] = useState([]);
  const [numero, setNumero] = useState('');
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    (async () => {
      let rec = params.get('reception'); let existant = null;
      if (id) {
        existant = await api.get(`/commercial/retours-fournisseurs/${id}`);
        if (existant?.error) { setErreur(existant.error); return; }
        if (!existant.droits.modifier) { navigate(`/commercial/retours-fournisseurs/${id}`, { replace: true }); return; }
        rec = existant.reception_id; setNumero(existant.numero);
      }
      const p = await api.get(`/commercial/retours-fournisseurs/proposition/${rec}`);
      if (p?.error) { setErreur(p.error); return; }
      setEntete(p);
      const deja = new Map((existant?.lignes || []).map((l) => [l.reception_ligne_id, l]));
      const toutes = [...p.lignes];
      (existant?.lignes || []).forEach((l) => { if (!toutes.some((x) => x.id === l.reception_ligne_id)) toutes.push({ id: l.reception_ligne_id, designation: l.designation, reference: l.reference, unite: l.unite, disponible: l.disponible, quantite: l.recu, coefficient: l.coefficient }); });
      setLignes(toutes.map((l) => ({ ...l, saisie: virgule(deja.get(l.id)?.quantite ?? '') })));
      setF(existant ? { date_retour: String(existant.date_retour).slice(0, 10), motif: existant.motif, observations: existant.observations }
        : { date_retour: aujourdhui(), motif: '', observations: '' });
    })();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const corps = () => ({ reception_id: entete.reception_id, ...f, lignes: lignes.map((l) => ({ reception_ligne_id: l.id, quantite: l.saisie })) });
  const enregistrer = async (soumettre) => {
    setEnCours(true); setErreur('');
    const r = id ? await api.put(`/commercial/retours-fournisseurs/${id}`, corps()) : await api.post('/commercial/retours-fournisseurs', corps());
    if (r?.error) { setEnCours(false); setErreur(r.error); return; }
    if (soumettre) {
      const s = await api.post(`/commercial/retours-fournisseurs/${r.id}/soumission`, {});
      setEnCours(false);
      if (s?.error) { setErreur(s.error); if (!id) navigate(`/commercial/retours-fournisseurs/${r.id}/modifier`, { replace: true }); return; }
      toast(`${s.numero} soumis pour validation.`, 'success');
    } else { setEnCours(false); toast(`Brouillon ${r.numero} enregistré.`, 'success'); }
    navigate(`/commercial/retours-fournisseurs/${r.id}`);
  };

  if (!entete || !f) return <div className="cm-page">{erreur ? <div className="cm-erreur">{erreur}</div> : <div className="loading-msg">Chargement…</div>}</div>;
  return (
    <div className="cm-page">
      <Link to={id ? `/commercial/retours-fournisseurs/${id}` : `/commercial/receptions/${entete.reception_id}`} className="cm-retour">‹ {id ? numero : entete.reception_numero}</Link>
      <div className="cm-fiche-tete">
        <div>
          <h2>{id ? `Modifier ${numero}` : 'Retour au fournisseur'}</h2>
          <span className="cm-sous">Réception {entete.reception_numero} · {entete.fournisseur_nom} · magasin {entete.magasin_code}</span>
        </div>
        <div className="cm-actions">
          <button type="button" className="cm-btn cm-secondaire" onClick={() => enregistrer(false)} disabled={enCours}>Enregistrer le brouillon</button>
          <button type="button" className="cm-btn cm-primaire" onClick={() => enregistrer(true)} disabled={enCours}>{enCours ? 'Envoi…' : 'Soumettre pour validation'}</button>
        </div>
      </div>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      <Section titre="Retour">
        <div className="cm-grille">
          <Champ label="Date du retour" requis id="td"><input id="td" type="date" max={aujourdhui()} value={f.date_retour} onChange={set('date_retour')} /></Champ>
          <Champ label="Motif" requis id="tm" pleine aide="Obligatoire : non conforme, abîmé, erreur de livraison…"><input id="tm" value={f.motif} onChange={set('motif')} maxLength={500} /></Champ>
          <Champ label="Observations" id="to" pleine><textarea id="to" value={f.observations} onChange={set('observations')} maxLength={2000} /></Champ>
        </div>
      </Section>
      <Section titre="Articles retournés">
        <table className="cm-lignes">
          <thead><tr><th>Article</th><th style={{ textAlign: 'right' }}>Reçu</th><th style={{ textAlign: 'right' }}>Encore retournable</th><th style={{ textAlign: 'right' }}>Retourné</th></tr></thead>
          <tbody>
            {lignes.map((l, i) => (
              <tr key={l.id}>
                <td className="cm-l-article"><strong>{l.designation}</strong><span className="cm-sous">{l.reference}</span></td>
                <td className="cm-num"><span className="cm-l-lib">Reçu</span>{fmtQte(l.quantite)} {l.unite}</td>
                <td className="cm-num"><span className="cm-l-lib">Retournable</span>{fmtQte(l.disponible)}</td>
                <td style={{ textAlign: 'right' }}>
                  <input className="cm-qte-input" inputMode="decimal" value={l.saisie} onChange={(e) => setLignes((ls) => ls.map((x, j) => (j === i ? { ...x, saisie: e.target.value } : x)))}
                    aria-label={`Quantité retournée de ${l.designation}`} style={(lireNombre(l.saisie) || 0) > l.disponible + 1e-9 ? { borderColor: '#b91c1c' } : undefined} />
                  <span className="cm-sous">{l.unite}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}

export function RetourFournPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { d, setD, erreur, enCours, agir } = useFiche(`/commercial/retours-fournisseurs/${id}`);
  if (!d) return <div className="cm-page"><Link to="/commercial/retours-fournisseurs" className="cm-retour">‹ Retours fournisseurs</Link>{erreur ? <div className="cm-erreur">{erreur}</div> : <div className="loading-msg">Chargement…</div>}</div>;
  return (
    <div className="cm-page">
      <Link to="/commercial/retours-fournisseurs" className="cm-retour">‹ Retours fournisseurs</Link>
      <div className="cm-fiche-tete">
        <div>
          <h2><span className="cm-code" style={{ fontSize: 15 }}>{d.numero}</span>Retour fournisseur <StatutStock statut={d.statut} /></h2>
          <span className="cm-sous">Saisi par {d.cree_par_nom} le {dateFr(d.cree_le, true)}{d.valide_le ? ` · validé par ${d.valide_par_nom} le ${dateFr(d.valide_le, true)}` : ''}</span>
        </div>
        <ActionsCircuit d={d} base="/commercial/retours-fournisseurs" agir={agir} enCours={enCours} libelle={{ stock: true }}
          onSupprime={() => navigate('/commercial/retours-fournisseurs')} onModifier={() => navigate(`/commercial/retours-fournisseurs/${d.id}/modifier`)} />
      </div>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      <EtatCircuit d={d} attente="En attente de validation : la marchandise n'est pas encore sortie du stock." />
      <div className="cm-deux">
        <div>
          <Section titre="Retour">
            <dl className="cm-infos">
              <div><dt>Réception d'origine</dt><dd><Link to={`/commercial/receptions/${d.reception_id}`}>{d.reception_numero}</Link></dd></div>
              <div><dt>Fournisseur</dt><dd>{d.fournisseur_nom}</dd></div>
              <div><dt>Magasin</dt><dd>{d.magasin_code} — {d.magasin_nom}</dd></div>
              <div><dt>Date</dt><dd>{dateFr(d.date_retour)}</dd></div>
              <div><dt>Motif</dt><dd>{d.motif || '—'}</dd></div>
            </dl>
          </Section>
          <Section titre={`Articles (${d.lignes.length})`}>
            <table className="cm-lignes cm-bc-lecture">
              <thead><tr><th>Article</th><th style={{ textAlign: 'right' }}>Reçu</th><th style={{ textAlign: 'right' }}>Retourné</th></tr></thead>
              <tbody>
                {d.lignes.map((l) => (
                  <tr key={l.id}>
                    <td className="cm-l-article"><strong>{l.designation}</strong><span className="cm-sous">{l.reference}</span></td>
                    <td className="cm-num"><span className="cm-l-lib">Reçu</span>{fmtQte(l.recu)} {l.unite}</td>
                    <td className="cm-num"><span className="cm-l-lib">Retourné</span><strong>{fmtQte(l.quantite)}</strong> {l.unite}{l.coefficient !== 1 && <span className="cm-conv">= {fmtQte(l.quantite_stock)} {l.unite_stock}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
          <MouvementsDoc mouvements={d.mouvements} />
          {d.avoirs.length > 0 && (
            <Section titre="Avoirs liés">
              <ul className="cm-pieces">{d.avoirs.map((a) => <li key={a.id}><Link to={`/commercial/factures-fournisseurs/${a.id}`}>{a.numero}</Link><span className="cm-sous">{fmtMontant(a.total_ttc)} · {STATUTS_DOC[a.statut]}</span></li>)}</ul>
            </Section>
          )}
        </div>
        <div>
          <PiecesDoc d={d} base="/commercial/retours-fournisseurs" onMaj={setD} aide="Bon de retour signé par le transporteur, photos…" />
          <HistoriqueDoc historique={d.historique} />
        </div>
      </div>
    </div>
  );
}
