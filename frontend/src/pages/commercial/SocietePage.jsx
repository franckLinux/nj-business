// NJ COMMERCIAL — Société : identité de l'Entité (comme dans la caisse) + documents d'achat + règles du stock.
//   • client qui a NJ CAISSE PRO : identité en lecture seule (elle se modifie dans la caisse) ;
//   • client sans la caisse : « mode remplissage », l'identité se saisit ici et alimente
//     l'Entité, que la caisse reprendra si elle est activée plus tard.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { Entete, Section, Champ, Bascule } from '@/components/commercial/ui';

// [clé, libellé, longueur max, pleine largeur]
const LIGNES = [
  ['raison_sociale', 'Raison sociale', 200, true], ['sigle', 'Sigle', 30], ['forme_juridique', 'Forme juridique', 20],
  ['nui', 'NUI (identifiant fiscal)', 20], ['registre_commerce', 'Registre de commerce', 80],
  ['adresse', 'Adresse du siège', 300, true], ['boite_postale', 'Boîte postale', 60], ['ville', 'Ville', 100], ['pays', 'Pays', 100],
  ['telephone', 'Téléphone', 60], ['email', 'E-mail', 150], ['site_web', 'Site web', 200],
];
const champEntite = (k) => (k === 'raison_sociale' ? 'nom' : k);

export default function SocietePage() {
  const { can } = useApp();
  const toast = useToast();
  const modifiable = can('com.parametrage.modifier');
  const [d, setD] = useState(null);
  const [f, setF] = useState(null);
  const [ident, setIdent] = useState(null);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  const charger = async () => {
    const r = await api.get('/commercial/societe');
    if (r?.error) { setErreur(r.error); return; }
    setD(r);
    setIdent(Object.fromEntries(LIGNES.map(([k]) => [k, r.identite[k] || ''])));
    const p = r.parametres;
    setF({ ...p, seuil_direction: p.seuil_direction === null ? '' : String(p.seuil_direction), tolerance_ecart_pct: String(p.tolerance_ecart_pct) });
  };
  useEffect(() => { charger(); }, []);

  const remplissage = d?.mode_identite === 'remplissage';
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const enregistrer = async (e) => {
    e.preventDefault();
    setEnCours(true);
    const corps = { ...f };
    if (remplissage) corps.identite = Object.fromEntries(LIGNES.map(([k]) => [champEntite(k), ident[k]]));
    const r = await api.put('/commercial/societe', corps);
    setEnCours(false);
    if (r?.error) { setErreur(r.error); return; }
    setErreur(''); toast('Société enregistrée.', 'success'); charger();
  };

  if (!d || !f) return <div className="cm-page">{erreur ? <div className="cm-erreur">{erreur}</div> : <div className="loading-msg">Chargement…</div>}</div>;
  const id = d.identite;
  const forme = (code) => d.formes_juridiques?.find((x) => x.code === code)?.label || code;
  return (
    <form className="cm-page" onSubmit={enregistrer}>
      <Entete titre="Société"
        description={remplissage
          ? 'Ce client n\'utilise pas NJ CAISSE PRO : renseignez ici l\'identité de l\'entreprise. Elle sera reprise par la caisse si elle est activée plus tard.'
          : 'L\'identité vient de la caisse (Configuration → Entité) : elle n\'est saisie qu\'une fois et sert à la caisse comme au module commercial.'}>
        {modifiable && <button type="submit" className="cm-btn cm-primaire" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</button>}
      </Entete>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
        <Section titre="Identité de l'entreprise">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            {id.logo_url ? <img src={id.logo_url} alt="Logo" style={{ maxHeight: 56, maxWidth: 140, objectFit: 'contain' }} />
              : <span className="cm-pastille cm-off">Pas de logo</span>}
            <span className={`cm-pastille ${remplissage ? 'cm-info' : 'cm-ok'}`}>{remplissage ? 'À renseigner ici (sans caisse)' : 'Reprise de la caisse'}</span>
          </div>
          {remplissage && modifiable ? (
            <div className="cm-grille">
              {LIGNES.map(([k, l, max, pleine]) => (
                <Champ key={k} label={l} id={`id-${k}`} requis={k === 'raison_sociale'} pleine={pleine}>
                  {k === 'forme_juridique' ? (
                    <select id={`id-${k}`} value={ident[k]} onChange={(e) => setIdent((x) => ({ ...x, [k]: e.target.value }))}>
                      <option value="">— Choisir —</option>
                      {d.formes_juridiques.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
                    </select>
                  ) : (
                    <input id={`id-${k}`} value={ident[k]} maxLength={max} type={k === 'email' ? 'email' : 'text'}
                      style={['sigle', 'nui'].includes(k) ? { textTransform: 'uppercase' } : undefined}
                      onChange={(e) => setIdent((x) => ({ ...x, [k]: e.target.value }))} />
                  )}
                </Champ>
              ))}
              <Champ label="Devise principale" id="id-devise" aide="Réglée à la création du client.">
                <input id="id-devise" value={id.devise || 'FCFA'} disabled />
              </Champ>
            </div>
          ) : (
            <>
              <dl className="cm-identite">
                {[...LIGNES, ['devise', 'Devise principale']].map(([k, l]) => (
                  <div key={k} className="cm-identite-ligne">
                    <dt>{l}</dt>
                    <dd>{id[k] ? <span className="cm-identite-val">{k === 'forme_juridique' ? forme(id[k]) : id[k]}</span> : <span className="cm-identite-vide">non renseigné</span>}</dd>
                  </div>
                ))}
              </dl>
              {!remplissage && can('config.edit') && <p className="cm-aide" style={{ marginTop: 12 }}><Link to="/config">Modifier dans Configuration → Entité</Link></p>}
              {!remplissage && !can('config.edit') && <p className="cm-aide" style={{ marginTop: 12 }}>Elle se modifie dans la caisse, par une personne habilitée (Configuration → Entité).</p>}
            </>
          )}
        </Section>
        <div>
          <Section titre="Documents d'achat">
            <div className="cm-grille">
              <Champ label="Nom commercial" id="nc" pleine aide="Affiché à côté de la raison sociale sur les documents.">
                <input id="nc" value={f.nom_commercial} onChange={set('nom_commercial')} maxLength={150} disabled={!modifiable} />
              </Champ>
              <Champ label="Mentions des documents" id="md" pleine aide="Ex. conditions générales d'achat, adresse de livraison par défaut.">
                <textarea id="md" value={f.mentions_documents} onChange={set('mentions_documents')} maxLength={1000} disabled={!modifiable} />
              </Champ>
              <Champ label="Préfixe des demandes" id="pda" aide={`Ex. ${f.prefixe_da || 'DA'}-${new Date().getFullYear()}-0001`}>
                <input id="pda" value={f.prefixe_da} onChange={set('prefixe_da')} maxLength={6} disabled={!modifiable} style={{ textTransform: 'uppercase' }} />
              </Champ>
              <Champ label="Préfixe des bons de commande" id="pbc" aide={`Ex. ${f.prefixe_bc || 'BC'}-${new Date().getFullYear()}-0001`}>
                <input id="pbc" value={f.prefixe_bc} onChange={set('prefixe_bc')} maxLength={6} disabled={!modifiable} style={{ textTransform: 'uppercase' }} />
              </Champ>
            </div>
          </Section>
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
