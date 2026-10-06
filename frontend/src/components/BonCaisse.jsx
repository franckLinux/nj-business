// Bon de caisse : impression à la saisie + réimpression depuis le journal.
// La fenêtre est ouverte dans le clic (sinon bloquée par le navigateur), puis
// le serveur enregistre l'impression (ORIGINAL / DUPLICATA) et fournit les données.
import { useState } from 'react';
import { api } from '@/lib/api';
import { fmt } from '@/lib/format';
import { ouvrirFenetreBon, printBonCaisse } from '@/lib/print';

export async function imprimerBon(id, toast) {
  const w = ouvrirFenetreBon();
  const res = await api.post(`/journal/${id}/impression`, {});
  if (!res || res.error) {
    if (w && !w.closed) w.close();
    toast?.(res?.error || "Impossible d'imprimer le bon.", 'error');
    return false;
  }
  if (!printBonCaisse(res, w)) toast?.('Autorisez les fenêtres pop-up pour imprimer le bon.', 'warning', 7000);
  return true;
}

// Bouton compact pour une ligne du journal.
export function BoutonBon({ m, toast, onDone }) {
  const [busy, setBusy] = useState(false);
  const deja = (m.nb_impressions || 0) > 0;
  return (
    <button
      className="btn-bon"
      disabled={busy}
      title={deja ? `Réimprimer le bon (duplicata — déjà imprimé ${m.nb_impressions} fois)` : 'Imprimer le bon de caisse (original, 2 exemplaires)'}
      onClick={async () => { setBusy(true); const ok = await imprimerBon(m.id, toast); setBusy(false); if (ok) onDone?.(); }}
    >
      <span aria-hidden>🖨️</span>{deja && <i>{m.nb_impressions}</i>}
    </button>
  );
}

// Fenêtre de confirmation après saisie : propose l'impression immédiate du bon.
export function BonPretModal({ m, devise, onClose, onNouvelle, onDone, toast }) {
  const [busy, setBusy] = useState(false);
  const e = parseFloat(m.entree) || 0;
  const s = parseFloat(m.sortie) || 0;
  const entree = e > 0;
  const imprimer = async () => {
    setBusy(true);
    const ok = await imprimerBon(m.id, toast);
    setBusy(false);
    if (ok) { onDone?.(); onClose(); }
  };
  return (
    <div className="modal-overlay bonpret-overlay" style={{ display: 'flex' }} onClick={onClose}>
      <div className={`bonpret ${entree ? 'is-in' : 'is-out'}`} onClick={(ev) => ev.stopPropagation()} role="dialog" aria-modal="true">
        <div className="bonpret-check">✓</div>
        <div className="bonpret-kicker">Écriture enregistrée</div>
        <div className="bonpret-num">N° {m.numero ?? '—'}</div>
        <div className="bonpret-amount">{entree ? '+' : '−'} {fmt(entree ? e : s, devise)}</div>
        <div className="bonpret-lib">{m.intitule}</div>
        {m.beneficiaire && <div className="bonpret-ben">{entree ? 'Versé par' : 'Bénéficiaire'} : {m.beneficiaire}</div>}
        <button className="bonpret-print" onClick={imprimer} disabled={busy} autoFocus>
          <span>🖨️</span>{busy ? 'Préparation…' : `Imprimer le bon ${entree ? "d'entrée" : 'de sortie'} · 2 exemplaires`}
        </button>
        <div className="bonpret-actions">
          <button onClick={onNouvelle}>＋ Nouvelle saisie</button>
          <button onClick={onClose}>Plus tard</button>
        </div>
        <div className="bonpret-hint">Réimpression possible à tout moment avec 🖨️ dans le journal (mention DUPLICATA).</div>
      </div>
    </div>
  );
}
