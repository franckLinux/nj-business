// NJ COMMERCIAL — Familles d'articles et leurs fournisseurs (plusieurs à plusieurs).
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { Entete, Statut, Tiroir, Section, Champ, Bascule, Cases, ChampUnite, UniteRapide, useListe, useDiffere, enregistrer } from '@/components/commercial/ui';

// Code proposé à partir du nom (création seulement, tant qu'on n'a pas tapé de code) :
// « Matériel informatique » → MATERIEL. Toujours modifiable.
const codeDepuisNom = (nom) => (String(nom).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().match(/[A-Z0-9]+/g) || [''])[0].slice(0, 12);

function FicheFamille({ famille, onFermer, onEnregistre, modifiable }) {
  const [f, setF] = useState({
    code: famille?.code || '', nom: famille?.nom || '', description: famille?.description || '', actif: famille ? famille.actif : true,
    fournisseur_ids: (famille?.fournisseurs || []).map((x) => x.id),
    suivi_stock: famille ? famille.suivi_stock : true, methode_valorisation: famille?.methode_valorisation || 'cmup',
    unite_stock_id: famille?.unite_stock_id ? String(famille.unite_stock_id) : '',
    // '' = « Même que le stock » : achat et vente suivent l'unité de stock tant qu'on n'en choisit pas une autre.
    unite_achat_id: famille?.unite_achat_id && famille.unite_achat_id !== famille.unite_stock_id ? String(famille.unite_achat_id) : '',
    coef_achat: famille?.coef_achat && famille.unite_achat_id !== famille.unite_stock_id ? String(famille.coef_achat).replace('.', ',') : '',
    unite_vente_id: famille?.unite_vente_id && famille.unite_vente_id !== famille.unite_stock_id ? String(famille.unite_vente_id) : '',
    coef_vente: famille?.coef_vente && famille.unite_vente_id !== famille.unite_stock_id ? String(famille.coef_vente).replace('.', ',') : '',
  });
  const [codeSaisi, setCodeSaisi] = useState(Boolean(famille));
  const [unites, setUnites] = useState([]);
  const [fournisseurs, setFournisseurs] = useState(null);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  const chargerUnites = () => api.get('/commercial/unites').then((r) => { if (!r?.error) setUnites(r); return r; });
  useEffect(() => {
    api.get('/commercial/tiers?type=fournisseur').then((r) => setFournisseurs(r?.error ? [] : r));
    chargerUnites();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const choisirNom = (e) => {
    const nom = e.target.value;
    setF((x) => ({ ...x, nom, ...(codeSaisi ? {} : { code: codeDepuisNom(nom) }) }));
  };
  // Unité créée dans la fenêtre rapide : la liste est relue, l'unité choisie ; le reste du formulaire ne bouge pas.
  const uniteCreee = async (u) => {
    setUnites((l) => (l.some((x) => x.id === u.id) ? l : [...l, u]));
    await chargerUnites();
    setF((x) => ({ ...x, unite_stock_id: String(u.id) }));
  };
  const valider = async () => {
    if (!f.unite_stock_id) { setErreur('Choisissez l\'unité de stock de la famille (ou créez-la avec +).'); return; }
    setEnCours(true);
    const st = f.unite_stock_id;
    const r = await enregistrer('/commercial/familles', famille?.id, { ...f,
      unite_stock_id: st, unite_achat_id: f.unite_achat_id || st, unite_vente_id: f.unite_vente_id || st });
    setEnCours(false);
    if (!r.ok) { setErreur(r.error); return; }
    onEnregistre(famille ? 'Famille modifiée.' : 'Famille créée.');
  };
  const options = (fournisseurs || [])
    .filter((t) => t.actif || f.fournisseur_ids.includes(t.id))
    .map((t) => ({ id: t.id, libelle: t.nom, detail: [t.code, t.ville, t.actif ? '' : 'inactif'].filter(Boolean).join(' · ') }));
  const stock = unites.find((u) => String(u.id) === f.unite_stock_id);
  return (
    <Tiroir titre={famille ? `Famille ${famille.code}` : 'Nouvelle famille d\'articles'} sousTitre={famille?.nom} onFermer={onFermer}
      pied={<>
        <button type="button" className="cm-btn cm-secondaire" onClick={onFermer}>Annuler</button>
        {modifiable && <button type="button" className="cm-btn cm-primaire" onClick={valider} disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</button>}
      </>}>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      <Section titre="Famille et unités">
        <div className="cm-grille">
          <Champ label="Nom de la famille" requis id="fn"><input id="fn" value={f.nom} onChange={choisirNom} maxLength={120} disabled={!modifiable} /></Champ>
          <Champ label="Unité de stock" requis id="fus" aide="Unité de référence : les quantités en stock se comptent dans cette unité.">
            <div className="cm-avec-plus">
              <select id="fus" value={f.unite_stock_id} onChange={(e) => setF((x) => ({ ...x, unite_stock_id: e.target.value }))} disabled={!modifiable}>
                <option value="">— Choisir —</option>
                {unites.filter((u) => u.actif || String(u.id) === f.unite_stock_id).map((u) => <option key={u.id} value={u.id}>{u.code}{u.libelle && u.libelle !== u.code ? ` — ${u.libelle}` : ''}</option>)}
              </select>
              {modifiable && <UniteRapide unites={unites} onCree={uniteCreee} titre="Créer une unité de stock" />}
            </div>
          </Champ>
          <ChampUnite label="Unité d'achat" id="fua" unites={unites} valeur={f.unite_achat_id} stockId={f.unite_stock_id} disabled={!modifiable || !f.unite_stock_id}
            onUnite={(v) => setF((x) => ({ ...x, unite_achat_id: v === x.unite_stock_id ? '' : v }))} coef={f.coef_achat} onCoef={(v) => setF((x) => ({ ...x, coef_achat: v }))} />
          <ChampUnite label="Unité de vente" id="fuv" unites={unites} valeur={f.unite_vente_id} stockId={f.unite_stock_id} disabled={!modifiable || !f.unite_stock_id}
            onUnite={(v) => setF((x) => ({ ...x, unite_vente_id: v === x.unite_stock_id ? '' : v }))} coef={f.coef_vente} onCoef={(v) => setF((x) => ({ ...x, coef_vente: v }))} />
        </div>
        <p className="cm-aide" style={{ marginTop: 8 }}>
          {stock ? `Par défaut, on achète et on vend en ${stock.code}. ` : 'Par défaut, achat et vente reprennent l\'unité de stock. '}
          Choisissez une autre unité seulement si une conversion est nécessaire (1 carton = 12 pièces). Repris à la création de chaque article de la famille, puis modifiable article par article.
        </p>
      </Section>
      <Section titre="Autres informations">
        <div className="cm-grille">
          <Champ label="Code" requis id="fc" aide={famille ? 'Ex. FOURN, INFO, CONSO.' : 'Proposé à partir du nom ; modifiable.'}>
            <input id="fc" value={f.code} onChange={(e) => { setCodeSaisi(true); set('code')(e); }} maxLength={20} disabled={!modifiable} style={{ textTransform: 'uppercase' }} />
          </Champ>
          <div className="cm-champ">
            <span className="cm-etiquette">Statut</span>
            <Bascule label="Statut de la famille" oui="Active" non="Inactive" valeur={f.actif} onChange={(v) => modifiable && setF((x) => ({ ...x, actif: v }))} />
          </div>
          <Champ label="Description" id="fd" pleine><textarea id="fd" value={f.description} onChange={set('description')} maxLength={1000} disabled={!modifiable} /></Champ>
          <div className="cm-champ">
            <span className="cm-etiquette">Suivi en stock</span>
            <Bascule label="Suivi en stock" valeur={f.suivi_stock} onChange={(v) => modifiable && setF((x) => ({ ...x, suivi_stock: v }))} />
            {!f.suivi_stock && <span className="cm-aide">Services, frais… : aucun mouvement ni contrôle de quantité.</span>}
          </div>
          {f.suivi_stock && (
            <Champ label="Méthode de valorisation" requis id="fmv" aide="Appliquée par article et par magasin ; jamais mélangée sur un même article.">
              <select id="fmv" value={f.methode_valorisation} onChange={set('methode_valorisation')} disabled={!modifiable}>
                <option value="cmup">CMUP — coût moyen unitaire pondéré</option>
                <option value="fifo">FIFO — premier entré, premier sorti</option>
              </select>
            </Champ>
          )}
        </div>
        <div className="cm-note" style={{ marginTop: 12, marginBottom: 0 }}>Taxes : aucune taxe n'est fixée sur la famille. Elle se choisit à la saisie de chaque opération (bon de commande, facture fournisseur, devis).</div>
      </Section>
      <Section titre={`Fournisseurs associés (${f.fournisseur_ids.length})`}>
        <p className="cm-aide" style={{ marginBottom: 8 }}>Ils seront proposés pour chaque article de la famille. Le demandeur pourra toujours choisir un autre fournisseur actif.</p>
        {fournisseurs === null ? <div className="loading-msg">Chargement…</div> : (
          <Cases label="Fournisseurs associés" options={options} valeurs={f.fournisseur_ids}
            onChange={(v) => modifiable && setF((x) => ({ ...x, fournisseur_ids: v }))}
            vide="Aucun fournisseur : créez-les d'abord dans Configuration → Fournisseurs." />
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
      <Entete titre="Familles d'articles" description="Chaque article appartient à une famille, qui lui propose son unité de stock (achat et vente identiques par défaut). Une famille peut avoir plusieurs fournisseurs, et un fournisseur servir plusieurs familles.">
        {modifiable && <button type="button" className="cm-btn cm-primaire" onClick={() => setFiche('nouveau')}>+ Nouvelle famille</button>}
      </Entete>
      <div className="cm-outils">
        <input className="cm-recherche" type="search" placeholder="Rechercher un code ou un nom…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher une famille" />
        <span className="cm-compteur">{donnees ? `${liste.length} famille${liste.length > 1 ? 's' : ''}` : ''}</span>
      </div>
      {erreur && <div className="cm-erreur">{erreur}</div>}
      <div className="cm-table-wrap">
        <table className="cm-table">
          <thead><tr><th>Code</th><th>Nom</th><th>Unité de stock</th><th>Stock</th><th>Fournisseurs associés</th><th className="cm-num">Articles</th><th>Statut</th></tr></thead>
          <tbody>
            {!donnees ? <tr><td colSpan={7} className="cm-vide">Chargement…</td></tr>
              : liste.length === 0 ? <tr><td colSpan={7} className="cm-vide"><strong>Aucune famille</strong>Exemples : fournitures de bureau, matériel informatique, consommables.</td></tr>
                : liste.map((x) => (
                  <tr key={x.id} className={'cm-cliquable' + (x.actif ? '' : ' cm-inactif')} onClick={() => setFiche(x)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setFiche(x); }}>
                    <td><span className="cm-code">{x.code}</span></td>
                    <td><strong>{x.nom}</strong>{x.description && <span className="cm-sous">{x.description.slice(0, 80)}</span>}</td>
                    <td>{x.unite_stock_code ? <><strong>{x.unite_stock_code}</strong>
                      {x.unite_achat_code && x.unite_achat_code !== x.unite_stock_code && <span className="cm-sous">achat : {x.unite_achat_code} ×{String(x.coef_achat).replace('.', ',')}</span>}
                      {x.unite_vente_code && x.unite_vente_code !== x.unite_stock_code && <span className="cm-sous">vente : {x.unite_vente_code} ×{String(x.coef_vente).replace('.', ',')}</span>}
                    </> : <span className="cm-pastille cm-alerte">À choisir</span>}</td>
                    <td>{x.suivi_stock ? <span className="cm-puce">{x.methode_valorisation === 'fifo' ? 'FIFO' : 'CMUP'}</span> : <span className="cm-sous" style={{ marginTop: 0 }}>Non suivi</span>}</td>
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
