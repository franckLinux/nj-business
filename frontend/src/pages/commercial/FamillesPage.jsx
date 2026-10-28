// NJ COMMERCIAL — Familles d'articles et leurs fournisseurs (plusieurs à plusieurs).
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { Entete, Statut, Tiroir, Section, Champ, Bascule, Cases, useListe, useDiffere, enregistrer } from '@/components/commercial/ui';

function FicheFamille({ famille, onFermer, onEnregistre, modifiable }) {
  const [f, setF] = useState({
    code: famille?.code || '', nom: famille?.nom || '', description: famille?.description || '', actif: famille ? famille.actif : true,
    fournisseur_ids: (famille?.fournisseurs || []).map((x) => x.id),
  });
  const [fournisseurs, setFournisseurs] = useState(null);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  useEffect(() => {
    api.get('/commercial/tiers?type=fournisseur').then((r) => setFournisseurs(r?.error ? [] : r));
  }, []);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const valider = async () => {
    setEnCours(true);
    const r = await enregistrer('/commercial/familles', famille?.id, f);
    setEnCours(false);
    if (!r.ok) { setErreur(r.error); return; }
    onEnregistre(famille ? 'Famille modifiée.' : 'Famille créée.');
  };
  const options = (fournisseurs || [])
    .filter((t) => t.actif || f.fournisseur_ids.includes(t.id))
    .map((t) => ({ id: t.id, libelle: t.nom, detail: [t.code, t.ville, t.actif ? '' : 'inactif'].filter(Boolean).join(' · ') }));
  return (
    <Tiroir titre={famille ? `Famille ${famille.code}` : 'Nouvelle famille d\'articles'} sousTitre={famille?.nom} onFermer={onFermer}
      pied={<>
        <button type="button" className="cm-btn cm-secondaire" onClick={onFermer}>Annuler</button>
        {modifiable && <button type="button" className="cm-btn cm-primaire" onClick={valider} disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</button>}
      </>}>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      <Section titre="Identification">
        <div className="cm-grille">
          <Champ label="Code" requis id="fc" aide="Ex. FOURN, INFO, CONSO."><input id="fc" value={f.code} onChange={set('code')} maxLength={20} disabled={!modifiable} style={{ textTransform: 'uppercase' }} /></Champ>
          <Champ label="Nom" requis id="fn"><input id="fn" value={f.nom} onChange={set('nom')} maxLength={120} disabled={!modifiable} /></Champ>
          <Champ label="Description" id="fd" pleine><textarea id="fd" value={f.description} onChange={set('description')} maxLength={1000} disabled={!modifiable} /></Champ>
          <div className="cm-champ">
            <span className="cm-etiquette">Statut</span>
            <Bascule label="Statut de la famille" oui="Active" non="Inactive" valeur={f.actif} onChange={(v) => modifiable && setF((x) => ({ ...x, actif: v }))} />
          </div>
        </div>
      </Section>
      <Section titre={`Fournisseurs associés (${f.fournisseur_ids.length})`}>
        <p className="cm-aide" style={{ marginBottom: 8 }}>Ils seront proposés pour chaque article de la famille. Le demandeur pourra toujours choisir un autre fournisseur actif.</p>
        {fournisseurs === null ? <div className="loading-msg">Chargement…</div> : (
          <Cases label="Fournisseurs associés" options={options} valeurs={f.fournisseur_ids}
            onChange={(v) => modifiable && setF((x) => ({ ...x, fournisseur_ids: v }))}
            vide="Aucun fournisseur : créez-les d'abord dans Paramétrage → Fournisseurs." />
        )}
      </Section>
    </Tiroir>
  );
}

export default function FamillesPage() {
  const { can } = useApp();
  const toast = useToast();
  const modifiable = can('com.parametrage.modifier');
  const [q, setQ] = useState('');
  const qd = useDiffere(q);
  const { donnees, erreur, recharger } = useListe(`/commercial/familles?q=${encodeURIComponent(qd)}`);
  const [fiche, setFiche] = useState(null);
  const liste = donnees || [];
  return (
    <div className="cm-page">
      <Entete titre="Familles d'articles" description="Chaque article appartient à une famille. Une famille peut avoir plusieurs fournisseurs, et un fournisseur servir plusieurs familles.">
        {modifiable && <button type="button" className="cm-btn cm-primaire" onClick={() => setFiche('nouveau')}>+ Nouvelle famille</button>}
      </Entete>
      <div className="cm-outils">
        <input className="cm-recherche" type="search" placeholder="Rechercher un code ou un nom…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher une famille" />
        <span className="cm-compteur">{donnees ? `${liste.length} famille${liste.length > 1 ? 's' : ''}` : ''}</span>
      </div>
      {erreur && <div className="cm-erreur">{erreur}</div>}
      <div className="cm-table-wrap">
        <table className="cm-table">
          <thead><tr><th>Code</th><th>Nom</th><th>Fournisseurs associés</th><th className="cm-num">Articles</th><th>Statut</th></tr></thead>
          <tbody>
            {!donnees ? <tr><td colSpan={5} className="cm-vide">Chargement…</td></tr>
              : liste.length === 0 ? <tr><td colSpan={5} className="cm-vide"><strong>Aucune famille</strong>Exemples : fournitures de bureau, matériel informatique, consommables.</td></tr>
                : liste.map((x) => (
                  <tr key={x.id} className={'cm-cliquable' + (x.actif ? '' : ' cm-inactif')} onClick={() => setFiche(x)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setFiche(x); }}>
                    <td><span className="cm-code">{x.code}</span></td>
                    <td><strong>{x.nom}</strong>{x.description && <span className="cm-sous">{x.description.slice(0, 80)}</span>}</td>
                    <td>{x.fournisseurs.length ? <div className="cm-puces">{x.fournisseurs.slice(0, 4).map((t) => <span key={t.id} className="cm-puce">{t.nom}</span>)}{x.fournisseurs.length > 4 && <span className="cm-puce">+{x.fournisseurs.length - 4}</span>}</div> : <span className="cm-pastille cm-alerte">Aucun</span>}</td>
                    <td className="cm-num">{x.nb_articles}</td>
                    <td><Statut actif={x.actif} oui="Active" non="Inactive" /></td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      {fiche && <FicheFamille famille={fiche === 'nouveau' ? null : fiche} modifiable={modifiable} onFermer={() => setFiche(null)}
        onEnregistre={(msg) => { setFiche(null); toast(msg, 'success'); recharger(); }} />}
    </div>
  );
}
