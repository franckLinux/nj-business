// NJ COMPTABILITÉ — briques communes des écrans comptables (075, 076).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import '@/styles/commercial.css';
import '@/styles/comptabilite.css';

// Montant comptable : séparateur de milliers, deux décimales seulement si utiles.
export const fmtCompta = (v, { zero = '' } = {}) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return zero;
  return n.toLocaleString('fr-FR', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
};
export const fmtDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR') : '—');
export const aujourdhui = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Saisie « 12 500,50 » → nombre (NaN si invalide, 0 si vide).
export const lireMontant = (s) => {
  const t = String(s ?? '').replace(/\s/g, '').replace(',', '.');
  if (!t) return 0;
  return /^\d+(\.\d{0,2})?$/.test(t) ? Number(t) : NaN;
};
export const centimes = (n) => Math.round(Number(n || 0) * 100);

export const LIBELLES_STATUT = { brouillard: 'Brouillard', validee: 'Validée' };
export function BadgeStatut({ statut, extournee }) {
  if (extournee) return <span className="fin-badge fin-badge-extournee">Extournée</span>;
  return <span className={`fin-badge fin-badge-${statut}`}>{LIBELLES_STATUT[statut] || statut}</span>;
}

// Exercices du client : liste + exercice courant (celui qui couvre aujourd'hui, sinon le plus récent).
export function useExercices() {
  const [exercices, setExercices] = useState(null);
  const [erreur, setErreur] = useState('');
  const charger = useCallback(async () => {
    const r = await api.get('/comptabilite/exercices');
    if (r?.error) { setErreur(r.error); setExercices([]); return; }
    setErreur(''); setExercices(Array.isArray(r) ? r : []);
  }, []);
  useEffect(() => { charger(); }, [charger]);
  const auj = aujourdhui();
  const courant = (exercices || []).find((e) => String(e.date_debut).slice(0, 10) <= auj && auj <= String(e.date_fin).slice(0, 10))
    || (exercices || [])[0] || null;
  return { exercices, courant, erreur, recharger: charger };
}

export function SansExercice({ peutParametrer }) {
  return (
    <div className="fin-vide">
      <div className="fin-vide-icone" aria-hidden="true">📘</div>
      <h3>Aucun exercice comptable</h3>
      <p>La comptabilité commence par un exercice et ses journaux comptables.</p>
      {peutParametrer
        ? <Link className="cm-btn cm-primaire" to="/comptabilite/parametrage">Paramétrer la comptabilité</Link>
        : <p className="cm-sous">Demandez au comptable ou au directeur de créer l'exercice.</p>}
    </div>
  );
}

export function Erreur({ message }) {
  return message ? <div className="cm-erreur" role="alert">{message}</div> : null;
}

// Choix d'un compte du plan (détail uniquement pour la saisie).
export function ChampCompte({ valeur, onChange, id, disabled, autoFocus, url = '/comptabilite/comptes' }) {
  const [liste, setListe] = useState([]);
  const [ouvert, setOuvert] = useState(false);
  const [actif, setActif] = useState(-1);
  const minuterie = useRef(null);
  const boite = useRef(null);
  useEffect(() => {
    const clic = (e) => { if (boite.current && !boite.current.contains(e.target)) setOuvert(false); };
    document.addEventListener('mousedown', clic);
    return () => document.removeEventListener('mousedown', clic);
  }, []);
  const chercher = (v) => {
    clearTimeout(minuterie.current);
    if (!v.trim()) { setOuvert(false); return; }
    minuterie.current = setTimeout(async () => {
      const r = await api.get(`${url}?q=${encodeURIComponent(v.trim())}`);
      setListe(Array.isArray(r) ? r : []); setOuvert(Array.isArray(r) && r.length > 0); setActif(-1);
    }, 220);
  };
  const choisir = (c) => {
    if (!c.detail) return;
    onChange(c.compte, c); setOuvert(false);
  };
  return (
    <div className="fin-compte" ref={boite}>
      <input id={id} value={valeur} disabled={disabled} autoFocus={autoFocus} inputMode="numeric" autoComplete="off"
        placeholder="Compte" aria-label="Compte"
        onChange={(e) => { onChange(e.target.value.trim(), null); chercher(e.target.value); }}
        onFocus={(e) => { if (e.target.value) chercher(e.target.value); }}
        onKeyDown={(e) => {
          if (!ouvert) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActif((a) => Math.min(a + 1, liste.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActif((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter' && actif >= 0) { e.preventDefault(); choisir(liste[actif]); }
          else if (e.key === 'Escape') setOuvert(false);
        }} />
      {ouvert && (
        <ul className="fin-compte-liste" role="listbox">
          {liste.map((c, i) => (
            <li key={c.compte} role="option" aria-selected={i === actif} aria-disabled={!c.detail}
              className={(i === actif ? 'actif ' : '') + (c.detail ? '' : 'regroupement')}
              onMouseDown={(e) => { e.preventDefault(); choisir(c); }}
              title={c.detail ? '' : 'Compte de regroupement : choisissez un compte de détail'}>
              <b>{c.compte}</b> <span>{c.intitule}</span>{!c.detail && <em>regroupement</em>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Pagination simple.
export function Pagination({ page, taille, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / taille));
  if (pages <= 1) return null;
  return (
    <div className="fin-pagination">
      <button type="button" className="cm-btn cm-secondaire" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Précédent</button>
      <span>Page {page} / {pages} · {total.toLocaleString('fr-FR')} écriture(s)</span>
      <button type="button" className="cm-btn cm-secondaire" disabled={page >= pages} onClick={() => onPage(page + 1)}>Suivant ›</button>
    </div>
  );
}
