// NJ COMMERCIAL — Fournisseurs / Clients : le registre des tiers existant (partagé avec la caisse)
// complété des informations d'achat. Les coordonnées bancaires demandent une permission dédiée.
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { Entete, Statut, Tiroir, Section, Champ, Bascule, Cases, useListe, useDiffere, enregistrer } from '@/components/commercial/ui';

const LIB = {
  fournisseur: { titre: 'Fournisseurs', un: 'fournisseur', nouveau: 'Nouveau fournisseur' },
  client: { titre: 'Clients', un: 'client', nouveau: 'Nouveau client' },
};

function FicheTiers({ type, tiers, onFermer, onEnregistre, modifiable, peutBanque }) {
  const [f, setF] = useState({
    type: tiers?.type || type, nom: tiers?.nom || '', code: tiers?.code || '', nom_commercial: tiers?.nom_commercial || '',
    nui: tiers?.nui || '', rccm: tiers?.rccm || '', adresse: tiers?.adresse || '', ville: tiers?.ville || '', pays: tiers?.pays || '',
    telephone: tiers?.telephone || '', email: tiers?.email || '', contact_nom: tiers?.contact_nom || '',
    contact_telephone: tiers?.contact_telephone || '', contact_email: tiers?.contact_email || '',
    conditions_paiement: tiers?.conditions_paiement || '', actif: tiers ? tiers.actif : true,
    famille_ids: (tiers?.familles || []).map((x) => x.id),
  });
  const [banque, setBanque] = useState({ banque: tiers?.banque || '', titulaire: tiers?.titulaire || '', rib_iban: tiers?.rib_iban || '', swift: tiers?.swift || '' });
  const [banqueModifiee, setBanqueModifiee] = useState(false);
  const [familles, setFamilles] = useState(null);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  const fournit = f.type !== 'client';
  useEffect(() => { if (fournit) api.get('/commercial/familles').then((r) => setFamilles(r?.error ? [] : r)); }, [fournit]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setB = (k) => (e) => { setBanque((x) => ({ ...x, [k]: e.target.value })); setBanqueModifiee(true); };
  const valider = async () => {
    setEnCours(true);
    const corps = { ...f, ...(fournit ? {} : { famille_ids: [] }), ...(peutBanque && banqueModifiee ? { banque } : {}) };
    if (!fournit && !(tiers?.familles || []).length) delete corps.famille_ids;
    const r = await enregistrer('/commercial/tiers', tiers?.id, corps);
    setEnCours(false);
    if (!r.ok) { setErreur(r.error); return; }
    onEnregistre(tiers ? 'Fiche enregistrée.' : `${f.nom} ajouté au registre des tiers.`);
  };
  return (
    <Tiroir titre={tiers ? tiers.nom : LIB[type].nouveau} sousTitre={tiers ? `${tiers.code ? `${tiers.code} · ` : ''}registre des tiers` : 'Ajouté au registre des tiers, commun avec la caisse'}
      onFermer={onFermer}
      pied={<>
        <button type="button" className="cm-btn cm-secondaire" onClick={onFermer}>Annuler</button>
        {modifiable && <button type="button" className="cm-btn cm-primaire" onClick={valider} disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</button>}
      </>}>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      <Section titre="Identité">
        <div className="cm-grille">
          <Champ label="Raison sociale" requis id="tn" pleine><input id="tn" value={f.nom} onChange={set('nom')} maxLength={200} disabled={!modifiable} /></Champ>
          <Champ label="Code" id="tco" aide="Ex. F001 — unique."><input id="tco" value={f.code} onChange={set('code')} maxLength={20} disabled={!modifiable} style={{ textTransform: 'uppercase' }} /></Champ>
          <Champ label="Nom commercial" id="tnc"><input id="tnc" value={f.nom_commercial} onChange={set('nom_commercial')} maxLength={150} disabled={!modifiable} /></Champ>
          <Champ label="Nature" id="tty">
            <select id="tty" value={f.type} onChange={set('type')} disabled={!modifiable}>
              <option value="fournisseur">Fournisseur</option><option value="client">Client</option><option value="mixte">Client et fournisseur</option>
            </select>
          </Champ>
          <div className="cm-champ">
            <span className="cm-etiquette">Statut</span>
            <Bascule label="Statut du tiers" oui="Actif" non="Inactif" valeur={f.actif} onChange={(v) => modifiable && setF((x) => ({ ...x, actif: v }))} />
          </div>
          <Champ label="NUI" id="tnui" aide="Identifiant unique (ex. M012345678901A)."><input id="tnui" value={f.nui} onChange={set('nui')} maxLength={30} disabled={!modifiable} style={{ textTransform: 'uppercase' }} /></Champ>
          <Champ label="Registre de commerce" id="trc"><input id="trc" value={f.rccm} onChange={set('rccm')} maxLength={60} disabled={!modifiable} /></Champ>
        </div>
      </Section>
      <Section titre="Coordonnées">
        <div className="cm-grille">
          <Champ label="Adresse" id="tad" pleine><input id="tad" value={f.adresse} onChange={set('adresse')} maxLength={300} disabled={!modifiable} /></Champ>
          <Champ label="Ville" id="tvi"><input id="tvi" value={f.ville} onChange={set('ville')} maxLength={80} disabled={!modifiable} /></Champ>
          <Champ label="Pays" id="tpa"><input id="tpa" value={f.pays} onChange={set('pays')} maxLength={80} disabled={!modifiable} /></Champ>
          <Champ label="Téléphone" id="tte"><input id="tte" type="tel" value={f.telephone} onChange={set('telephone')} maxLength={40} disabled={!modifiable} /></Champ>
          <Champ label="E-mail" id="tem"><input id="tem" type="email" value={f.email} onChange={set('email')} maxLength={120} disabled={!modifiable} /></Champ>
          <Champ label="Contact principal" id="tcn"><input id="tcn" value={f.contact_nom} onChange={set('contact_nom')} maxLength={120} disabled={!modifiable} /></Champ>
          <Champ label="Téléphone du contact" id="tct"><input id="tct" type="tel" value={f.contact_telephone} onChange={set('contact_telephone')} maxLength={40} disabled={!modifiable} /></Champ>
          <Champ label="E-mail du contact" id="tce" pleine><input id="tce" type="email" value={f.contact_email} onChange={set('contact_email')} maxLength={150} disabled={!modifiable} /></Champ>
        </div>
      </Section>
      {fournit && (
        <Section titre="Achats">
          <div className="cm-grille">
            <Champ label="Conditions de paiement" id="tcp" pleine aide="Ex. 30 jours fin de mois, comptant à la livraison.">
              <input id="tcp" value={f.conditions_paiement} onChange={set('conditions_paiement')} maxLength={300} disabled={!modifiable} />
            </Champ>
            <div className="cm-champ cm-pleine">
              <span className="cm-etiquette">Familles d'articles fournies ({f.famille_ids.length})</span>
              {familles === null ? <div className="loading-msg">Chargement…</div> : (
                <Cases label="Familles fournies" options={familles.filter((x) => x.actif || f.famille_ids.includes(x.id)).map((x) => ({ id: x.id, libelle: `${x.code} — ${x.nom}` }))}
                  valeurs={f.famille_ids} onChange={(v) => modifiable && setF((x) => ({ ...x, famille_ids: v }))} vide="Aucune famille d'articles." />
              )}
            </div>
          </div>
        </Section>
      )}
      {fournit && (
        <Section titre="Coordonnées bancaires">
          {peutBanque ? (
            <div className="cm-grille">
              <Champ label="Banque" id="bb"><input id="bb" value={banque.banque} onChange={setB('banque')} maxLength={120} disabled={!modifiable} autoComplete="off" /></Champ>
              <Champ label="Titulaire du compte" id="bt"><input id="bt" value={banque.titulaire} onChange={setB('titulaire')} maxLength={150} disabled={!modifiable} autoComplete="off" /></Champ>
              <Champ label="RIB / IBAN" id="br" pleine><input id="br" value={banque.rib_iban} onChange={setB('rib_iban')} maxLength={60} disabled={!modifiable} autoComplete="off" spellCheck={false} /></Champ>
              <Champ label="Code SWIFT" id="bs"><input id="bs" value={banque.swift} onChange={setB('swift')} maxLength={20} disabled={!modifiable} autoComplete="off" style={{ textTransform: 'uppercase' }} /></Champ>
            </div>
          ) : (
            <p className="cm-aide">{tiers?.a_banque ? 'Coordonnées enregistrées. ' : ''}Leur consultation est réservée aux personnes habilitées.</p>
          )}
        </Section>
      )}
    </Tiroir>
  );
}

export default function TiersPage({ type }) {
  const { can } = useApp();
  const toast = useToast();
  const modifiable = can('com.tiers.modifier');
  const peutBanque = can('com.tiers.banque');
  const [q, setQ] = useState('');
  const [statut, setStatut] = useState('actifs');
  const qd = useDiffere(q);
  const { donnees, erreur, recharger } = useListe(`/commercial/tiers?type=${type}&q=${encodeURIComponent(qd)}&actifs=${statut === 'actifs' ? '1' : ''}`);
  const [fiche, setFiche] = useState(null);
  const liste = donnees || [];
  const L = LIB[type];
  return (
    <div className="cm-page">
      <Entete titre={L.titre} description={`Les ${L.titre.toLowerCase()} du registre des tiers, commun avec la caisse : une fiche créée ici est visible en caisse, et inversement.`}>
        {modifiable && <button type="button" className="cm-btn cm-primaire" onClick={() => setFiche('nouveau')}>+ {L.nouveau}</button>}
      </Entete>
      <div className="cm-outils">
        <input className="cm-recherche" type="search" placeholder="Rechercher un nom, un code, un NUI…" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Rechercher un ${L.un}`} />
        <select className="cm-select" value={statut} onChange={(e) => setStatut(e.target.value)} aria-label="Statut">
          <option value="actifs">Actifs</option><option value="">Tous</option>
        </select>
        <span className="cm-compteur">{donnees ? `${liste.length} ${L.un}${liste.length > 1 ? 's' : ''}` : ''}</span>
      </div>
      {erreur && <div className="cm-erreur">{erreur}</div>}
      <div className="cm-table-wrap">
        <table className="cm-table">
          <thead><tr><th>Code</th><th>Raison sociale</th><th>Contact</th><th>Ville</th>{type === 'fournisseur' && <th>Familles</th>}<th>Statut</th></tr></thead>
          <tbody>
            {!donnees ? <tr><td colSpan={6} className="cm-vide">Chargement…</td></tr>
              : liste.length === 0 ? <tr><td colSpan={6} className="cm-vide"><strong>Aucun {L.un}</strong></td></tr>
                : liste.map((t) => (
                  <tr key={t.id} className={'cm-cliquable' + (t.actif ? '' : ' cm-inactif')} onClick={() => setFiche(t)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setFiche(t); }}>
                    <td>{t.code ? <span className="cm-code">{t.code}</span> : <span className="cm-sous">—</span>}</td>
                    <td><strong>{t.nom}</strong><span className="cm-sous">{[t.nom_commercial, t.nui && `NUI ${t.nui}`, t.type === 'mixte' && 'client et fournisseur'].filter(Boolean).join(' · ')}</span></td>
                    <td>{t.contact_nom || '—'}{(t.contact_telephone || t.telephone) && <span className="cm-sous">{t.contact_telephone || t.telephone}</span>}</td>
                    <td>{t.ville || '—'}</td>
                    {type === 'fournisseur' && <td>{t.familles.length ? <div className="cm-puces">{t.familles.map((x) => <span key={x.id} className="cm-puce">{x.code}</span>)}</div> : '—'}</td>}
                    <td><Statut actif={t.actif} /></td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      {fiche && <FicheTiers type={type} tiers={fiche === 'nouveau' ? null : fiche} modifiable={modifiable} peutBanque={peutBanque}
        onFermer={() => setFiche(null)} onEnregistre={(msg) => { setFiche(null); toast(msg, 'success'); recharger(); }} />}
    </div>
  );
}
