import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Chart from 'chart.js/auto';
import { api } from '@/lib/api';
import { useApp } from '@/context/AppContext';
import { MOIS, TYPES_ICONS, fmt } from '@/lib/format';

// Tableau de bord — reprend exactement les KPI, les couleurs et les options
// Chart.js de loadDashboard() dans legacy/js/app.js.
export default function DashboardPage() {
  const { annee, mois, devise, activeTenantId } = useApp();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [erreur, setErreur] = useState('');

  const fluxRef = useRef(null);
  const pieRef = useRef(null);
  const fluxChart = useRef(null);
  const pieChart = useRef(null);

  useEffect(() => {
    let annule = false;
    setData(null);
    setErreur('');
    api.get(`/dashboard/stats?annee=${annee}&mois=${encodeURIComponent(mois)}`).then((res) => {
      if (annule) return;
      if (res.error) setErreur(res.error);
      else setData(res);
    });
    return () => { annule = true; };
  }, [annee, mois, activeTenantId]);

  useEffect(() => {
    if (!data) return;

    const entrees = new Array(12).fill(0);
    const sorties = new Array(12).fill(0);
    (data.tendance || []).forEach((r) => {
      const idx = MOIS.indexOf(r.mois);
      if (idx >= 0) {
        entrees[idx] += parseFloat(r.entrees || 0);
        sorties[idx] += parseFloat(r.sorties || 0);
      }
    });

    fluxChart.current?.destroy();
    if (fluxRef.current) {
      fluxChart.current = new Chart(fluxRef.current, {
        type: 'bar',
        data: {
          labels: MOIS.map((m) => m.substring(0, 3)),
          datasets: [
            { label: 'Entrées', data: entrees, backgroundColor: '#86efac', borderRadius: 4 },
            { label: 'Sorties', data: sorties, backgroundColor: '#fca5a5', borderRadius: 4 },
          ],
        },
        options: {
          responsive: true,
          plugins: { legend: { position: 'top' } },
          scales: {
            y: { ticks: { callback: (v) => (v / 1000) + 'k' }, grid: { color: '#f1f5f9' } },
            x: { grid: { display: false } },
          },
        },
      });
    }

    pieChart.current?.destroy();
    pieChart.current = null;
    const nonZero = MOIS
      .map((m, i) => ({ m: m.substring(0, 3), v: entrees[i] + sorties[i] }))
      .filter((x) => x.v > 0);

    if (nonZero.length > 0 && pieRef.current) {
      pieChart.current = new Chart(pieRef.current, {
        type: 'doughnut',
        data: {
          labels: nonZero.map((x) => x.m),
          datasets: [{
            data: nonZero.map((x) => x.v),
            backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4',
                              '#84cc16', '#f43f5e', '#a855f7', '#14b8a6', '#f97316', '#6366f1'],
            borderWidth: 2,
            borderColor: '#fff',
          }],
        },
        options: {
          responsive: true,
          plugins: { legend: { position: 'bottom', labels: { font: { size: 10 } } } },
          cutout: '60%',
        },
      });
    }
  }, [data]);

  // Les graphiques Chart.js ne sont pas démontés par React : on les libère.
  useEffect(() => () => {
    fluxChart.current?.destroy();
    pieChart.current?.destroy();
  }, []);

  if (erreur) return <div className="alert-err">{erreur}</div>;
  if (!data) return <div className="loading-msg">Chargement…</div>;

  return (
    <div id="dashboard-content">
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-icon kpi-green">
            <svg viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>
          </div>
          <div className="kpi-body">
            <p className="kpi-label">Entrées {annee}</p>
            <p className="kpi-value">{fmt(data.totalEntrees, devise)}</p>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon kpi-red">
            <svg viewBox="0 0 24 24"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6" /><polyline points="17 18 23 18 23 12" /></svg>
          </div>
          <div className="kpi-body">
            <p className="kpi-label">Sorties {annee}</p>
            <p className="kpi-value">{fmt(data.totalSorties, devise)}</p>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon kpi-purple">
            <svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /></svg>
          </div>
          <div className="kpi-body">
            <p className="kpi-label">Mouvements</p>
            <p className="kpi-value">{data.nbMouvements}</p>
          </div>
        </div>
      </div>

      <h3 style={{ fontSize: 14, fontWeight: 700, margin: '4px 0 10px', color: 'var(--text-secondary)' }}>
        Situation des journaux — {data.mois} {data.annee}
        <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> · trésorerie : {fmt(data.tresorerieMois, devise)}</span>
      </h3>
      <div className="kpi-grid" style={{ marginTop: 0 }}>
        {(data.soldesJournaux || []).map((j) => (
          <div
            className="kpi-card" key={j.id ?? j.nom}
            onClick={() => j.id && navigate(`/journal/${j.id}`)}
            style={{ cursor: j.id ? 'pointer' : 'default' }}
            title="Ouvrir le journal"
          >
            <div className="kpi-icon kpi-blue">
              <span style={{ fontSize: 20 }}>{TYPES_ICONS[j.type] || '📒'}</span>
            </div>
            <div className="kpi-body">
              <p className="kpi-label">
                {j.nom}
                {j.arrete && <span style={{ marginLeft: 6, fontSize: 10, color: '#b45309', fontWeight: 700 }}>🔒 arrêté</span>}
              </p>
              <p className="kpi-value" style={{ fontSize: 16, color: j.solde < 0 ? '#dc2626' : undefined }}>{fmt(j.solde, devise)}</p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }}>
                RAN {fmt(j.ran, devise)}{j.ran_reporte ? ' (report)' : ''} · +{fmt(j.total_entrees, devise)} · −{fmt(j.total_sorties, devise)}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="chart-row">
        <div className="chart-card" style={{ flex: 2 }}>
          <h3>Flux mensuels {annee}</h3>
          <canvas ref={fluxRef} height="100" />
        </div>
        <div className="chart-card" style={{ flex: 1 }}>
          <h3>Mouvements par mois</h3>
          <canvas ref={pieRef} height="220" />
        </div>
      </div>
    </div>
  );
}
