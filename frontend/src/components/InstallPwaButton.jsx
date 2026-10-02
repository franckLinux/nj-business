import { useEffect, useState } from 'react';
import { pwaInstall } from '@/lib/pwaInstall';
import { useToast } from '@/context/ToastContext';

// Reprend #btn-install-pwa/installPWA() de legacy/js/app.js (l. 6172-6176,
// 244) — bouton masqué jusqu'à ce que le navigateur déclenche
// `beforeinstallprompt`.
export default function InstallPwaButton() {
  const [available, setAvailable] = useState(pwaInstall.isAvailable());
  const toast = useToast();

  useEffect(() => pwaInstall.subscribe(setAvailable), []);

  if (!available) return null;

  const onClick = async () => {
    const shown = await pwaInstall.prompt();
    if (!shown) toast('Non disponible sur ce navigateur.', '');
  };

  return (
    <button className="btn-icon" onClick={onClick} title="Installer l'application">📲</button>
  );
}
