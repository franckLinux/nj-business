// NJ COMMERCIAL — briques d'interface partagées par les écrans du module.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

export function Entete({ titre, description, children }) {
  return (
    <div className="cm-entete">
      <div>
        <h2>{titre}</h2>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="cm-actions">{children}</div>}
    </div>
  );
}

export function Statut({ actif, oui = 'Actif', non = 'Inactif' }) {
  return <span className={'cm-pastille ' + (actif ? 'cm-ok' : 'cm-off')}>{actif ? oui : non}</span>;
}

// Chargement d'une liste avec relance (filtres, rafraîchissement).
export function useListe(url) {
  const [donnees, setDonnees] = useState(null);
  const [erreur, setErreur] = useState('');
  const recharger = useCallback(async () => {
    const r = await api.get(url);
    if (r?.error) { setErreur(r.error); setDonnees([]); return; }
    setErreur(''); setDonnees(r);
  }, [url]);
  useEffect(() => { recharger(); }, [recharger]);
  return { donnees, erreur, recharger };
}

// Recherche différée (évite une requête à chaque frappe).
export function useDiffere(valeur, delai = 250) {
  const [v, setV] = useState(valeur);
  useEffect(() => { const t = setTimeout(() => setV(valeur), delai); return () => clearTimeout(t); }, [valeur, delai]);
  return v;
}

// Formulaire latéral. Échap ferme ; le focus va au premier champ.
export function Tiroir({ titre, sousTitre, onFermer, pied, children }) {
  const corps = useRef(null);
  useEffect(() => {
    const touche = (e) => { if (e.key === 'Escape') onFermer(); };
    window.addEventListener('keydown', touche);
    const premier = corps.current?.querySelector('input:not([type=checkbox]):not([disabled]), select, textarea');
    premier?.focus();
    document.body.classList.add('nav-locked');
    return () => { window.removeEventListener('keydown', touche); document.body.classList.remove('nav-locked'); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="cm-voile" onMouseDown={(e) => { if (e.target === e.currentTarget) onFermer(); }}>
      <div className="cm-tiroir" role="dialog" aria-modal="true" aria-label={titre}>
        <div className="cm-tiroir-tete">
          <div style={{ flex: 1 }}>
            <h3>{titre}</h3>
            {sousTitre && <span className="cm-sous">{sousTitre}</span>}
          </div>
          <button type="button" className="cm-fermer" onClick={onFermer} aria-label="Fermer">✕</button>
        </div>
        <div className="cm-tiroir-corps" ref={corps}>{children}</div>
        {pied && <div className="cm-tiroir-pied">{pied}</div>}
      </div>
    </div>
  );
}

export function Section({ titre, children }) {
  return <section className="cm-section">{titre && <h4>{titre}</h4>}{children}</section>;
}

export function Champ({ label, requis, aide, pleine, id, children }) {
  return (
    <div className={'cm-champ' + (pleine ? ' cm-pleine' : '')}>
      {label && <label htmlFor={id}>{label}{requis && <span className="cm-req" aria-hidden="true">*</span>}</label>}
      {children}
      {aide && <span className="cm-aide">{aide}</span>}
    </div>
  );
}

export function Bascule({ valeur, onChange, oui = 'Oui', non = 'Non', label }) {
  return (
    <div className="cm-bascule" role="group" aria-label={label}>
      <button type="button" aria-pressed={valeur === true} onClick={() => onChange(true)}>{oui}</button>
      <button type="button" aria-pressed={valeur === false} onClick={() => onChange(false)}>{non}</button>
    </div>
  );
}

// Cases à cocher multiples : options [{ id, libelle, detail? }], valeurs = ids.
export function Cases({ options, valeurs, onChange, vide = 'Aucun élément disponible.', label }) {
  const coche = new Set(valeurs);
  const basculer = (id) => {
    const n = new Set(coche);
    if (n.has(id)) n.delete(id); else n.add(id);
    onChange([...n]);
  };
  return (
    <div className="cm-cases" role="group" aria-label={label}>
      {options.length === 0 ? <div className="cm-vide-liste">{vide}</div> : options.map((o) => (
        <label key={o.id}>
          <input type="checkbox" checked={coche.has(o.id)} onChange={() => basculer(o.id)} />
          <span>{o.libelle}{o.detail && <span className="cm-sous">{o.detail}</span>}</span>
        </label>
      ))}
    </div>
  );
}

export const fmtMontant = (n, devise = 'FCFA') => (n === null || n === undefined || n === ''
  ? '—' : `${Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${devise}`);
export const fmtQte = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 3 }));

// Enregistrement standard : POST si nouveau, PUT sinon. Renvoie { ok, data, error }.
export const enregistrer = async (url, id, corps) => {
  const r = id ? await api.put(`${url}/${id}`, corps) : await api.post(url, corps);
  return r?.error ? { ok: false, error: r.error } : { ok: true, data: r };
};
