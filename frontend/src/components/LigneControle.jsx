// Statuts du contrôle comptable (migrations 042-044), partagés par le
// Rapport, la fiche de contrôle et l'impression.
// 044 : l'ancienne liste « Contrôler » (bouton indépendant) a été retirée ;
// le Rapport est le seul point d'accès au contrôle des opérations.
export const STATUTS = {
  a_controler: { lib: 'À contrôler', bg: '#f1f5f9', fg: '#475569', dot: '#94a3b8' },
  en_cours: { lib: 'En cours', bg: '#fef3c7', fg: '#92400e', dot: '#f59e0b' },
  controle: { lib: 'Validée', bg: '#dcfce7', fg: '#166534', dot: '#10b981' },
  anomalie: { lib: 'Anomalies constatées', bg: '#fee2e2', fg: '#991b1b', dot: '#ef4444' },
};
