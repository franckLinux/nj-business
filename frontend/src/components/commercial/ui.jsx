// NJ COMMERCIAL — briques d'interface partagées par les écrans du module.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api';
import { useToast } from '@/context/ToastContext';

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

// Unité + conversion (055) : « 1 carton = 12 pièce ». Le coefficient n'est demandé
// que si l'unité choisie n'est pas l'unité de stock (qui vaut toujours 1).
export function ChampUnite({ label, id, unites, valeur, onUnite, coef, onCoef, stockId, disabled, requis, aide }) {
  const stock = unites.find((u) => String(u.id) === String(stockId));
  const choisie = unites.find((u) => String(u.id) === String(valeur));
  const autre = Boolean(choisie && stock && String(choisie.id) !== String(stock.id));
  return (
    <div className="cm-champ">
      <label htmlFor={id}>{label}{requis && <span className="cm-req" aria-hidden="true">*</span>}</label>
      <div className="cm-unite">
        <select id={id} value={valeur} onChange={(e) => onUnite(e.target.value)} disabled={disabled}>
          <option value="">{stock ? `Même que le stock (${stock.code})` : '— Choisir —'}</option>
          {unites.filter((u) => u.actif || String(u.id) === String(valeur)).map((u) => <option key={u.id} value={u.id}>{u.code}{u.libelle && u.libelle !== u.code ? ` — ${u.libelle}` : ''}</option>)}
        </select>
        {autre && (
          <span className="cm-conversion">
            1 {choisie.code} =
            <input inputMode="decimal" value={coef} onChange={(e) => onCoef(e.target.value)} disabled={disabled} aria-label={`Nombre de ${stock.code} dans 1 ${choisie.code}`} />
            {stock.code}
          </span>
        )}
      </div>
      {aide && <span className="cm-aide">{aide}</span>}
    </div>
  );
}

// ── Création rapide d'une unité (062) ──────────────────────────────────────
// Bouton « + » placé à côté d'un champ d'unité : ouvre une fenêtre modale AU-DESSUS
// du formulaire en cours. Le formulaire n'est ni fermé, ni rechargé, ni vidé :
// Échap, Annuler ou un clic hors de la fenêtre ne ferment que la modale. Après
// l'enregistrement, `onCree(unite)` reçoit l'unité créée (le parent l'ajoute à sa
// liste et la sélectionne).
export const DECIMALES_UNITE = [[0, 'Aucune — nombres entiers (pièce, carton, sac)'], [1, '1 décimale'], [2, '2 décimales'], [3, '3 décimales (kg, litre, mètre)']];
const memeMot = (a, b) => String(a || '').trim().replace(/\s+/g, ' ').toLowerCase() === String(b || '').trim().replace(/\s+/g, ' ').toLowerCase();

export function UniteRapide({ unites = [], onCree, disabled, titre = 'Créer une nouvelle unité' }) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <>
      <button type="button" className="cm-btn-plus" onClick={() => setOuvert(true)} disabled={disabled} title={titre} aria-label={titre}>+</button>
      {ouvert && <ModaleUnite unites={unites} onFermer={() => setOuvert(false)} onCree={(x) => { setOuvert(false); onCree(x); }} />}
    </>
  );
}

