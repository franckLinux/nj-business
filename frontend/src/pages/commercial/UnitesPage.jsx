// NJ COMMERCIAL — Unités de mesure (055). Les conversions (1 carton = 12 pièces) se
// règlent article par article, sur sa fiche : un carton n'a pas le même contenu partout.
import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { Entete, Statut, Tiroir, Section, Champ, Bascule, useListe, enregistrer } from '@/components/commercial/ui';

const DECIMALES = [[0, 'Aucune — on compte en nombres entiers (pièce, carton)'], [1, '1 décimale'], [2, '2 décimales'], [3, '3 décimales (kg, litre, mètre)']];

function FicheUnite({ unite, onFermer, onEnregistre, modifiable }) {
  const [f, setF] = useState({ code: unite?.code || '', libelle: unite?.libelle || '', decimales: unite ? unite.decimales : 0, actif: unite ? unite.actif : true });
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  const valider = async () => {
    setEnCours(true);
    const r = await enregistrer('/commercial/unites', unite?.id, { ...f, decimales: Number(f.decimales) });
    setEnCours(false);
    if (!r.ok) { setErreur(r.error); return; }
    onEnregistre(unite ? 'Unité modifiée.' : 'Unité créée.');
  };
  return (
    <Tiroir titre={unite ? `Unité ${unite.code}` : 'Nouvelle unité de mesure'} sousTitre="Comment une quantité se compte" onFermer={onFermer}
      pied={<>
        <button type="button" className="cm-btn cm-secondaire" onClick={onFermer}>Annuler</button>
        {modifiable && <button type="button" className="cm-btn cm-primaire" onClick={valider} disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</button>}
      </>}>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      <Section titre="Unité">
        <div className="cm-grille">
          <Champ label="Code" requis id="uc" aide="Tel qu'il s'affiche sur les documents : pièce, carton, kg…">
            <input id="uc" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} maxLength={20} disabled={!modifiable} />
          </Champ>
          <Champ label="Libellé" id="ul" aide="Ex. Carton de 12 bouteilles.">
            <input id="ul" value={f.libelle} onChange={(e) => setF({ ...f, libelle: e.target.value })} maxLength={60} disabled={!modifiable} />
          </Champ>
          <Champ label="Décimales autorisées" id="ud" pleine aide={unite ? 'Une unité déjà utilisée peut gagner des décimales, jamais en perdre.' : undefined}>
            <select id="ud" value={f.decimales} onChange={(e) => setF({ ...f, decimales: e.target.value })} disabled={!modifiable}>
              {DECIMALES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Champ>
          <div className="cm-champ">
            <span className="cm-etiquette">Statut</span>
            <Bascule label="Statut de l'unité" oui="Active" non="Inactive" valeur={f.actif} onChange={(v) => modifiable && setF((x) => ({ ...x, actif: v }))} />
          </div>
        </div>
      </Section>
    </Tiroir>
  );
}

export default function UnitesPage() {
  const { can } = useApp();
  const toast = useToast();
  const modifiable = can('com.parametrage.modifier');
  const { donnees, erreur, recharger } = useListe('/commercial/unites');
  const [fiche, setFiche] = useState(null);
  const liste = donnees || [];
  return (
    <div className="cm-page">
      <Entete titre="Unités de mesure" description="Les unités dans lesquelles on achète, vend et stocke. La conversion (1 carton = 12 pièces) se règle sur la fiche de chaque article, ou se propose par famille.">
        {modifiable && <button type="button" className="cm-btn cm-primaire" onClick={() => setFiche('nouveau')}>+ Nouvelle unité</button>}
      </Entete>
      {erreur && <div className="cm-erreur">{erreur}</div>}
      <div className="cm-table-wrap">
        <table className="cm-table">
          <thead><tr><th>Code</th><th>Libellé</th><th>Décimales</th><th className="cm-num">Articles</th><th>Statut</th></tr></thead>
          <tbody>
            {!donnees ? <tr><td colSpan={5} className="cm-vide">Chargement…</td></tr>
              : liste.length === 0 ? <tr><td colSpan={5} className="cm-vide"><strong>Aucune unité</strong>Exemples : pièce, carton, kg, litre, sac.</td></tr>
                : liste.map((u) => (
                  <tr key={u.id} className={'cm-cliquable' + (u.actif ? '' : ' cm-inactif')} onClick={() => setFiche(u)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setFiche(u); }}>
                    <td><span className="cm-code">{u.code}</span></td>
                    <td>{u.libelle}</td>
                    <td>{u.decimales === 0 ? 'Entiers' : `${u.decimales}`}</td>
                    <td className="cm-num">{u.nb_articles}</td>
                    <td><Statut actif={u.actif} oui="Active" non="Inactive" /></td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      {fiche && <FicheUnite unite={fiche === 'nouveau' ? null : fiche} modifiable={modifiable} onFermer={() => setFiche(null)}
        onEnregistre={(msg) => { setFiche(null); toast(msg, 'success'); recharger(); }} />}
    </div>
  );
}
