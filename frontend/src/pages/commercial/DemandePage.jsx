// NJ COMMERCIAL — fiche d'une demande d'achat : contenu, stock, décision, pièces, historique.
// Les boutons affichés suivent les droits calculés par le serveur (qui revérifie tout).
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { Section, fmtMontant } from '@/components/commercial/ui';
import { StatutDemande, Priorite, EncartStock, dateFr, STATUTS, StatutBon, EtatCommande } from '@/components/commercial/achats';

const DECISIONS = {
  soumise: ['Soumise', 'cm-f-info'], approuvee: ['Approuvée', 'cm-f-ok'], renvoyee: ['Renvoyée pour correction', 'cm-f-info'],
  rejetee: ['Rejetée', 'cm-f-ko'], annulee: ['Annulée', 'cm-f-ko'],
};
const ETAPES = { gestionnaire: 'revalidation demandée par les achats', demandeur: 'demandeur', achats: 'étape achats', direction: 'étape direction', achats_direction: 'achats et direction', valideur: 'valideur' };
const ACTIONS = {
  COM_DA_CREATION: 'Demande créée', COM_DA_MODIFICATION: 'Demande modifiée', COM_DA_PIECE_AJOUT: 'Pièce jointe ajoutée', COM_DA_PIECE_RETRAIT: 'Pièce retirée',
};
const taille = (o) => (o > 1048576 ? `${(o / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(o / 1024))} Ko`);

function Decision({ d, onFait }) {
  const toast = useToast();
  const [mot, setMot] = useState('');
  const [enCours, setEnCours] = useState('');
  const [erreur, setErreur] = useState('');
  const agir = async (decision) => {
    if (decision !== 'approuver' && mot.trim().length < 3) { setErreur(decision === 'rejeter' ? 'Indiquez le motif du rejet.' : 'Indiquez ce qu\'il faut corriger.'); return; }
    if (decision === 'rejeter' && !window.confirm(`Rejeter définitivement la demande ${d.numero} ?`)) return;
    setEnCours(decision); setErreur('');
    const r = await api.post(`/commercial/demandes/${d.id}/decision`, { decision, commentaire: mot.trim() });
    setEnCours('');
    if (r?.error) { setErreur(r.error); return; }
    toast({ approuver: r.statut === 'examen_direction' ? 'Approuvée : la demande passe à la direction.' : 'Demande approuvée.', renvoyer: 'Demande renvoyée au demandeur.', rejeter: 'Demande rejetée.' }[decision], 'success');
    onFait(r);
  };
  return (
    <div className="cm-decision">
      <h4>{d.statut === 'examen_direction' ? 'Votre autorisation est attendue (direction)' : 'Votre autorisation est attendue (achats)'}</h4>
      <p className="cm-aide">
        {d.direction_requise && d.statut === 'examen_achats'
          ? `Montant estimé au-delà du seuil (${fmtMontant(d.seuil_applique)}) : la direction validera ensuite, sauf si vous en avez le droit.`
          : 'Vérifiez le besoin, le stock et le fournisseur avant de décider.'}
      </p>
      {erreur && <div className="cm-erreur" role="alert" style={{ marginTop: 8 }}>{erreur}</div>}
      <label htmlFor="mot-decision" className="cm-aide" style={{ display: 'block', marginTop: 8, fontWeight: 700 }}>Commentaire (obligatoire pour renvoyer ou rejeter)</label>
      <textarea id="mot-decision" value={mot} onChange={(e) => setMot(e.target.value)} maxLength={2000} />
      <div className="cm-actions">
        <button type="button" className="cm-btn cm-danger" onClick={() => agir('rejeter')} disabled={Boolean(enCours)}>Rejeter</button>
        <button type="button" className="cm-btn cm-secondaire" onClick={() => agir('renvoyer')} disabled={Boolean(enCours)}>Renvoyer pour correction</button>
        <button type="button" className="cm-btn cm-primaire" onClick={() => agir('approuver')} disabled={Boolean(enCours)}>{enCours === 'approuver' ? 'Approbation…' : 'Approuver'}</button>
      </div>
    </div>
  );
}