function ModaleUnite({ unites, onFermer, onCree }) {
  const toast = useToast();
  const [f, setF] = useState({ code: '', libelle: '', decimales: '0' });
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  const boite = useRef(null);
  const retour = useRef(typeof document !== 'undefined' ? document.activeElement : null);
  useEffect(() => {
    // Phase de capture : Échap est arrêté ici et n'atteint jamais le formulaire en dessous.
    const touche = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onFermer(); return; }
      if (e.key === 'Tab' && boite.current) {           // le focus reste dans la fenêtre
        const z = [...boite.current.querySelectorAll('input, select, button:not([disabled])')];
        if (!z.length) return;
        if (e.shiftKey && document.activeElement === z[0]) { e.preventDefault(); z[z.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === z[z.length - 1]) { e.preventDefault(); z[0].focus(); }
      }
    };
    window.addEventListener('keydown', touche, true);
    boite.current?.querySelector('input')?.focus();
    return () => { window.removeEventListener('keydown', touche, true); retour.current?.focus?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const code = f.code.trim();
  const libelle = f.libelle.trim();
  const doublon = code ? unites.find((x) => [x.code, x.libelle].some((m) => memeMot(m, code) || (libelle && memeMot(m, libelle)))) : null;
  const valider = async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!code) { setErreur('Indiquez le code de l\'unité (ex. CARTON, SAC, KG).'); return; }
    if (doublon) { setErreur(`L'unité « ${doublon.code} » existe déjà : choisissez-la dans la liste.`); return; }
    setEnCours(true); setErreur('');
    const r = await api.post('/commercial/unites', { code, libelle: libelle || code, decimales: Number(f.decimales) });
    setEnCours(false);
    if (r?.error) { setErreur(r.error); return; }
    toast(`Unité ${r.code} créée et sélectionnée.`, 'success');
    onCree(r);
  };
  return createPortal(
    <div className="cm-modale-voile" onMouseDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onFermer(); }}>
      <form className="cm-modale" role="dialog" aria-modal="true" aria-labelledby="cm-mu-titre" ref={boite} onSubmit={valider} noValidate>
        <div className="cm-modale-tete">
          <h3 id="cm-mu-titre">Nouvelle unité de mesure</h3>
          <button type="button" className="cm-fermer" onClick={onFermer} aria-label="Fermer la fenêtre">✕</button>
        </div>
        <div className="cm-modale-corps">
          <p className="cm-aide" style={{ marginTop: 0, marginBottom: 12 }}>Le formulaire en cours reste ouvert : rien de ce qui est saisi n'est perdu.</p>
          {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
          <div className="cm-grille">
            <Champ label="Code" requis id="mu-code" aide="Tel qu'il s'affiche sur les documents : CARTON, SAC, KG…">
              <input id="mu-code" value={f.code} onChange={(e) => { setF({ ...f, code: e.target.value }); setErreur(''); }} maxLength={20} autoComplete="off" />
            </Champ>
            <Champ label="Libellé" id="mu-lib" aide="Facultatif. Ex. Carton de 12 bouteilles.">
              <input id="mu-lib" value={f.libelle} onChange={(e) => { setF({ ...f, libelle: e.target.value }); setErreur(''); }} maxLength={60} autoComplete="off" />
            </Champ>
            <Champ label="Décimales autorisées" id="mu-dec" pleine>
              <select id="mu-dec" value={f.decimales} onChange={(e) => setF({ ...f, decimales: e.target.value })}>
                {DECIMALES_UNITE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Champ>
          </div>
          {doublon && !erreur && <p className="cm-aide" style={{ color: '#b45309', marginTop: 8 }}>« {doublon.code} » existe déjà{doublon.actif ? '' : ' (inactive)'} : inutile de la recréer.</p>}
        </div>
        <div className="cm-modale-pied">
          <button type="button" className="cm-btn cm-secondaire" onClick={onFermer}>Annuler</button>
          <button type="submit" className="cm-btn cm-primaire" disabled={enCours || !code || Boolean(doublon)}>{enCours ? 'Enregistrement…' : 'Créer l\'unité'}</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

// ── Taxe choisie à la saisie de l'opération (062) ─────────────────────────
// Les taxes ne sont plus portées par les familles ni les articles : on choisit ici
// la taxe de l'opération, appliquée d'un clic à toutes les lignes (puis modifiable
// ligne par ligne). `valeur` sert aussi de taxe proposée aux lignes ajoutées ensuite.
export function TaxeOperation({ taxes, valeur, onChange, onAppliquer, nature = 'achat', disabled }) {
  return (
    <div className="cm-applique-tout">
      <label htmlFor={`taxe-op-${nature}`}><strong>Taxe de l'opération</strong></label>
      <select id={`taxe-op-${nature}`} value={valeur} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">Aucune (exonéré)</option>
        {taxes.map((t) => <option key={t.id} value={t.id}>{t.code} — {String(t.taux).replace('.', ',')} %</option>)}
      </select>
      <button type="button" className="cm-btn cm-secondaire" style={{ height: 34 }} onClick={() => onAppliquer(valeur)} disabled={disabled}>Appliquer à toutes les lignes</button>
      <span className="cm-aide">{nature === 'vente' ? 'Taxes de vente' : 'Taxes d\'achat'} seulement. Chaque ligne reste modifiable.</span>
    </div>
  );
}
