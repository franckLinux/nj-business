// lib/budgetPeriode.jsx — Budget hebdomadaire au choix (migration 040).
// Le calendrier des semaines vient TOUJOURS du serveur (GET /budget/periode) :
// l'interface ne le recalcule jamais, pour ne pas diverger du contrôle.
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

const cache = new Map();   // `${mois}-${annee}-${tenant}` → réponse

/** { periodicite, semaines, chargement } du mois demandé. */
export function usePeriodeBudget(mois, annee, tenantKey = '') {
  const cle = `${mois}-${annee}-${tenantKey}`;
  const [etat, setEtat] = useState(() => cache.get(cle) || { periodicite: null, semaines: [], chargement: true });
  useEffect(() => {
    let annule = false;
    if (!mois || !annee) return undefined;
    const enCache = cache.get(cle);
    if (enCache) { setEtat(enCache); return undefined; }
    setEtat({ periodicite: null, semaines: [], chargement: true });
    api.get(`/budget/periode?mois=${encodeURIComponent(mois)}&annee=${annee}`).then((r) => {
      if (annule) return;
      // Serveur plus ancien (route absente) ou erreur : comportement mensuel.
      const v = r && !r.error ? { periodicite: r.periodicite, semaines: r.semaines || [], chargement: false }
        : { periodicite: 'mensuel', semaines: [], chargement: false, erreur: r?.error };
      if (!r?.error) cache.set(cle, v);
      setEtat(v);
    });
    return () => { annule = true; };
  }, [cle, mois, annee]);
  return etat;
}

/** Vide le cache (après un changement de réglage). */
export const oublierPeriodes = () => cache.clear();

const isoJour = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Semaine contenant la date (par défaut aujourd'hui), sinon la première. */
export const semaineParDefaut = (semaines, date = isoJour()) =>
  (semaines.find((s) => date >= s.debut && date <= s.fin) || semaines[0] || {}).num || 1;

export const semaineDeDate = (semaines, date) =>
  (semaines.find((s) => String(date).slice(0, 10) >= s.debut && String(date).slice(0, 10) <= s.fin) || {}).num || null;

/** Sélecteur compact de semaine (boutons S1…Sn avec dates). */
export function SelecteurSemaine({ semaines, valeur, onChange, statuts = {} }) {
  const couleurs = { valide: '#16a34a', rejete: '#dc2626', en_attente: '#d97706' };
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {semaines.map((s) => {
        const actif = s.num === valeur;
        const st = statuts[s.num];
        return (
          <button key={s.num} type="button" onClick={() => onChange(s.num)}
            title={`${s.libelle}${st ? ` — ${st === 'valide' ? 'validée' : st === 'rejete' ? 'rejetée' : 'en attente'}` : ''}`}
            style={{
              padding: '6px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12, lineHeight: 1.25, textAlign: 'left',
              border: `1.5px solid ${actif ? 'var(--accent)' : 'var(--border)'}`,
              background: actif ? '#eff6ff' : 'white', color: actif ? '#1d4ed8' : 'var(--text)',
            }}>
            <b>S{s.num}</b>{st && <span style={{ marginLeft: 5, color: couleurs[st] || 'var(--text-muted)' }}>●</span>}
            <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-muted)' }}>{s.libelle.replace(/^S\d+ · /, '')}</span>
          </button>
        );
      })}
    </div>
  );
}