function Pieces({ d, onMaj }) {
  const toast = useToast();
  const input = useRef(null);
  const [enCours, setEnCours] = useState(false);
  const joindre = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast('Fichier trop volumineux (5 Mo au plus).', 'error'); return; }
    const lecteur = new FileReader();
    lecteur.onload = async () => {
      setEnCours(true);
      const r = await api.post(`/commercial/demandes/${d.id}/pieces`, { nom_fichier: f.name, data_base64: lecteur.result });
      setEnCours(false);
      if (r?.error) { toast(r.error, 'error'); return; }
      toast('Pièce jointe ajoutée.', 'success'); onMaj(r);
    };
    lecteur.readAsDataURL(f);
  };
  const ouvrir = async (p) => {
    const r = await api.fichier(`/commercial/demandes/${d.id}/pieces/${p.id}`);
    if (r.error) { toast(r.error, 'error'); return; }
    const url = URL.createObjectURL(r.blob);
    const a = document.createElement('a');
    a.href = url; a.download = p.nom; a.rel = 'noopener';
    if (/pdf|image/.test(p.mime)) { a.target = '_blank'; a.removeAttribute('download'); }
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  const retirer = async (p) => {
    const motif = window.prompt(`Retirer « ${p.nom} » ? La pièce reste conservée et le retrait est tracé.\n\nMotif :`) || '';
    if (!motif.trim()) return;
    const r = await api.post(`/commercial/demandes/${d.id}/pieces/${p.id}/retrait`, { motif });
    if (r?.error) { toast(r.error, 'error'); return; }
    onMaj(r);
  };
  const peutRetirer = ['brouillon', 'a_corriger'].includes(d.statut);
  return (
    <Section titre={`Pièces justificatives (${d.documents.filter((p) => !p.retire).length})`}>
      {d.documents.length === 0 ? <p className="cm-aide">Aucune pièce jointe.</p> : (
        <ul className="cm-pieces">
          {d.documents.map((p) => (
            <li key={p.id} className={p.retire ? 'cm-retiree' : ''} title={p.retire ? `Retirée le ${dateFr(p.retire_le, true)} : ${p.motif_retrait}` : `SHA-256 ${p.sha256}`}>
              <span aria-hidden="true">📎</span>
              <span className="cm-nom">{p.nom}<span className="cm-sous">{taille(p.taille)} · {p.ajoute_par_nom} · {dateFr(p.ajoute_le)}</span></span>
              {!p.retire && <button type="button" className="cm-lien" onClick={() => ouvrir(p)}>Ouvrir</button>}
              {!p.retire && peutRetirer && d.droits.joindre && <button type="button" className="cm-lien" style={{ color: '#b91c1c' }} onClick={() => retirer(p)}>Retirer</button>}
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
          <p className="cm-aide" style={{ marginTop: 6 }}>PDF, image, Word ou Excel — 5 Mo au plus.</p>
        </>
      )}
    </Section>
  );
}

export default function DemandePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState('');
  const charger = async () => {
    const r = await api.get(`/commercial/demandes/${id}`);
    if (r?.error) { setErreur(r.error); return; }
    setD(r); setErreur('');
  };
  useEffect(() => { charger(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const soumettre = async () => {
    const r = await api.post(`/commercial/demandes/${id}/soumission`, {});
    if (r?.error) { setErreur(r.error); return; }
    toast(`Demande ${r.numero} soumise : les responsables des achats sont prévenus.`, 'success'); setD(r);
  };
  const annuler = async () => {
    const motif = window.prompt(`Annuler la demande ${d.numero} ?\n\nMotif de l'annulation :`) || '';
    if (!motif.trim()) return;
    const r = await api.post(`/commercial/demandes/${id}/annulation`, { motif });
    if (r?.error) { setErreur(r.error); return; }
    toast('Demande annulée.', 'success'); setD(r);
  };
  const supprimer = async () => {
    if (!window.confirm(`Supprimer le brouillon ${d.numero} ?`)) return;
    const r = await api.delete(`/commercial/demandes/${id}`);
    if (r?.error) { setErreur(r.error); return; }
    toast('Brouillon supprimé.', 'success'); navigate('/commercial/demandes');
  };

  if (!d) return <div className="cm-page">{erreur ? <><Link to="/commercial/demandes" className="cm-retour">‹ Demandes d'achat</Link><div className="cm-erreur">{erreur}</div></> : <div className="loading-msg">Chargement…</div>}</div>;

  // Fil chronologique : décisions + actions tracées (création, modifications, pièces).
  const fil = [
    ...d.decisions.map((x) => ({ le: x.le, cls: DECISIONS[x.decision]?.[1], titre: `${DECISIONS[x.decision]?.[0] || x.decision} — ${ETAPES[x.etape] || x.etape}`, par: x.par_nom, mot: x.commentaire, montant: x.decision === 'soumise' ? x.montant : null })),
    ...d.historique.filter((h) => ACTIONS[h.action]).map((h) => ({ le: h.le, cls: '', titre: ACTIONS[h.action], par: h.par_nom,
      mot: h.action.includes('PIECE') ? (h.nouvelle_valeur?.nom || h.nouvelle_valeur?.motif || '') : '' })),
  ].sort((a, b) => new Date(a.le) - new Date(b.le));
  const soumise = d.nb_soumissions > 0;

  return (
    <div className="cm-page">
      <Link to="/commercial/demandes" className="cm-retour">‹ Demandes d'achat</Link>
      <div className="cm-fiche-tete">
        <div>
          <h2><span className="cm-code" style={{ fontSize: 15 }}>{d.numero}</span> Demande d'achat <StatutDemande statut={d.statut} /> <EtatCommande etat={d.etat_commande} /></h2>
          <span className="cm-sous">Créée le {dateFr(d.cree_le, true)} par {d.demandeur_nom}{d.soumise_le ? ` · soumise le ${dateFr(d.soumise_le, true)}` : ''}</span>
        </div>
        <div className="cm-actions">
          {d.droits.supprimer && <button type="button" className="cm-btn cm-danger" onClick={supprimer}>Supprimer</button>}
          {d.droits.annuler && <button type="button" className="cm-btn cm-danger" onClick={annuler}>Annuler la demande</button>}
          {d.droits.modifier && <button type="button" className="cm-btn cm-secondaire" onClick={() => navigate(`/commercial/demandes/${d.id}/modifier`)}>Modifier</button>}
          {d.droits.preparer_bc && <button type="button" className="cm-btn cm-primaire" onClick={() => navigate(`/commercial/bons/nouveau?demande=${d.id}`)}>Préparer un bon de commande</button>}
          {d.droits.soumettre && <button type="button" className="cm-btn cm-primaire" onClick={soumettre}>{d.statut === 'a_corriger' ? 'Soumettre à nouveau' : 'Soumettre pour autorisation'}</button>}
        </div>
      </div>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      {d.statut === 'a_corriger' && (() => {
        const renvoi = [...d.decisions].reverse().find((x) => x.decision === 'renvoyee');
        return renvoi && <div className="cm-note"><strong>À corriger</strong> — {renvoi.par_nom} : « {renvoi.commentaire} »</div>;
      })()}
      {d.droits.auto_validation_interdite && <div className="cm-note">Vous avez le droit d'autoriser cette étape, mais pas pour votre propre demande : un autre valideur décidera.</div>}
      {d.droits.decider && <Decision d={d} onFait={setD} />}

      <div className="cm-deux">
        <div>
          <Section titre="Besoin">
            <dl className="cm-infos">
              <div><dt>Magasin</dt><dd>{d.magasin_code} — {d.magasin_nom}</dd></div>
              <div><dt>Service</dt><dd>{d.service || '—'}</dd></div>
              <div><dt>Priorité</dt><dd><Priorite valeur={d.priorite} /></dd></div>
              <div><dt>Fournisseur proposé</dt><dd>{d.fournisseur_nom || '—'}</dd></div>
              <div><dt>Montant estimé</dt><dd>{soumise ? fmtMontant(d.montant_estime) : '—'}{d.montant_incomplet && <span className="cm-sous">certains articles sans prix</span>}</dd></div>
              <div><dt>Circuit</dt><dd>{!soumise ? '—' : d.direction_requise ? 'Achats puis direction' : 'Achats'}</dd></div>
            </dl>
            <p style={{ margin: '14px 0 0', fontSize: 13.5, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}><strong>Motif : </strong>{d.motif || '—'}</p>
            {d.justification_stock && <p className="cm-aide" style={{ marginTop: 8 }}><strong>Justification du réapprovisionnement :</strong> {d.justification_stock}</p>}
            {d.commentaire && <p className="cm-aide" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}><strong>Commentaire :</strong> {d.commentaire}</p>}
          </Section>
          <Section titre={`Articles (${d.lignes.length})`}>
            <table className="cm-lignes">
              <thead><tr><th>Article</th><th style={{ textAlign: 'right' }}>Quantité</th><th>{soumise ? 'Stock à la soumission' : 'Stock du magasin'}</th><th>Fournisseur</th></tr></thead>
              <tbody>
                {d.lignes.map((l) => (
                  <tr key={l.id}>
                    <td className="cm-l-article"><strong>{l.designation}</strong><span className="cm-sous">{l.reference} · {l.famille_nom}{l.prix_estime !== null ? ` · ${fmtMontant(l.prix_estime)} / ${l.unite}` : ''}</span></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><strong>{Number(l.quantite).toLocaleString('fr-FR')}</strong> {l.unite}
                      {l.coefficient !== 1 && <span className="cm-conv">= {Number(l.quantite_stock).toLocaleString('fr-FR')} {l.unite_stock}</span>}</td>
                    <td className="cm-l-stock">
                      <EncartStock stock={soumise && l.stock_constate ? l.stock_constate : l.stock_actuel} unite={l.unite_stock || l.unite} />
                      {soumise && l.stock_constate && l.stock_actuel.suivi && l.stock_actuel.disponible !== l.stock_constate.disponible && (
                        <span className="cm-sous">Aujourd'hui : {Number(l.stock_actuel.disponible).toLocaleString('fr-FR')} {l.unite_stock || l.unite}</span>
                      )}
                    </td>
                    <td className="cm-l-fournisseur">{l.fournisseur_nom || (l.fournisseurs_proposes.length ? <span className="cm-sous" style={{ marginTop: 0 }}>Habituels : {l.fournisseurs_proposes.map((x) => x.nom).join(', ')}</span> : '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="cm-aide" style={{ marginTop: 8 }}>Une demande ne modifie jamais le stock. Les réservations ne sont pas encore gérées.</p>
          </Section>
        </div>
        <div>
          <Section titre="Historique">
            <ol className="cm-fil">
              {fil.map((e, i) => (
                <li key={i} className={e.cls}>
                  <strong>{e.titre}</strong>
                  <span className="cm-quand">{dateFr(e.le, true)} · {e.par || 'système'}{e.montant ? ` · ${fmtMontant(e.montant)}` : ''}</span>
                  {e.mot && <div className="cm-mot">{e.mot}</div>}
                </li>
              ))}
            </ol>
            <p className="cm-aide">Statut actuel : {STATUTS[d.statut]?.[0]}. Cet historique ne peut être ni modifié ni effacé.</p>
          </Section>
          {(d.bons?.length > 0 || d.statut === 'approuvee') && (
            <Section titre={`Bons de commande (${d.bons?.length || 0})`}>
              {!d.bons?.length ? <p className="cm-aide">Aucun bon de commande pour l'instant.</p> : (
                <ul className="cm-pieces">
                  {d.bons.map((b) => (
                    <li key={b.id}>
                      <span className="cm-nom">
                        <Link to={`/commercial/bons/${b.id}`}>{b.statut === 'brouillon' ? 'Brouillon' : b.numero_complet}</Link>
                        <span className="cm-sous">{b.fournisseur_nom} · {fmtMontant(b.total_ttc, b.devise)} TTC</span>
                      </span>
                      <StatutBon statut={b.statut} />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}
          <Pieces d={d} onMaj={setD} />
        </div>
      </div>
    </div>
  );
}
