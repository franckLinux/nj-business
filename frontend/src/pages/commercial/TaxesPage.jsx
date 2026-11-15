// NJ COMMERCIAL — Taxes. Le taux repris dans un document ne change jamais (copie à l'émission).
import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { Entete, Statut, Tiroir, Section, Champ, Bascule, useListe, enregistrer } from '@/components/commercial/ui';

const TYPES = [['tva', 'TVA'], ['precompte', 'Précompte / retenue'], ['autre', 'Autre']];
const dateFr = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '');

function FicheTaxe({ taxe, onFermer, onEnregistre, modifiable }) {
  const [f, setF] = useState({
    code: taxe?.code || '', intitule: taxe?.intitule || '', taux: taxe ? String(taxe.taux).replace('.', ',') : '', type: taxe?.type || 'tva',
    description: taxe?.description || '', debut: taxe?.debut ? String(taxe.debut).slice(0, 10) : '', fin: taxe?.fin ? String(taxe.fin).slice(0, 10) : '',
    actif: taxe ? taxe.actif : true, usage: taxe?.usage || 'les_deux',
  });
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const valider = async () => {
    setEnCours(true);
    const r = await enregistrer('/commercial/taxes', taxe?.id, f);
    setEnCours(false);
    if (!r.ok) { setErreur(r.error); return; }
    onEnregistre(taxe ? 'Taxe modifiée.' : 'Taxe créée.');
  };
  return (
    <Tiroir titre={taxe ? `Taxe ${taxe.code}` : 'Nouvelle taxe'} sousTitre={taxe?.intitule} onFermer={onFermer}
      pied={<>
        <button type="button" className="cm-btn cm-secondaire" onClick={onFermer}>Annuler</button>
        {modifiable && <button type="button" className="cm-btn cm-primaire" onClick={valider} disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</button>}
      </>}>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      <div className="cm-note">Configurez les taxes selon la réglementation applicable à l'entreprise : aucune taxe n'est imposée par défaut. La taxe se choisit à la saisie de chaque opération, ligne par ligne.</div>
      <Section titre="Taxe">
        <div className="cm-grille">
          <Champ label="Code" requis id="tc"><input id="tc" value={f.code} onChange={set('code')} maxLength={20} disabled={!modifiable} style={{ textTransform: 'uppercase' }} /></Champ>
          <Champ label="Type" id="tt">
            <select id="tt" value={f.type} onChange={set('type')} disabled={!modifiable}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </Champ>
          <Champ label="Usage" id="tu" aide="Une taxe réservée aux ventes ne peut pas être choisie à l'achat, et inversement.">
            <select id="tu" value={f.usage} onChange={set('usage')} disabled={!modifiable}>
              <option value="les_deux">Achats et ventes</option><option value="achat">Achats seulement</option><option value="vente">Ventes seulement</option>
            </select>
          </Champ>
          <Champ label="Intitulé" requis id="ti" pleine><input id="ti" value={f.intitule} onChange={set('intitule')} maxLength={120} disabled={!modifiable} /></Champ>
          <Champ label="Taux (%)" requis id="tx" aide="De 0 à 100. Ex. 19,25"><input id="tx" inputMode="decimal" value={f.taux} onChange={set('taux')} disabled={!modifiable} /></Champ>
          <div className="cm-champ">
            <span className="cm-etiquette">Statut</span>
            <Bascule label="Statut de la taxe" oui="Active" non="Inactive" valeur={f.actif} onChange={(v) => modifiable && setF((x) => ({ ...x, actif: v }))} />
          </div>
          <Champ label="Valable du" id="td"><input id="td" type="date" value={f.debut} onChange={set('debut')} disabled={!modifiable} /></Champ>
          <Champ label="au" id="tf"><input id="tf" type="date" value={f.fin} onChange={set('fin')} disabled={!modifiable} /></Champ>
          <Champ label="Description" id="tde" pleine><textarea id="tde" value={f.description} onChange={set('description')} maxLength={1000} disabled={!modifiable} /></Champ>
        </div>
      </Section>
    </Tiroir>
  );
}

export default function TaxesPage() {
  const { can } = useApp();
  const toast = useToast();
  const modifiable = can('com.parametrage.modifier');
  const { donnees, erreur, recharger } = useListe('/commercial/taxes');
  const [fiche, setFiche] = useState(null);
  const liste = donnees || [];
  return (
    <div className="cm-page">
      <Entete titre="Taxes" description="Les taxes proposées à la saisie des opérations (bons de commande, factures fournisseurs, devis). Elles ne se fixent plus sur les familles ni sur les articles. Le taux appliqué est copié dans chaque document : modifier une taxe ne change pas les documents déjà enregistrés.">
        {modifiable && <button type="button" className="cm-btn cm-primaire" onClick={() => setFiche('nouveau')}>+ Nouvelle taxe</button>}
      </Entete>
      {erreur && <div className="cm-erreur">{erreur}</div>}
      <div className="cm-table-wrap">
        <table className="cm-table">
          <thead><tr><th>Code</th><th>Intitulé</th><th>Type</th><th>Usage</th><th className="cm-num">Taux</th><th>Validité</th><th className="cm-num">Lignes de documents</th><th>Statut</th></tr></thead>
          <tbody>
            {!donnees ? <tr><td colSpan={8} className="cm-vide">Chargement…</td></tr>
              : liste.length === 0 ? <tr><td colSpan={8} className="cm-vide"><strong>Aucune taxe</strong>{modifiable ? 'Ajoutez les taxes applicables à l\'entreprise.' : ''}</td></tr>
                : liste.map((x) => (
                  <tr key={x.id} className={'cm-cliquable' + (x.actif ? '' : ' cm-inactif')} onClick={() => setFiche(x)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setFiche(x); }}>
                    <td><span className="cm-code">{x.code}</span></td>
                    <td><strong>{x.intitule}</strong></td>
                    <td>{x.type_libelle}</td>
                    <td>{x.usage_libelle}</td>
                    <td className="cm-num"><strong>{x.taux.toLocaleString('fr-FR', { maximumFractionDigits: 4 })} %</strong></td>
                    <td>{x.debut || x.fin ? `${dateFr(x.debut) || '…'} → ${dateFr(x.fin) || '…'}` : 'Sans limite'}</td>
                    <td className="cm-num">{x.nb_utilisations}</td>
                    <td><Statut actif={x.actif} oui="Active" non="Inactive" /></td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      {fiche && <FicheTaxe taxe={fiche === 'nouveau' ? null : fiche} modifiable={modifiable} onFermer={() => setFiche(null)}
        onEnregistre={(msg) => { setFiche(null); toast(msg, 'success'); recharger(); }} />}
    </div>
  );
}
