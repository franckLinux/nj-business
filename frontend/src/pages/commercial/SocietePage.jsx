// NJ COMMERCIAL — Société : identité reprise de l'Entité (non dupliquée) + paramètres du module.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { Entete, Section, Champ, Bascule } from '@/components/commercial/ui';

const LIGNES = [
  ['raison_sociale', 'Raison sociale'], ['sigle', 'Sigle'], ['forme_juridique', 'Forme juridique'], ['adresse', 'Adresse du siège'],
  ['boite_postale', 'Boîte postale'], ['ville', 'Ville'], ['pays', 'Pays'], ['telephone', 'Téléphone'], ['email', 'E-mail'],
  ['nui', 'NUI (identifiant fiscal)'], ['registre_commerce', 'Registre de commerce'], ['devise', 'Devise principale'],
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

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const enregistrer = async (e) => {
    e.preventDefault();
    setEnCours(true);
    const r = await api.put('/commercial/societe', f);
    setEnCours(false);
    if (r?.error) { setErreur(r.error); return; }
    setErreur(''); toast('Paramètres de la société enregistrés.', 'success'); charger();
  };

  if (!d || !f) return <div className="cm-page">{erreur ? <div className="cm-erreur">{erreur}</div> : <div className="loading-msg">Chargement…</div>}</div>;
  const id = d.identite;
  return (
    <form className="cm-page" onSubmit={enregistrer}>
      <Entete titre="Société" description="L'identité vient de Configuration → Entité : elle n'est saisie qu'une fois et sert à la caisse comme aux achats.">
        {modifiable && <button type="submit" className="cm-btn cm-primaire" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</button>}
      </Entete>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
        <Section titre="Identité de l'entreprise">
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 12 }}>
            {id.logo_url ? <img src={id.logo_url} alt="Logo" style={{ maxHeight: 56, maxWidth: 140, objectFit: 'contain' }} />
              : <span className="cm-pastille cm-off">Pas de logo</span>}
          </div>
          <dl style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: '7px 12px', fontSize: 13, margin: 0 }}>
            {LIGNES.map(([k, l]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt style={{ color: 'var(--text-muted)' }}>{l}</dt>
                <dd style={{ margin: 0, fontWeight: 600, wordBreak: 'break-word' }}>{id[k] || <span style={{ color: 'var(--text-light)', fontWeight: 400 }}>non renseigné</span>}</dd>
              </div>
            ))}
          </dl>
          {can('config.edit') && <p className="cm-aide" style={{ marginTop: 12 }}><Link to="/config">Modifier dans Configuration → Entité</Link></p>}
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
        </div>
      </div>
    </form>
  );
}
