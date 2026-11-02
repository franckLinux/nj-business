// NJ COMMERCIAL — Familles d'articles et leurs fournisseurs (plusieurs à plusieurs).
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { Entete, Statut, Tiroir, Section, Champ, Bascule, Cases, ChampUnite, useListe, useDiffere, enregistrer } from '@/components/commercial/ui';

function FicheFamille({ famille, onFermer, onEnregistre, modifiable }) {
  const [f, setF] = useState({
    code: famille?.code || '', nom: famille?.nom || '', description: famille?.description || '', actif: famille ? famille.actif : true,
    fournisseur_ids: (famille?.fournisseurs || []).map((x) => x.id),
    taxe_achat_id: famille?.taxe_achat_id ? String(famille.taxe_achat_id) : '', taxe_vente_id: famille?.taxe_vente_id ? String(famille.taxe_vente_id) : '',
    suivi_stock: famille ? famille.suivi_stock : true, methode_valorisation: famille?.methode_valorisation || 'cmup',
    unite_stock_id: famille?.unite_stock_id ? String(famille.unite_stock_id) : '',
    unite_achat_id: famille?.unite_achat_id && famille.unite_achat_id !== famille.unite_stock_id ? String(famille.unite_achat_id) : '',
    coef_achat: famille?.coef_achat ? String(famille.coef_achat).replace('.', ',') : '',
    unite_vente_id: famille?.unite_vente_id && famille.unite_vente_id !== famille.unite_stock_id ? String(famille.unite_vente_id) : '',
    coef_vente: famille?.coef_vente ? String(famille.coef_vente).replace('.', ',') : '',
  });
  const [unites, setUnites] = useState([]);
  const [fournisseurs, setFournisseurs] = useState(null);
  const [taxes, setTaxes] = useState([]);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  useEffect(() => {
    api.get('/commercial/tiers?type=fournisseur').then((r) => setFournisseurs(r?.error ? [] : r));
    api.get('/commercial/taxes').then((r) => setTaxes(r?.error ? [] : r));
    api.get('/commercial/unites').then((r) => setUnites(r?.error ? [] : r));
  }, []);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const valider = async () => {
    setEnCours(true);
    const st = f.unite_stock_id || null;
    const r = await enregistrer('/commercial/familles', famille?.id, { ...f, taxe_achat_id: f.taxe_achat_id || null, taxe_vente_id: f.taxe_vente_id || null,
      unite_stock_id: st, unite_achat_id: st ? (f.unite_achat_id || st) : null, unite_vente_id: st ? (f.unite_vente_id || st) : null });
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
      <Section titre="Paramètres proposés aux articles">
        <p className="cm-aide" style={{ marginBottom: 10 }}>Repris à la création de chaque article de la famille, puis modifiables article par article. Modifier la famille ne change pas les articles déjà créés.</p>
        <div className="cm-grille">
          <Champ label="Taxe à l'achat" id="fta">
            <select id="fta" value={f.taxe_achat_id} onChange={set('taxe_achat_id')} disabled={!modifiable}>
              <option value="">Aucune</option>
              {taxes.filter((t) => t.usage !== 'vente' && (t.actif || String(t.id) === f.taxe_achat_id)).map((t) => <option key={t.id} value={t.id}>{t.code} — {String(t.taux).replace('.', ',')} %</option>)}
            </select>
          </Champ>
          <Champ label="Taxe à la vente" id="ftv" aide="Jamais reprise automatiquement de la taxe d'achat.">
            <select id="ftv" value={f.taxe_vente_id} onChange={set('taxe_vente_id')} disabled={!modifiable}>
              <option value="">Aucune</option>
              {taxes.filter((t) => t.usage !== 'achat' && (t.actif || String(t.id) === f.taxe_vente_id)).map((t) => <option key={t.id} value={t.id}>{t.code} — {String(t.taux).replace('.', ',')} %</option>)}
            </select>
          </Champ>
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
        <div className="cm-grille" style={{ marginTop: 12 }}>
          <Champ label="Unité de stock" id="fus" aide="Facultatif : sans unité, chaque article choisit la sienne.">
            <select id="fus" value={f.unite_stock_id} onChange={(e) => setF((x) => ({ ...x, unite_stock_id: e.target.value }))} disabled={!modifiable}>
              <option value="">— Aucune proposition —</option>
              {unites.filter((u) => u.actif || String(u.id) === f.unite_stock_id).map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
            </select>
          </Champ>
          <div />
          {f.unite_stock_id && (<>
            <ChampUnite label="Unité d'achat" id="fua" unites={unites} valeur={f.unite_achat_id} stockId={f.unite_stock_id} disabled={!modifiable}
              onUnite={(v) => setF((x) => ({ ...x, unite_achat_id: v === x.unite_stock_id ? '' : v }))} coef={f.coef_achat} onCoef={(v) => setF((x) => ({ ...x, coef_achat: v }))} />
            <ChampUnite label="Unité de vente" id="fuv" unites={unites} valeur={f.unite_vente_id} stockId={f.unite_stock_id} disabled={!modifiable}
              onUnite={(v) => setF((x) => ({ ...x, unite_vente_id: v === x.unite_stock_id ? '' : v }))} coef={f.coef_vente} onCoef={(v) => setF((x) => ({ ...x, coef_vente: v }))} />
          </>)}
        </div>
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
          <thead><tr><th>Code</th><th>Nom</th><th>Taxes achat · vente</th><th>Unités</th><th>Stock</th><th>Fournisseurs associés</th><th className="cm-num">Articles</th><th>Statut</th></tr></thead>
          <tbody>
            {!donnees ? <tr><td colSpan={8} className="cm-vide">Chargement…</td></tr>
              : liste.length === 0 ? <tr><td colSpan={8} className="cm-vide"><strong>Aucune famille</strong>Exemples : fournitures de bureau, matériel informatique, consommables.</td></tr>
                : liste.map((x) => (
                  <tr key={x.id} className={'cm-cliquable' + (x.actif ? '' : ' cm-inactif')} onClick={() => setFiche(x)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setFiche(x); }}>
                    <td><span className="cm-code">{x.code}</span></td>
                    <td><strong>{x.nom}</strong>{x.description && <span className="cm-sous">{x.description.slice(0, 80)}</span>}</td>
                    <td>{x.taxe_achat_code || '—'} · {x.taxe_vente_code || '—'}</td>
                    <td>{x.unite_stock_code ? <>{x.unite_stock_code}{x.unite_achat_code && x.unite_achat_code !== x.unite_stock_code && <span className="cm-sous">achat : {x.unite_achat_code} ×{String(x.coef_achat).replace('.', ',')}</span>}</> : <span className="cm-sous" style={{ marginTop: 0 }}>—</span>}</td>
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
