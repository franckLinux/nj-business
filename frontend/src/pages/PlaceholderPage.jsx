// Page non encore migrée vers React.
// Renvoie l'utilisateur vers l'application vanilla, toujours en service sur /.
export default function PlaceholderPage({ titre }) {
  return (
    <div style={{ padding: '48px 32px', textAlign: 'center', color: 'var(--text-muted, #64748b)' }}>
      <div style={{ fontSize: 40, marginBottom: 14 }}>🚧</div>
      <h2 style={{ margin: '0 0 10px', color: 'var(--text, #0f172a)', fontSize: 18 }}>
        {titre} — migration en cours
      </h2>
      <p style={{ margin: '0 0 22px', fontSize: 13.5, maxWidth: 460, marginInline: 'auto' }}>
        Cette page n'est pas encore portée en React. Elle reste pleinement
        fonctionnelle dans l'application d'origine.
      </p>
      <a href="/" className="btn-primary" style={{ display: 'inline-block', width: 'auto', padding: '10px 22px', textDecoration: 'none' }}>
        Ouvrir dans l'application actuelle
      </a>
    </div>
  );
}
