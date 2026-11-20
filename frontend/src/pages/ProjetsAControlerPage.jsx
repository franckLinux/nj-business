import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import ProjetsNav from '@/components/projets/ProjetsNav';
import { TablePieces } from '@/components/projets/Justificatifs';
import { fcfa } from './ProjetsPage';

// File des justificatifs à contrôler (070) : ceux des projets dont
// l'utilisateur est chef, ou tous pour le comptable — jamais ses propres dépôts.
export default function ProjetsAControlerPage() {
  const [pieces, setPieces] = useState(null);
  const [erreur, setErreur] = useState('');
  const charger = useCallback(async () => {
    const r = await api.get('/projets/controle/justificatifs');
    if (r.error) { setErreur(r.error); return; }
    setPieces(r);
  }, []);
  useEffect(() => { charger(); }, [charger]);
  const total = (pieces || []).reduce((s, j) => s + j.montant, 0);
  return (
    <div className="page-content pj-page">
      <div className="pj-tete">
        <div>
          <h2>Justificatifs à contrôler</h2>
          <p>Pièces déposées par les responsables d'activité. Ouvrez la pièce scannée, puis validez-la ou rejetez-la avec un motif. Vos propres dépôts sont contrôlés par quelqu'un d'autre.</p>
        </div>
      </div>
      <ProjetsNav />
      {erreur ? <div className="alert-err">{erreur}</div> : pieces === null ? <div className="loading-msg">Chargement…</div> : (
        <div className="pj-carte">
          <div className="pj-carte-t">{pieces.length} pièce(s) en attente <small>{fcfa(total)} FCFA</small></div>
          <TablePieces pieces={pieces} avecProjet onChange={charger} vide="✓ Rien à contrôler pour l'instant." />
        </div>
      )}
    </div>
  );
}
