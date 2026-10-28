// Marque NJ BUSINESS (logo retenu le 26/10/2026 : « tuiles de modules »).
// La tuile bleue = le module en cours ; `module` = seule cette tuile est pleine.
export default function NjMarque({ taille = 34, fond = '#1a2b4a', module = false, titre = 'NJ BUSINESS' }) {
  const autres = module ? 0.3 : 1;
  return (
    <svg viewBox="0 0 96 96" width={taille} height={taille} role="img" aria-label={titre} style={{ flex: 'none', display: 'block' }}>
      <rect width="96" height="96" rx="22" fill={fond} />
      <rect x="18" y="18" width="27" height="27" rx="7" fill="#3b82f6" />
      <rect x="51" y="18" width="27" height="27" rx="7" fill="#ffffff" fillOpacity={autres} />
      <rect x="18" y="51" width="27" height="27" rx="7" fill="#ffffff" fillOpacity={autres} />
      <rect x="51" y="51" width="27" height="27" rx="7" fill="#ffffff" fillOpacity={module ? 0.3 : 0.45} />
    </svg>
  );
}
