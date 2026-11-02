// NJ COMMERCIAL — fiche d'un document de stock : lignes, mouvements produits, pièces,
// soumission, validation, renvoi, annulation et historique. Les boutons suivent les droits du serveur.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { Section, fmtMontant, fmtQte } from '@/components/commercial/ui';
import { dateFr, ouvrirFichier, lireFichier, tailleFichier } from '@/components/commercial/achats';
import { TYPES_STOCK, StatutStock, MOUVEMENTS } from '@/components/commercial/stock';

const ACTIONS = {
  COM_STOCK_CREATION: 'Document saisi', COM_STOCK_MODIFICATION: 'Brouillon modifié', COM_STOCK_SOUMISSION: 'Soumis pour validation',
  COM_STOCK_RENVOI: 'Renvoyé pour correction', COM_STOCK_VALIDATION: 'Validé : stock mis à jour', COM_STOCK_ANNULATION: 'Annulé : mouvements neutralisés',
  COM_STOCK_PIECE_AJOUT: 'Pièce jointe',
};
const CLASSES = { COM_STOCK_VALIDATION: 'cm-f-ok', COM_STOCK_ANNULATION: 'cm-f-ko', COM_STOCK_RENVOI: 'cm-f-info' };

function Pieces({ d, onMaj }) {
  const toast = useToast();
  const input = useRef(null);
  const [enCours, setEnCours] = useState(false);
  const joindre = async (e) => {
    const fichier = e.target.files?.[0];
    e.target.value = '';
    if (!fichier) return;
    if (fichier.size > 5 * 1024 * 1024) { toast('Fichier trop volumineux (5 Mo au plus).', 'error'); return; }
    setEnCours(true);
    try {
      const r = await api.post(`/commercial/stock/documents/${d.id}/pieces`, { nom_fichier: fichier.name, data_base64: await lireFichier(fichier) });
      if (r?.error) { toast(r.error, 'error'); return; }
      toast('Pièce jointe.', 'success'); onMaj(r);
    } catch (err) { toast(err.message, 'error'); } finally { setEnCours(false); }
  };
  const pieces = d.pieces.filter((p) => !p.retire);
  return (
    <Section titre={`Pièces justificatives (${pieces.length})`}>
      {pieces.length === 0 ? <p className="cm-aide">Aucune pièce (PV de casse, bon interne, feuille de comptage…).</p> : (
        <ul className="cm-pieces">
          {pieces.map((p) => (
            <li key={p.id} title={`SHA-256 ${p.sha256}`}>
              <span aria-hidden="true">📎</span>
              <span className="cm-nom">{p.nom}<span className="cm-sous">{tailleFichier(p.taille)} · {p.ajoute_par_nom} · {dateFr(p.ajoute_le)}</span></span>
              <button type="button" className="cm-lien" onClick={() => ouvrirFichier(api, `/commercial/stock/documents/${d.id}/pieces/${p.id}`, p.nom, p.mime, toast)}>Ouvrir</button>
            </li>
          ))}
        </ul>
      )}
      {d.droits.joindre && (
        <>
          <input ref={input} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx" onChange={joindre} hidden />
          <button type="button" className="cm-btn cm-secondaire" style={{ marginTop: 10 }} onClick={() => input.current?.click()} disabled={enCours}>
            {enCours ? 'Envoi…' : '+ Joindre une pièce'}
          </button>
        </>
      )}
    </Section>
  );
}

