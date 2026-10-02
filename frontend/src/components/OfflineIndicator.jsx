import { useEffect, useState } from 'react';
import { syncManager } from '@/lib/syncManager';

// Reprend #offline-indicator de legacy/index.html (l. 52-57) —
// bannière fixe en haut de l'écran affichée hors ligne.
export default function OfflineIndicator() {
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => syncManager.onOfflineChange(setOnline), []);

  if (online) return null;

  return (
    <div style={{ display: 'flex', position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999, background: '#f59e0b', color: 'white', padding: '8px 16px', fontSize: 13, fontWeight: 600, justifyContent: 'center', alignItems: 'center', gap: 10, boxShadow: '0 2px 8px rgba(0,0,0,.2)' }}>
      ⚡ Mode hors ligne — Les saisies sont sauvegardées localement.
    </div>
  );
}
