import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { MOIS } from '@/lib/format';
import { oublierPeriodes } from '@/lib/budgetPeriode';

// Périodicité du budget (migration 040) : mensuelle ou hebdomadaire, au choix
// du client. Un changement prend effet au 1er d'un mois (jamais en cours de
// mois, jamais rétroactif) ; l'historique garde les réglages successifs.
const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: .4, color: 'var(--text-muted)', marginBottom: 5 };
const inputStyle = { width: '100%', padding: '9px 12px', border: '1.5px solid var(--border)', borderRadius: 7, fontSize: 13 };
const cardStyle = { background: 'white', border: '1px solid var(--border)', borderRadius: 12, padding: 24, marginBottom: 16 };
const cardTitleStyle = { fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 16 };
const LIB = { mensuel: 'Mensuel', hebdomadaire: 'Hebdomadaire' };
const dateFr = (d) => new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

export default function PeriodiciteBudget() {
  const { can } = useApp();
  const toast = useToast();
  const peutModifier = can('config.edit');
  const [etat, setEtat] = useState(null);
  const [erreur, setErreur] = useState('');
  const [choix, setChoix] = useState('hebdomadaire');
  const [mois, setMois] = useState(MOIS[new Date().getMonth()]);
  const [annee, setAnnee] = useState(new Date().getFullYear());
  const [saving, setSaving] = useState(false);

  const charger = useCallback(async () => {
    const r = await api.get('/budget/periodicite');
    if (r.error) { setErreur(r.error); return; }
    setErreur(''); setEtat(r);
    setChoix(r.actuelle === 'hebdomadaire' ? 'mensuel' : 'hebdomadaire');
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const onSave = async () => {
    const lib = `${LIB[choix].toLowerCase()} à partir de ${mois} ${annee}`;
    if (!window.confirm(`Passer le budget en ${lib} ?\n\n`
      + (choix === 'hebdomadaire'
        ? 'Les prévisions, la validation du directeur et la demande de fonds se feront chaque semaine. Les dépenses seront contrôlées sur le cumul des semaines validées du mois.'
        : 'Les prévisions, la validation et la demande de fonds redeviendront mensuelles.'))) return;
    setSaving(true);
    const r = await api.put('/budget/periodicite', { periodicite: choix, mois, annee });
    setSaving(false);
    if (r.error) { toast(r.error, 'error', 7000); return; }
    oublierPeriodes();
    toast(r.message || 'Réglage enregistré ✓', 'success');
    charger();
  };

  if (erreur) return <div style={cardStyle}><h4 style={cardTitleStyle}>📅 Périodicité du budget</h4><div className="alert-err">{erreur}</div></div>;
  if (!etat) return null;

  const an = new Date().getFullYear();
  return (
    <div style={cardStyle}>
      <h4 style={cardTitleStyle}>📅 Périodicité du budget</h4>
      <p style={{ fontSize: 13, marginBottom: 12 }}>
        Ce mois-ci ({etat.mois_courant} {etat.annee_courante}) : <strong>{LIB[etat.actuelle]}</strong>.
        <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
          En hebdomadaire, chaque semaine (du lundi au dimanche, à l'intérieur du mois) a sa prévision, sa validation par le directeur et sa demande de fonds.
          Le non-dépensé d'une semaine se reporte sur les suivantes du même mois. Arrêt de caisse et rapports restent mensuels.
        </span>
      </p>
      {!etat.disponible && <div className="alert-err" style={{ marginBottom: 10 }}>Migration 040 non appliquée sur le serveur : réglage indisponible.</div>}
      {peutModifier && etat.disponible && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, alignItems: 'end' }}>
          <div>
            <label style={labelStyle}>Nouveau réglage</label>
            <select value={choix} onChange={(e) => setChoix(e.target.value)} style={inputStyle}>
              <option value="hebdomadaire">Hebdomadaire</option>
              <option value="mensuel">Mensuel</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>À partir de</label>
            <select value={mois} onChange={(e) => setMois(e.target.value)} style={inputStyle}>
              {MOIS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Année</label>
            <select value={annee} onChange={(e) => setAnnee(parseInt(e.target.value, 10))} style={inputStyle}>
              {[an, an + 1].map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <button className="btn-add" onClick={onSave} disabled={saving}>💾 Appliquer</button>
          </div>
        </div>
      )}
      {etat.historique.length > 0 && (
        <div style={{ marginTop: 14, fontSize: 12, color: 'var(--text-muted)' }}>
          <b>Historique :</b>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
            {etat.historique.map((h) => (
              <li key={h.a_partir_de}>
                {LIB[h.periodicite]} depuis {dateFr(h.a_partir_de)}{h.defini_par ? ` — par ${h.defini_par}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
