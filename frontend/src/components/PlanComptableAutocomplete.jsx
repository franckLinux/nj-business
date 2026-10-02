import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

// Reprend searchPlanComptable()/selectCompte() de legacy/js/app.js (l. 4688-4736).
const NATURE_COLORS = { charge: '#fee2e2', produit: '#dcfce7', actif: '#dbeafe', passif: '#fef3c7', tresorerie: '#ede9fe', capitaux: '#f0fdf4' };

export default function PlanComptableAutocomplete({ value, onChange, placeholder, inputStyle }) {
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  const onInput = (e) => {
    const v = e.target.value;
    onChange(v);
    clearTimeout(timerRef.current);
    if (!v || v.trim().length < 2) { setOpen(false); return; }
    timerRef.current = setTimeout(async () => {
      const res = await api.get(`/plan-comptable/search?q=${encodeURIComponent(v.trim())}`);
      if (!Array.isArray(res) || res.length === 0) { setOpen(false); return; }
      setResults(res); setOpen(true);
    }, 280);
  };

  const select = (compte) => { onChange(compte); setOpen(false); };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        type="text" value={value} onChange={onInput} placeholder={placeholder} autoComplete="off"
        style={{ fontFamily: 'monospace', width: '100%', ...inputStyle }}
      />
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, background: 'white',
          border: '1.5px solid var(--accent)', borderTop: 'none', borderRadius: '0 0 8px 8px',
          boxShadow: '0 8px 24px rgba(0,0,0,.12)', zIndex: 200, maxHeight: 220, overflowY: 'auto',
        }}>
          {results.map((r) => (
            <div
              key={r.compte} onClick={() => select(r.compte)}
              onMouseOver={(e) => { e.currentTarget.style.background = '#eff6ff'; }}
              onMouseOut={(e) => { e.currentTarget.style.background = 'white'; }}
              style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}
            >
              <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, padding: '2px 7px', borderRadius: 5, background: NATURE_COLORS[r.nature] || '#f1f5f9', color: '#1e293b', flexShrink: 0 }}>{r.compte}</span>
              <span style={{ flex: 1, color: 'var(--text)' }}>{r.intitule}</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>Cl.{r.classe}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
