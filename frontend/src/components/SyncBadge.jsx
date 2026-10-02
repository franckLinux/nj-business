import { useEffect, useState } from 'react';
import { syncManager } from '@/lib/syncManager';
import SyncQueueModal from './SyncQueueModal';

// Reprend #sync-badge de legacy/index.html (l. 241-243) — pastille rouge
// affichant le nombre d'opérations en attente de synchronisation.
export default function SyncBadge() {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => syncManager.onBadgeChange(setCount), []);

  if (count === 0) return null;

  return (
    <>
      <div
        onClick={() => setOpen(true)}
        style={{ display: 'flex', width: 22, height: 22, background: 'var(--accent-red)', color: 'white', borderRadius: '50%', fontSize: 10, fontWeight: 700, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
      >
        {count}
      </div>
      {open && <SyncQueueModal onClose={() => setOpen(false)} />}
    </>
  );
}
