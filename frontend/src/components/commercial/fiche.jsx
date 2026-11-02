// NJ COMMERCIAL — briques des fiches de documents à circuit (réceptions, retours,
// factures fournisseurs) : chargement, actions, pièces, mouvements, historique.
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { Section, fmtMontant, fmtQte } from '@/components/commercial/ui';
import { dateFr, ouvrirFichier, lireFichier, tailleFichier } from '@/components/commercial/achats';
import { MOUVEMENTS } from '@/components/commercial/stock';

// Chargement d'une fiche + exécution d'une action qui renvoie la fiche à jour.
export function useFiche(url) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState('');
  useEffect(() => {
    setD(null);
    api.get(url).then((r) => { if (r?.error) setErreur(r.error); else { setD(r); setErreur(''); } });
  }, [url]);
  const agir = async (cle, appel, message) => {
    setEnCours(cle); setErreur('');
    const r = await appel();
    setEnCours('');
    if (r?.error) { setErreur(r.error); return null; }
    if (message) toast(message, 'success');
    if (r?.id) setD(r);
    return r;
  };
  return { d, setD, erreur, setErreur, enCours, agir };
}

// Boutons du circuit commun, selon les droits calculés par le serveur.
export function ActionsCircuit({ d, base, agir, enCours, onSupprime, onModifier, libelle, extra }) {
  const valider = () => {
    if (!window.confirm(`Valider ${d.numero} ?\n\nUn document validé ne se modifie plus ; il ne peut qu'être annulé, avec un motif.`)) return;
    agir('valider', () => api.post(`${base}/${d.id}/validation`, {}), `${d.numero} validé.`);
  };
  const renvoyer = () => {
    const motif = window.prompt(`Renvoyer ${d.numero} à son auteur pour correction.\n\nQue faut-il corriger ?`) || '';
    if (motif.trim()) agir('renvoyer', () => api.post(`${base}/${d.id}/renvoi`, { motif }), 'Document renvoyé pour correction.');
  };
  const annuler = () => {
    const motif = window.prompt(`Annuler ${d.numero} ?\nLe document reste consultable, marqué « annulé »${libelle?.stock ? ', et ses mouvements de stock sont neutralisés' : ''}.\n\nMotif de l'annulation :`) || '';
    if (motif.trim()) agir('annuler', () => api.post(`${base}/${d.id}/annulation`, { motif }), 'Document annulé.');
  };
  const supprimer = async () => {
    if (!window.confirm('Supprimer ce brouillon ?')) return;
    const r = await agir('supprimer', () => api.delete(`${base}/${d.id}`), 'Brouillon supprimé.');
    if (r) onSupprime();
  };
  const soumettre = () => agir('soumettre', () => api.post(`${base}/${d.id}/soumission`, {}), 'Document soumis pour validation.');
  const occupe = Boolean(enCours);
  return (
    <div className="cm-actions">
      {d.droits.modifier && <button type="button" className="cm-btn cm-danger" onClick={supprimer} disabled={occupe}>Supprimer</button>}
      {d.droits.annuler && <button type="button" className="cm-btn cm-danger" onClick={annuler} disabled={occupe}>Annuler</button>}
      {extra}
      {d.droits.modifier && <button type="button" className="cm-btn cm-secondaire" onClick={onModifier}>Modifier</button>}
      {d.droits.soumettre && <button type="button" className="cm-btn cm-primaire" onClick={soumettre} disabled={occupe}>Soumettre pour validation</button>}
      {d.droits.renvoyer && <button type="button" className="cm-btn cm-secondaire" onClick={renvoyer} disabled={occupe}>Renvoyer pour correction</button>}
      {d.droits.valider && <button type="button" className="cm-btn cm-primaire" onClick={valider} disabled={occupe}>{enCours === 'valider' ? 'Validation…' : 'Valider'}</button>}
    </div>
  );
}

// Bandeaux d'état communs.
export function EtatCircuit({ d, attente = 'En attente de validation.' }) {
  return (
    <>
      {d.droits.auto_validation_interdite && <div className="cm-note">Vous avez saisi ce document : un autre valideur doit le valider (séparation des tâches).</div>}
      {d.statut === 'brouillon' && d.motif_renvoi && <div className="cm-note" style={{ background: '#eff6ff' }}><strong>À corriger :</strong> {d.motif_renvoi}</div>}
      {d.statut === 'a_valider' && !d.droits.valider && !d.droits.auto_validation_interdite && <div className="cm-note">{attente}</div>}
      {d.statut === 'annule' && <div className="cm-erreur"><strong>Document annulé</strong> le {dateFr(d.annule_le, true)} par {d.annule_par_nom} : « {d.motif_annulation} »</div>}
    </>
  );
}

