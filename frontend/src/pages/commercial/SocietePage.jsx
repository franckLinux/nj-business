// NJ COMMERCIAL — Société : identité de l'entreprise (lecture seule) et règles du stock.
// 064 : l'identité vient de la configuration centrale NJ BUSINESS, commune à tous
// les modules ; elle s'y modifie, que la caisse soit activée ou non.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { Entete, Section, Bascule } from '@/components/commercial/ui';

// [clé, libellé]
const LIGNES = [
  ['raison_sociale', 'Raison sociale'], ['nom_commercial', 'Nom commercial'], ['sigle', 'Sigle'], ['forme_juridique', 'Forme juridique'],
  ['nui', 'NIU (identifiant fiscal)'], ['registre_commerce', 'Registre de commerce'],
  ['adresse', 'Adresse du siège'], ['boite_postale', 'Boîte postale'], ['ville', 'Ville'], ['pays', 'Pays'],
  ['telephone', 'Téléphone'], ['email', 'E-mail'], ['site_web', 'Site web'], ['devise', 'Devise principale'],
];

export default function SocietePage() {
  const { can } = useApp();
  const toast = useToast();
  const modifiable = can('com.parametrage.modifier');
  const [d, setD] = useState(null);
  const [f, setF] = useState(null);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  const charger = async () => {
    const r = await api.get('/commercial/societe');
    if (r?.error) { setErreur(r.error); return; }
    setD(r);
    const p = r.parametres;
    setF({ ...p, seuil_direction: p.seuil_direction === null ? '' : String(p.seuil_direction), tolerance_ecart_pct: String(p.tolerance_ecart_pct) });
  };
  useEffect(() => { charger(); }, []);

  const enregistrer = async (e) => {
    e.preventDefault();
    setEnCours(true);
    const { nom_commercial: _n, ...corps } = f;
    const r = await api.put('/commercial/societe', corps);
    setEnCours(false);
    if (r?.error) { setErreur(r.error); return; }
    setErreur(''); toast('Paramètres enregistrés.', 'success'); charger();
  };

  if (!d || !f) return <div className="cm-page">{erreur ? <div className="cm-erreur">{erreur}</div> : <div className="loading-msg">Chargement…</div>}</div>;
  const id = d.identite;
  const forme = (code) => d.formes_juridiques?.find((x) => x.code === code)?.label || code;
  return (
    <form className="cm-page" onSubmit={enregistrer}>
      <Entete titre="Société"
        description="L'identité de l'entreprise est commune à tous les modules : elle se modifie dans la configuration de l'entreprise. Ici, seules les règles propres au module commercial se règlent.">
        {modifiable && <button type="submit" className="cm-btn cm-primaire" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</button>}
      </Entete>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
        <Section titre="Identité de l'entreprise">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            {id.logo_url ? <img src={id.logo_url} alt="Logo" style={{ maxHeight: 56, maxWidth: 140, objectFit: 'contain' }} />
              : <span className="cm-pastille cm-off">Pas de logo</span>}
            <span className="cm-pastille cm-ok">Configuration de l'entreprise</span>
          </div>
          <dl className="cm-identite">
            {LIGNES.map(([k, l]) => (
              <div key={k} className="cm-identite-ligne">
                <dt>{l}</dt>
                <dd>{id[k] ? <span className="cm-identite-val">{k === 'forme_juridique' ? forme(id[k]) : id[k]}</span> : <span className="cm-identite-vide">non renseigné</span>}</dd>
              </div>
            ))}
          </dl>
          {can('entreprise.view')
            ? <p className="cm-aide" style={{ marginTop: 12 }}><Link to="/entreprise">{can('entreprise.edit') ? 'Modifier dans la configuration de l\'entreprise' : 'Voir la configuration de l\'entreprise'}</Link></p>
            : <p className="cm-aide" style={{ marginTop: 12 }}>Elle se modifie dans la configuration de l'entreprise, par une personne habilitée.</p>}
        </Section>
        <div>
          <Section titre="Règles du stock">
            <div className="cm-grille">
              <div className="cm-champ cm-pleine">
                <span className="cm-etiquette">Autoriser le stock négatif</span>
                <Bascule label="Stock négatif autorisé" valeur={f.stock_negatif_autorise} onChange={(v) => modifiable && setF((x) => ({ ...x, stock_negatif_autorise: v }))} />
                <span className="cm-aide">Non (recommandé) : une sortie, un transfert ou une annulation qui ferait passer un stock sous zéro est refusé.</span>
              </div>
              <div className="cm-champ cm-pleine">
                <span className="cm-etiquette">Permettre à l'auteur d'un document de stock ou d'achat (réception, retour, facture) de le valider lui-même</span>
                <Bascule label="Auto-validation des stocks" valeur={f.autovalidation_stock} onChange={(v) => modifiable && setF((x) => ({ ...x, autovalidation_stock: v }))} />
                <span className="cm-aide">Non (recommandé) : la personne qui saisit ne valide pas (séparation des tâches). Oui : à réserver aux petites structures ; chaque validation reste tracée.</span>
              </div>
            </div>
          </Section>
        </div>
      </div>
    </form>
  );
}
