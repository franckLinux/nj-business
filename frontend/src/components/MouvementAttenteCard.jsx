import { fmt } from '@/lib/format';

// Reprend mvtAttenteCard() de legacy/js/app.js (l. 2513-2538).
// Partagé entre AttentePage (vue directeur, tous mois) et BudgetPage
// (section contextuelle filtrée sur le mois affiché — refreshMouvementsAttente()).
export const MOTIF_ATTENTE = {
  rubrique_non_approuvee: ['#fef3c7', '#92400e', 'Rubrique non budgétisée'],
  mois_non_valide: ['#fef3c7', '#92400e', 'Mois non validé'],
  depassement_journal: ['#fee2e2', '#991b1b', 'Plafond caisse dépassé'],
  depassement_rubrique: ['#fee2e2', '#991b1b', 'Budget approuvé dépassé'],
};

export default function MouvementAttenteCard({ m, devise, onApprouver, onRejeter }) {
  const [bg, fg, lbl] = MOTIF_ATTENTE[m.motif_attente] || ['#e2e8f0', '#475569', 'En attente'];
  const refLabel = m.motif_attente === 'depassement_journal' ? 'Plafond' : 'Approuvé';
  const showInfo = m.motif_attente === 'depassement_rubrique' || m.motif_attente === 'depassement_journal';

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: '14px 16px', marginBottom: 10, background: 'white' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ minWidth: 200 }}>
          <div style={{ fontWeight: 700, color: '#0f172a' }}>
            {m.intitule} <span style={{ background: bg, color: fg, fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6 }}>{lbl}</span>
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>
            {m.mois} {m.annee} · <span className="badge">{m.rubrique_code}</span> · {m.beneficiaire || '—'} · {m.journal_nom || ''} · {m.date}
          </div>
          {showInfo && (
            <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
              {refLabel} : {fmt(m.montant_prevu, devise)} · Déjà sorti : {fmt(m.cumul_sorties, devise)}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#dc2626' }}>{fmt(m.sortie, devise)}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
            <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => onRejeter(m.id)}>✕ Rejeter</button>
            <button className="btn-primary" style={{ width: 'auto', marginTop: 0, fontSize: 12 }} onClick={() => onApprouver(m.id)}>✓ Approuver</button>
          </div>
        </div>
      </div>
    </div>
  );
}