export function PiecesDoc({ d, base, onMaj, aide = 'Aucune pièce jointe.' }) {
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
      const r = await api.post(`${base}/${d.id}/pieces`, { nom_fichier: fichier.name, data_base64: await lireFichier(fichier) });
      if (r?.error) { toast(r.error, 'error'); return; }
      toast('Pièce jointe.', 'success'); onMaj(r);
    } catch (err) { toast(err.message, 'error'); } finally { setEnCours(false); }
  };
  return (
    <Section titre={`Pièces justificatives (${d.pieces.length})`}>
      {d.pieces.length === 0 ? <p className="cm-aide">{aide}</p> : (
        <ul className="cm-pieces">
          {d.pieces.map((p) => (
            <li key={p.id} title={`SHA-256 ${p.sha256}`}>
              <span aria-hidden="true">📎</span>
              <span className="cm-nom">{p.nom}<span className="cm-sous">{tailleFichier(p.taille)} · {p.ajoute_par_nom} · {dateFr(p.ajoute_le)}</span></span>
              <button type="button" className="cm-lien" onClick={() => ouvrirFichier(api, `${base}/${d.id}/pieces/${p.id}`, p.nom, p.mime, toast)}>Ouvrir</button>
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

export function MouvementsDoc({ mouvements }) {
  if (!mouvements?.length) return null;
  const valeurs = mouvements.some((m) => m.valeur !== null);
  return (
    <Section titre="Mouvements de stock produits">
      <table className="cm-lignes cm-bc-lecture">
        <thead><tr><th>Mouvement</th><th>Magasin</th><th style={{ textAlign: 'right' }}>Quantité</th>{valeurs && <><th style={{ textAlign: 'right' }}>Coût unitaire</th><th style={{ textAlign: 'right' }}>Valeur</th></>}</tr></thead>
        <tbody>
          {mouvements.map((m) => (
            <tr key={m.id} className={m.annule ? 'cm-retiree' : ''}>
              <td>{MOUVEMENTS[m.type] || m.type}{m.annule && <span className="cm-pastille cm-rouge" style={{ marginLeft: 6 }}>Annulé</span>}</td>
              <td>{m.magasin_code}</td>
              <td className="cm-num">{m.sens > 0 ? '+' : '−'}{fmtQte(m.quantite)} {m.unite}</td>
              {valeurs && <td className="cm-num">{m.cout_unitaire === null ? '—' : fmtMontant(Math.round(m.cout_unitaire * 100) / 100, '')}</td>}
              {valeurs && <td className="cm-num">{fmtMontant(m.valeur, '')}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

const ACTIONS = {
  CREATION: 'Document saisi', MODIFICATION: 'Brouillon modifié', SOUMISSION: 'Soumis pour validation', RENVOI: 'Renvoyé pour correction',
  VALIDATION: 'Validé', ANNULATION: 'Annulé', PIECE_AJOUT: 'Pièce jointe', SUPPRESSION: 'Supprimé',
};
const CLASSES = { VALIDATION: 'cm-f-ok', ANNULATION: 'cm-f-ko', RENVOI: 'cm-f-info' };
export function HistoriqueDoc({ historique }) {
  return (
    <Section titre="Historique">
      <ol className="cm-fil">
        {historique.map((h, i) => {
          const cle = h.action.replace(/^COM_(RECEPTION|RETOUR_FOURN|FACTURE_FOURN)_/, '');
          return (
            <li key={i} className={CLASSES[cle] || ''}>
              <strong>{ACTIONS[cle] || h.action}</strong>
              <span className="cm-quand">{dateFr(h.le, true)} · {h.par_nom || 'système'}</span>
              {(h.nouvelle_valeur?.motif || h.nouvelle_valeur?.nom) && <div className="cm-mot">{h.nouvelle_valeur.motif || h.nouvelle_valeur.nom}</div>}
            </li>
          );
        })}
      </ol>
      <p className="cm-aide">Cet historique ne peut être ni modifié ni effacé.</p>
    </Section>
  );
}

// Liste filtrable commune (numéro, date, statut).
export const STATUTS_DOC = { brouillon: 'Brouillon', a_valider: 'À valider', valide: 'Validé', annule: 'Annulé' };
