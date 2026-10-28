import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import { api } from '@/lib/api';

// Reprend la cloche de notifications de legacy/js/app.js (l. 2637-2716) :
// updateNotifBadge/loadNotifications/toggleNotifications/ouvrirNotification/
// marquerToutesLues, avec le polling 45s de launchApp() (l. 6246-6249).
const NOTIF_ICONS = { attente_creee: '📤', attente_approuvee: '✅', attente_rejetee: '❌', com_demande: '🛒' };

const tempsRelatif = (iso) => {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  if (diff < 172800) return 'hier';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export default function NotifBell() {
  const { peutVoirAttente } = useApp();
  const navigate = useNavigate();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState(null);
  const wrapRef = useRef(null);

  const refreshCount = async () => {
    const res = await api.get('/notifications/count');
    if (typeof res?.nb === 'number') setCount(res.nb);
  };

  // Allègement : sondage toutes les 2 min (au lieu de 45 s), suspendu quand
  // l'onglet est en arrière-plan, et relancé dès qu'on revient sur l'onglet.
  // Un onglet oublié ouvert ne consomme plus de requêtes pour rien.
  useEffect(() => {
    refreshCount();
    const tick = () => { if (navigator.onLine && !document.hidden) refreshCount(); };
    const id = setInterval(tick, 120000);
    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVisible);
    // Bouton « Rafraîchir » de la barre du haut.
    window.addEventListener('njb-rafraichir', refreshCount);
    return () => {
      clearInterval(id); document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('njb-rafraichir', refreshCount);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onDocClick = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  const loadList = async () => {
    const res = await api.get('/notifications?limit=30');
    setNotifs(res?.notifications || []);
  };

  const toggle = (e) => {
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    setOpen(true);
    loadList();
  };

  const ouvrir = async (n) => {
    await api.patch(`/notifications/${n.id}/lu`, {});
    refreshCount();
    if (n.type === 'attente_creee' && peutVoirAttente) {
      setOpen(false);
      navigate('/attente');
    } else if (n.type === 'com_demande' && n.ref_id) {
      // NJ COMMERCIAL (051) : la notification ouvre directement la demande d'achat.
      setOpen(false);
      navigate(`/commercial/demandes/${n.ref_id}`);
    } else {
      loadList();
    }
  };

  const marquerTout = async () => {
    await api.patch('/notifications/lu-tout', {});
    refreshCount();
    loadList();
  };

  return (
    <div className="notif-wrap" ref={wrapRef} style={{ position: 'relative' }}>
      <button className="btn-icon" onClick={toggle} title="Notifications" style={{ position: 'relative' }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {count > 0 && (
          <span style={{ display: 'block', position: 'absolute', top: -4, right: -4, background: '#ef4444', color: 'white', borderRadius: 10, fontSize: 10, fontWeight: 700, padding: '1px 5px', lineHeight: 1.4, minWidth: 16, textAlign: 'center' }}>
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      {open && (
        <div className="notif-panel" style={{ display: 'flex', flexDirection: 'column', position: 'absolute', right: 0, top: 'calc(100% + 8px)', width: 360, maxHeight: 460, background: 'white', borderRadius: 12, boxShadow: '0 8px 30px rgba(0,0,0,.15)', border: '1px solid var(--border)', zIndex: 300, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 700, fontSize: 13 }}>
            🔔 Notifications
            <button onClick={marquerTout} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Tout marquer lu</button>
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {notifs === null ? (
              <div className="loading-msg">Chargement…</div>
            ) : notifs.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Aucune notification.</div>
            ) : notifs.map((n) => (
              <div
                key={n.id} onClick={() => ouvrir(n)}
                style={{ display: 'flex', gap: 10, padding: '12px 16px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', background: n.lu ? '#fff' : '#eff6ff' }}
              >
                {n.lu ? <span style={{ width: 8, flexShrink: 0 }} /> : <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#2563eb', flexShrink: 0, marginTop: 6 }} />}
                <div style={{ fontSize: 18, flexShrink: 0, lineHeight: 1.2 }}>{NOTIF_ICONS[n.type] || '🔔'}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 700, color: '#0f172a', fontSize: 13 }}>{n.titre}</div>
                  <div style={{ fontSize: 12, color: '#475569', marginTop: 2, lineHeight: 1.35 }}>{n.message}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{tempsRelatif(n.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
