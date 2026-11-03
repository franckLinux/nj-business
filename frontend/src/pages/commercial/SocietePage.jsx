// NJ COMMERCIAL — Société : identité reprise de l'Entité (caisse) + règles du module.
// Un champ que la caisse ne renseigne pas peut être complété ici : il est gardé dans le
// module commercial (la caisse n'est jamais modifiée) et cède la place à la valeur de la
// caisse dès qu'elle existe.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { Entete, Section, Champ, Bascule } from '@/components/commercial/ui';

const LIGNES = [
  ['raison_sociale', 'Raison sociale'], ['sigle', 'Sigle', 30], ['forme_juridique', 'Forme juridique', 60], ['adresse', 'Adresse du siège', 300],
  ['boite_postale', 'Boîte postale', 60], ['ville', 'Ville', 100], ['pays', 'Pays', 100], ['telephone', 'Téléphone', 60], ['email', 'E-mail', 150],
  ['nui', 'NUI (identifiant fiscal)', 60], ['registre_commerce', 'Registre de commerce', 80], ['devise', 'Devise principale'],
];

export default function SocietePage() {
  const { can } = useApp();
  const toast = useToast();
  const modifiable = can('com.parametrage.modifier');
  const [d, setD] = useState(null);
  const [f, setF] = useState(null);
  const [c, setC] = useState({});        // compléments d'identité (champs vides dans la caisse)
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  const charger = async () => {
    const r = await api.get('/commercial/societe');
    if (r?.error) { setErreur(r.error); return; }
    setD(r);
    setC(r.complement || {});
    const p = r.parametres;
    setF({ ...p, seuil_direction: p.seuil_direction === null ? '' : String(p.seuil_direction), tolerance_ecart_pct: String(p.tolerance_ecart_pct) });
  };
  useEffect(() => { charger(); }, []);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const enregistrer = async (e) => {
    e.preventDefault();
    setEnCours(true);
    const r = await api.put('/commercial/societe', { ...f, identite_complement: c });
    setEnCours(false);
    if (r?.error) { setErreur(r.error); return; }
    setErreur(''); toast('Paramètres de la société enregistrés.', 'success'); charger();
  };

  if (!d || !f) return <div className="cm-page">{erreur ? <div className="cm-erreur">{erreur}</div> : <div className="loading-msg">Chargement…</div>}</div>;
  const id = d.identite;
  return (
    <form className="cm-page" onSubmit={enregistrer}>
      <Entete titre="Société" description="L'identité vient de la caisse (Configuration → Entité). Ce qu'elle ne renseigne pas peut être complété ici pour les documents du module commercial.">
        {modifiable && <button type="submit" className="cm-btn cm-primaire" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</button>}
      </Entete>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
        <Section titre="Identité de l'entreprise">
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 12 }}>
            {id.logo_url ? <img src={id.logo_url} alt="Logo" style={{ maxHeight: 56, maxWidth: 140, objectFit: 'contain' }} />
              : <span className="cm-pastille cm-off">Pas de logo</span>}
          </div>
          <dl className="cm-identite">
            {LIGNES.map(([k, l, max]) => {
              const caisse = d.identite_caisse?.[k];
              const aCompleter = max && !caisse;
              return (
                <div key={k} className="cm-identite-ligne">
                  <dt><label htmlFor={aCompleter && modifiable ? `id-${k}` : undefined}>{l}</label></dt>
                  <dd>
                    {caisse ? <><span className="cm-identite-val">{caisse}</span><span className="cm-source" title="Renseigné dans la caisse (Configuration → Entité)">caisse</span></>
                      : aCompleter && modifiable ? (
                        <input id={`id-${k}`} className="cm-identite-saisie" value={c[k] || ''} maxLength={max} placeholder="À compléter"
                          type={k === 'email' ? 'email' : 'text'} onChange={(e) => setC((x) => ({ ...x, [k]: e.target.value }))} />
                      ) : aCompleter && c[k] ? <><span className="cm-identite-val">{c[k]}</span><span className="cm-source cm-source-module">module</span></>
                        : <span className="cm-identite-vide">non renseigné</span>}
                  </dd>
                </div>
              );
            })}
          </dl>
          {modifiable && LIGNES.some(([k, , max]) => max && !d.identite_caisse?.[k]) && (
            <p className="cm-aide" style={{ marginTop: 10 }}>
              Les champs à compléter ne sont pas renseignés dans la caisse. Ce que vous saisissez ici sert aux documents du module commercial
              (bons de commande…) ; la caisse n'est pas modifiée, et sa valeur l'emportera si elle est renseignée plus tard.
            </p>
          )}
          {can('config.edit') && <p className="cm-aide" style={{ marginTop: 12 }}><Link to="/config">Modifier dans Configuration → Entité</Link></p>}
        </Section>
        <div>
          <Section titre="Règles du circuit d'achat">
            <div className="cm-grille">
              <Champ label={`Seuil de validation par la direction (${id.devise || 'FCFA'})`} id="sd" pleine
                aide="Au-delà de ce montant estimé, la direction valide après le responsable des achats. Vide : pas d'étape direction ; 0 : toujours.">
                <input id="sd" inputMode="decimal" value={f.seuil_direction} onChange={set('seuil_direction')} disabled={!modifiable} placeholder="Pas d'étape direction" />
              </Champ>
              <Champ label="Écart toléré sur le bon de commande (%)" id="te" pleine aide="Au-delà, le bon repasse en validation. Un changement de fournisseur y repasse toujours.">
                <input id="te" inputMode="decimal" value={f.tolerance_ecart_pct} onChange={set('tolerance_ecart_pct')} disabled={!modifiable} />
              </Champ>
              <div className="cm-champ cm-pleine">
                <span className="cm-etiquette">Bloquer une demande si le stock couvre déjà le besoin</span>
                <Bascule label="Blocage si stock suffisant" valeur={f.bloquer_si_stock_suffisant} onChange={(v) => modifiable && setF((x) => ({ ...x, bloquer_si_stock_suffisant: v }))} />
                <span className="cm-aide">Non : la demande est seulement signalée et le demandeur justifie le réapprovisionnement.</span>
              </div>
              <div className="cm-champ cm-pleine">
                <span className="cm-etiquette">Proforma du fournisseur obligatoire avant émission</span>
                <Bascule label="Proforma obligatoire" valeur={f.proforma_obligatoire} onChange={(v) => modifiable && setF((x) => ({ ...x, proforma_obligatoire: v }))} />
              </div>
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