export default function StockDocPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState('');
  useEffect(() => {
    setD(null);
    api.get(`/commercial/stock/documents/${id}`).then((r) => { if (r?.error) setErreur(r.error); else { setD(r); setErreur(''); } });
  }, [id]);

  const agir = async (cle, appel, message) => {
    setEnCours(cle); setErreur('');
    const r = await appel();
    setEnCours('');
    if (r?.error) { setErreur(r.error); return null; }
    if (message) toast(message, 'success');
    if (r?.id) setD(r);
    return r;
  };
  const soumettre = () => agir('soumettre', () => api.post(`/commercial/stock/documents/${id}/soumission`, {}), 'Document soumis pour validation.');
  const valider = () => {
    const effet = d.type === 'inventaire' ? 'Le stock théorique sera relevé maintenant et les écarts enregistrés.' : 'Le stock sera mis à jour immédiatement.';
    if (!window.confirm(`Valider ${d.numero} ?\n\n${effet}\nUn document validé ne se modifie plus ; il ne peut qu'être annulé, avec un motif.`)) return;
    agir('valider', () => api.post(`/commercial/stock/documents/${id}/validation`, {}), `${d.numero} validé : stock mis à jour.`);
  };
  const renvoyer = () => {
    const motif = window.prompt(`Renvoyer ${d.numero} à son auteur pour correction.\n\nQue faut-il corriger ?`) || '';
    if (!motif.trim()) return;
    agir('renvoyer', () => api.post(`/commercial/stock/documents/${id}/renvoi`, { motif }), 'Document renvoyé pour correction.');
  };
  const annuler = () => {
    const motif = window.prompt(`Annuler ${d.numero} ?\nSes mouvements restent visibles, marqués « annulés », et la valorisation est recalculée.\n\nMotif de l'annulation :`) || '';
    if (!motif.trim()) return;
    agir('annuler', () => api.post(`/commercial/stock/documents/${id}/annulation`, { motif }), 'Document annulé.');
  };
  const supprimer = async () => {
    if (!window.confirm('Supprimer ce brouillon ?')) return;
    const r = await agir('supprimer', () => api.delete(`/commercial/stock/documents/${id}`), 'Brouillon supprimé.');
    if (r) navigate(`/commercial/stock/${TYPES_STOCK[d.type].route}`);
  };

  const retour = d ? `/commercial/stock/${TYPES_STOCK[d.type].route}` : '/commercial/stock';
  if (!d) return <div className="cm-page"><Link to={retour} className="cm-retour">‹ Stock</Link>{erreur ? <div className="cm-erreur">{erreur}</div> : <div className="loading-msg">Chargement…</div>}</div>;

  const t = TYPES_STOCK[d.type];
  const fil = d.historique.map((h) => ({ le: h.le, cls: CLASSES[h.action] || '', titre: ACTIONS[h.action] || h.action, par: h.par_nom,
    mot: h.nouvelle_valeur?.motif || h.nouvelle_valeur?.nom || '' }));
  const valeurMvts = d.mouvements.filter((m) => !m.annule && m.valeur !== null).reduce((s, m) => s + m.sens * m.valeur, 0);
  return (
    <div className="cm-page">
      <Link to={retour} className="cm-retour">‹ {t.pluriel}</Link>
      <div className="cm-fiche-tete">
        <div>
          <h2><span className="cm-code" style={{ fontSize: 15 }}>{d.numero}</span>{t.libelle} <StatutStock statut={d.statut} /></h2>
          <span className="cm-sous">
            Saisi par {d.cree_par_nom} le {dateFr(d.cree_le, true)}
            {d.valide_le ? ` · validé par ${d.valide_par_nom} le ${dateFr(d.valide_le, true)}` : ''}
          </span>
        </div>
        <div className="cm-actions">
          {d.droits.modifier && <button type="button" className="cm-btn cm-danger" onClick={supprimer} disabled={Boolean(enCours)}>Supprimer</button>}
          {d.droits.annuler && <button type="button" className="cm-btn cm-danger" onClick={annuler} disabled={Boolean(enCours)}>Annuler le document</button>}
          {d.droits.modifier && <button type="button" className="cm-btn cm-secondaire" onClick={() => navigate(`/commercial/stock/documents/${d.id}/modifier`)}>Modifier</button>}
          {d.droits.soumettre && <button type="button" className="cm-btn cm-primaire" onClick={soumettre} disabled={Boolean(enCours)}>Soumettre pour validation</button>}
          {d.droits.renvoyer && <button type="button" className="cm-btn cm-secondaire" onClick={renvoyer} disabled={Boolean(enCours)}>Renvoyer pour correction</button>}
          {d.droits.valider && <button type="button" className="cm-btn cm-primaire" onClick={valider} disabled={Boolean(enCours)}>{enCours === 'valider' ? 'Validation…' : 'Valider'}</button>}
        </div>
      </div>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      {d.droits.auto_validation_interdite && <div className="cm-note">Vous avez saisi ce document : un autre valideur doit le valider (séparation des tâches).</div>}
      {d.statut === 'brouillon' && d.motif_renvoi && <div className="cm-note" style={{ background: '#eff6ff' }}><strong>À corriger :</strong> {d.motif_renvoi}</div>}
      {d.statut === 'a_valider' && !d.droits.valider && !d.droits.auto_validation_interdite && <div className="cm-note">En attente de validation : le stock n'a pas encore bougé.</div>}
      {d.statut === 'annule' && <div className="cm-erreur"><strong>Document annulé</strong> le {dateFr(d.annule_le, true)} par {d.annule_par_nom} : « {d.motif_annulation} »</div>}

      <div className="cm-deux">
        <div>
          <Section titre="Document">
            <dl className="cm-infos">
              <div><dt>{d.type === 'transfert' ? 'Départ' : 'Magasin'}</dt><dd>{d.magasin_code} — {d.magasin_nom}</dd></div>
              {d.type === 'transfert' && <div><dt>Destination</dt><dd>{d.magasin_dest_code} — {d.magasin_dest_nom}</dd></div>}
              <div><dt>Date</dt><dd>{dateFr(d.date_document)}</dd></div>
              <div><dt>Motif</dt><dd>{d.motif || '—'}</dd></div>
            </dl>
            {d.observations && <p className="cm-aide" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}><strong>Observations :</strong> {d.observations}</p>}
          </Section>
          <Section titre={`Articles (${d.lignes.length})`}>
            <table className="cm-lignes cm-bc-lecture">
              <thead>
                <tr>
                  <th>Article</th>
                  {d.type === 'inventaire'
                    ? <><th style={{ textAlign: 'right' }}>{d.statut === 'valide' || d.statut === 'annule' ? 'Théorique' : 'Stock actuel'}</th><th style={{ textAlign: 'right' }}>Compté</th><th style={{ textAlign: 'right' }}>Écart</th></>
                    : <th style={{ textAlign: 'right' }}>Quantité</th>}
                  {d.type === 'entree' && <th style={{ textAlign: 'right' }}>Coût unitaire</th>}
                </tr>
              </thead>
              <tbody>
                {d.lignes.map((l) => {
                  const theo = l.quantite_theorique ?? l.stock_actuel;
                  const ecart = l.quantite_comptee === null ? null : Math.round((l.quantite_comptee - theo) * 1000) / 1000;
                  return (
                    <tr key={l.id}>
                      <td className="cm-l-article"><strong>{l.designation}</strong><span className="cm-sous">{l.reference}</span></td>
                      {d.type === 'inventaire' ? (
                        <>
                          <td className="cm-num"><span className="cm-l-lib">Théorique</span>{fmtQte(theo)} {l.unite_stock}</td>
                          <td className="cm-num"><span className="cm-l-lib">Compté</span>{fmtQte(l.quantite_comptee)}</td>
                          <td className="cm-num"><span className="cm-l-lib">Écart</span>
                            {ecart === null ? '—' : <strong style={{ color: ecart < 0 ? '#b91c1c' : ecart > 0 ? '#047857' : undefined }}>{ecart > 0 ? '+' : ''}{fmtQte(ecart)}</strong>}
                          </td>
                        </>
                      ) : (
                        <td className="cm-num"><span className="cm-l-lib">Qté</span>{fmtQte(l.quantite)} {l.unite}{l.coefficient !== 1 && <span className="cm-conv">= {fmtQte(l.quantite_stock)} {l.unite_stock}</span>}</td>
                      )}
                      {d.type === 'entree' && <td className="cm-num"><span className="cm-l-lib">Coût</span>{fmtMontant(l.cout_unitaire, '')} / {l.unite}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>
          {d.mouvements.length > 0 && (
            <Section titre="Mouvements de stock produits">
              <table className="cm-lignes cm-bc-lecture">
                <thead><tr><th>Mouvement</th><th>Magasin</th><th style={{ textAlign: 'right' }}>Quantité</th><th style={{ textAlign: 'right' }}>Coût unitaire</th><th style={{ textAlign: 'right' }}>Valeur</th></tr></thead>
                <tbody>
                  {d.mouvements.map((m) => (
                    <tr key={m.id} className={m.annule ? 'cm-retiree' : ''}>
                      <td>{MOUVEMENTS[m.type] || m.type}{m.annule && <span className="cm-pastille cm-rouge" style={{ marginLeft: 6 }}>Annulé</span>}</td>
                      <td>{m.magasin_code}</td>
                      <td className="cm-num">{m.sens > 0 ? '+' : '−'}{fmtQte(m.quantite)} {m.unite}</td>
                      <td className="cm-num">{m.cout_unitaire === null ? 'à valoriser' : fmtMontant(Math.round(m.cout_unitaire * 100) / 100, '')}</td>
                      <td className="cm-num">{fmtMontant(m.valeur, '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {d.statut === 'valide' && <p className="cm-aide" style={{ marginTop: 8 }}>Effet net sur la valeur du stock : <strong>{fmtMontant(Math.round(valeurMvts * 100) / 100)}</strong></p>}
            </Section>
          )}
        </div>
        <div>
          <Pieces d={d} onMaj={setD} />
          <Section titre="Historique">
            <ol className="cm-fil">
              {fil.map((e, i) => (
                <li key={i} className={e.cls}>
                  <strong>{e.titre}</strong>
                  <span className="cm-quand">{dateFr(e.le, true)} · {e.par || 'système'}</span>
                  {e.mot && <div className="cm-mot">{e.mot}</div>}
                </li>
              ))}
            </ol>
            <p className="cm-aide">Cet historique ne peut être ni modifié ni effacé.</p>
          </Section>
        </div>
      </div>
    </div>
  );
}
