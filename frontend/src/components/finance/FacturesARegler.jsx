// NJ FINANCE F6 — dans la saisie de caisse : factures fournisseurs ouvertes du
// bénéficiaire, à relier à la sortie qu'on enregistre. Le règlement est créé
// juste après l'enregistrement de la sortie (en ligne seulement) ; sinon il se
// relie plus tard depuis la facture (Achats → Relier un paiement).
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { fmtCompta, fmtDate } from '@/pages/comptabilite/commun';

/**
 * @param {object} p
 * @param {string|number} p.tiersId   bénéficiaire choisi dans le registre
 * @param {number} p.montant          montant de la sortie
 * @param {object} p.choix            { [cle]: montant saisi }
 * @param {function} p.onChoix        (nouveauChoix, affectations[]) => void
 */
export default function FacturesARegler({ tiersId, montant, choix, onChoix, sens = 'fournisseur' }) {
  const [factures, setFactures] = useState(null);
  useEffect(() => {
    let annule = false;
    setFactures(null);
    if (!tiersId || !navigator.onLine) return undefined;
    api.get(`/finance/${sens === 'client' ? 'ventes' : 'achats'}/ouvertes?tiers_id=${tiersId}`).then((r) => { if (!annule) setFactures(Array.isArray(r) ? r : []); });
    return () => { annule = true; };
  }, [tiersId, sens]);
  if (!factures || factures.length === 0) return null;
  const total = Object.values(choix).reduce((t, v) => t + (Number(String(v).replace(',', '.')) || 0), 0);
  const maj = (cle, valeur) => {
    const suivant = { ...choix };
    if (valeur === null) delete suivant[cle]; else suivant[cle] = valeur;
    onChoix(suivant, factures.filter((f) => suivant[f.cle] !== undefined)
      .map((f) => ({ facture_type: f.origine, facture_id: f.id, montant: suivant[f.cle] })));
  };
  const cocher = (f, oui) => {
    if (!oui) { maj(f.cle, null); return; }
    const libre = Math.max((Number(montant) || 0) - total, 0);
    maj(f.cle, String(Math.min(Number(f.reste), libre || Number(f.reste))));
  };
  return (
    <div className="span-2 fin-reglement-caisse">
      <b>{sens === 'client' ? 'Cette entrée règle-t-elle des factures de ce client ?' : 'Cette sortie règle-t-elle des factures de ce fournisseur ?'}</b>
      <div className="field-hint">{sens === 'client' ? 'La part réglée sera portée au compte du client (et non en produit : la facture l\'a déjà compté).'
        : 'La part réglée sera portée au compte du fournisseur (et non en charge : la facture l\'a déjà comptée).'}</div>
      <table>
        <tbody>
          {factures.map((f) => (
            <tr key={f.cle}>
              <td><input type="checkbox" aria-label={`Régler ${f.numero}`} checked={choix[f.cle] !== undefined} onChange={(e) => cocher(f, e.target.checked)} /></td>
              <td><b>{f.numero}</b> · réf. {f.reference}<div className="field-hint">Échéance {fmtDate(f.date_echeance)}{f.echue ? ' · échue' : ''}</div></td>
              <td className="fin-num">reste {fmtCompta(f.reste)}</td>
              <td>{choix[f.cle] !== undefined && (
                <input type="text" inputMode="decimal" aria-label={`Montant réglé sur ${f.numero}`} value={choix[f.cle]} onChange={(e) => maj(f.cle, e.target.value)} />
              )}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {total > (Number(montant) || 0) && <div className="field-hint" style={{ color: '#b91c1c' }}>Le total réglé ({fmtCompta(total)}) dépasse le montant du mouvement.</div>}
    </div>
  );
}
