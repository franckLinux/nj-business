// NJ COMMERCIAL — Utilisateurs et rôles : qui peut quoi dans les achats, les ventes et le stock.
// Les comptes et profils se gèrent dans Configuration → Utilisateurs (procédure habituelle).
// 062 : types de gestion (achats, ventes, stock) — le DOMAINE de travail, attribué ici,
// distinct du rôle et du profil métier qui fixent le NIVEAU (les validations).
import { useState } from 'react';
import { UserModal } from '@/components/config/UsersTab';
import { SessionsOuvertes } from '@/components/SessionsOuvertes';
import { useUtilisateursModule, BandeauModule, ComptesHorsModule, ProfilModule, RetraitModule } from '@/components/UtilisateursModule';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { Entete, Statut, Tiroir, Section, Cases, useListe } from '@/components/commercial/ui';

// Périmètre d'une personne : aucune agence cochée = tout l'espace (comportement par défaut).
function Perimetre({ u, agences, onFermer, onEnregistre }) {
  const [choix, setChoix] = useState(u.agences);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  const valider = async () => {
    setEnCours(true);
    const r = await api.put(`/commercial/utilisateurs/${u.id}/agences`, { agence_ids: choix });
    setEnCours(false);
    if (r?.error) { setErreur(r.error); return; }
    onEnregistre(r);
  };
  return (
    <Tiroir titre={`Agences de ${u.username}`} sousTitre="Périmètre de travail dans NJ COMMERCIAL" onFermer={onFermer}
      pied={<>
        <button type="button" className="cm-btn cm-secondaire" onClick={onFermer}>Annuler</button>
        <button type="button" className="cm-btn cm-primaire" onClick={valider} disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</button>
      </>}>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      <Section titre="Agences autorisées">
        <p className="cm-aide" style={{ marginBottom: 8 }}>
          Aucune case cochée : la personne travaille sur toutes les agences. Sinon, elle ne voit et ne saisit que les demandes, bons et chiffres des magasins de ces agences.
        </p>
        <Cases label="Agences" options={agences.map((a) => ({ id: a.id, libelle: `${a.code} — ${a.nom}`, detail: a.magasins.map((m) => m.code).join(', ') || 'aucun magasin' }))}
          valeurs={choix} onChange={setChoix} vide="Aucune agence." />
      </Section>
    </Tiroir>
  );
}

// Types de gestion d'une personne (zéro, un ou plusieurs).
function TypesPersonne({ u, types, onFermer, onEnregistre }) {
  const [choix, setChoix] = useState(u.types_gestion);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  const valider = async () => {
    setEnCours(true);
    const r = await api.put(`/commercial/utilisateurs/${u.id}/types-gestion`, { types: choix });
    setEnCours(false);
    if (r?.error) { setErreur(r.error); return; }
    onEnregistre(r);
  };
  return (
    <Tiroir titre={`Types de gestion de ${u.username}`} sousTitre="Domaines où la personne travaille dans NJ COMMERCIAL" onFermer={onFermer}
      pied={<>
        <button type="button" className="cm-btn cm-secondaire" onClick={onFermer}>Annuler</button>
        <button type="button" className="cm-btn cm-primaire" onClick={valider} disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</button>
      </>}>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      <div className="cm-note">
        Le type de gestion ouvre les droits de <strong>consultation et de saisie</strong> du domaine. Il ne change ni le rôle ({ROLES[u.role] || u.role}) ni le profil
        {u.profil ? ` (${u.profil})` : ''} : les <strong>validations</strong> (approuver, émettre, valider, annuler) restent attachées au rôle et au profil.
      </div>
      <Section titre="Types de gestion">
        <Cases label="Types de gestion" valeurs={choix} onChange={setChoix} vide="Aucun type de gestion disponible."
          options={types.map((t) => ({ id: t.code, libelle: t.libelle, detail: `${t.permissions.length} droit(s) · ${t.description}` }))} />
        <p className="cm-aide" style={{ marginTop: 8 }}>Plusieurs cases possibles (ex. un gestionnaire de magasin qui reçoit aussi les achats). Aucune case : les droits viennent du seul rôle et du profil.</p>
      </Section>
    </Tiroir>
  );
}

// Lot de droits d'un type pour ce client : personnalisable, avec retour au lot par défaut.
const DROITS_DE_NIVEAU = /\.(approuver|approuver_direction|emettre|valider|valider_direction|annuler|livrer)$/;
const estDroitDeNiveau = (c) => DROITS_DE_NIVEAU.test(c) || c === 'com.parametrage.modifier';
function LotType({ type, catalogue, onFermer, onEnregistre }) {
  const [choix, setChoix] = useState(type.permissions);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  const envoyer = async (corps) => {
    setEnCours(true);
    const r = await api.put(`/commercial/types-gestion/${type.code}`, corps);
    setEnCours(false);
    if (r?.error) { setErreur(r.error); return; }
    onEnregistre(corps.defaut ? 'Lot par défaut rétabli.' : 'Droits du type enregistrés.');
  };
  const options = catalogue.filter((p) => !estDroitDeNiveau(p.code)).map((p) => ({
    id: p.code, libelle: p.nom, detail: `${p.code}${type.permissions_defaut.includes(p.code) ? ' · lot par défaut' : ''}`,
  }));
  return (
    <Tiroir titre={type.libelle} sousTitre={type.personnalise ? 'Lot personnalisé pour ce client' : 'Lot par défaut'} onFermer={onFermer}
      pied={<>
        {type.personnalise && <button type="button" className="cm-btn cm-secondaire cm-gauche" onClick={() => envoyer({ defaut: true })} disabled={enCours}>Revenir au lot par défaut</button>}
        <button type="button" className="cm-btn cm-secondaire" onClick={onFermer}>Annuler</button>
        <button type="button" className="cm-btn cm-primaire" onClick={() => envoyer({ permissions: choix })} disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</button>
      </>}>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      <p className="cm-aide" style={{ marginTop: 0, marginBottom: 10 }}>{type.description}</p>
      <div className="cm-note">Les droits de validation et de paramétrage n'apparaissent pas ici : ils relèvent du rôle ou du profil métier. Chaque changement vaut pour toutes les personnes de ce type ({type.nb_utilisateurs}).</div>
      <Section titre={`Droits ouverts (${choix.length})`}>
        <Cases label={`Droits du type ${type.libelle}`} options={options} valeurs={choix} onChange={setChoix} vide="Aucune permission NJ COMMERCIAL." />
      </Section>
    </Tiroir>
  );
}

const ROLES = { directeur: 'Directeur', caissier: 'Caissier(ère)', auditeur: 'Comptable', collaborateur: 'Collaborateur', comptable_cabinet: 'Comptable cabinet' };
const ACHATS = [
  ['com.da.creer', 'Demande'], ['com.da.voir_tout', 'Voit tout'], ['com.da.approuver', 'Approuve (achats)'],
  ['com.da.approuver_direction', 'Approuve (direction)'], ['com.bc.preparer', 'Prépare BC'], ['com.bc.emettre', 'Émet BC'],
  ['com.consultations.gerer', 'Consulte fournisseurs'], ['com.consultations.derogation', 'Déroge (< 3)'],
  ['com.articles.modifier', 'Articles'], ['com.parametrage.modifier', 'Paramétrage'], ['com.tiers.banque', 'Banque'],
];
const DOCS_ACHAT = [
  ['com.receptions.saisir', 'Saisit réceptions'], ['com.receptions.valider', 'Valide réceptions'], ['com.receptions.annuler', 'Annule réceptions'],
  ['com.retours_fourn.saisir', 'Saisit retours'], ['com.retours_fourn.valider', 'Valide retours'], ['com.factures_fourn.voir', 'Voit factures'],
  ['com.factures_fourn.saisir', 'Saisit factures'], ['com.factures_fourn.valider', 'Valide factures'], ['com.factures_fourn.annuler', 'Annule factures'],
  ['com.frais.saisir', 'Saisit frais'], ['com.frais.valider', 'Valide frais'],
];
const STOCK = [
  ['com.stock.voir', 'État'], ['com.stock.initial', 'Ouverture'], ['com.stock.entree', 'Entrées'], ['com.stock.sortie', 'Sorties'],
  ['com.stock.transfert', 'Transferts'], ['com.stock.inventaire', 'Inventaires'], ['com.stock.valider', 'Valide'],
  ['com.stock.annuler', 'Annule'], ['com.stock.journal', 'Mouvements'], ['com.stock.valorisation', 'Valeurs'],
];
const VENTES = [
  ['com.ventes.voir', 'Consulte'], ['com.ventes.devis', 'Devis'], ['com.ventes.valider', 'Valide (resp.)'], ['com.ventes.valider_direction', 'Valide (direction)'],
  ['com.ventes.commandes', 'Commandes'], ['com.ventes.preparer', 'Prépare'], ['com.ventes.livrer', 'Valide livraisons'], ['com.ventes.annuler', 'Annule'],
];
const PROFILS = [
  ['Demandeur achats', 'Exprime ses besoins et suit ses demandes.'],
  ['Gestionnaire des achats (GAS)', 'Vérifie stocks et fournisseurs, prépare les bons de commande, saisit le stock d\'ouverture.'],
  ['Responsable des achats', 'Valide les demandes, consulte les fournisseurs, compare les offres, émet et envoie les bons.'],
  ['Comptable (achats)', 'Consulte bons et réceptions, saisit et valide les factures fournisseurs, valide les frais d\'achat.'],
  ['Magasinier', 'Saisit entrées, sorties, transferts et comptages ; voit les quantités et les mouvements, pas les valeurs.'],
  ['Gestionnaire de stock', 'Valide, renvoie et annule les documents de stock ; voit coûts et valorisation ; valide les livraisons clients.'],
  ['Commercial (ventes)', 'Établit les devis, enregistre l\'acceptation du client et la commande.'],
  ['Responsable commercial', 'Valide les devis (jusqu\'au seuil des ventes), valide les livraisons, annule.'],
  ['Directeur (rôle)', 'Tous les droits du module, dont l\'approbation au-delà du seuil.'],
];

export default function UtilisateursPage() {
  const { can } = useApp();
  const toast = useToast();
  const { donnees, erreur, recharger: rechargerListe } = useListe('/commercial/utilisateurs');
  // 066 : les utilisateurs de NJ COMMERCIAL (rattachés au module).
  const mod = useUtilisateursModule('commercial');
  const [nouveau, setNouveau] = useState(false);
  const [retrait, setRetrait] = useState(null);
  const peutGerer = can('users.edit');
  const recharger = () => { rechargerListe(); mod.recharger(); };
  const [perim, setPerim] = useState(null);
  const [typesDe, setTypesDe] = useState(null);
  const [lot, setLot] = useState(null);
  const membres = mod.data ? new Map(mod.data.utilisateurs.map((u) => [u.id, u])) : null;
  const liste = (donnees?.utilisateurs || []).filter((u) => !membres || membres.has(u.id));
  const agences = donnees?.agences || [];
  const types = donnees?.types_gestion || [];
  const catalogue = donnees?.catalogue || [];
  const libType = (c) => types.find((t) => t.code === c)?.libelle.replace(/^Gestion (des |de )?/i, '') || c;
  const [vue, setVue] = useState('achats');
  const COLONNES = vue === 'stock' ? STOCK : vue === 'docs' ? DOCS_ACHAT : vue === 'ventes' ? VENTES : ACHATS;
  const codes = (ids) => (ids.length ? agences.filter((a) => ids.includes(a.id)).map((a) => a.code).join(', ') : 'Toutes');
  return (
    <div className="cm-page">
      <Entete titre="Utilisateurs et rôles" description="Les personnes qui travaillent dans NJ COMMERCIAL : types de gestion et droits d'achat, de stock et de vente, tels que le serveur les applique. Personne n'approuve sa propre demande ni ne valide son propre document de stock.">
        {can('users.create') && <button type="button" className="cm-btn cm-primaire" onClick={() => setNouveau(true)}>+ Nouvel utilisateur</button>}
      </Entete>
      {mod.data && <BandeauModule data={mod.data} />}
      {mod.erreur && <div className="cm-erreur">{mod.erreur}</div>}
      <div className="cm-note">
        Deux notions distinctes : le <strong>type de gestion</strong> (achats, ventes, stock — un ou plusieurs par personne, attribués ici) dit dans quel domaine la personne travaille et ouvre la consultation et la saisie de ce domaine ;
        le <strong>rôle et le profil métier</strong> (Configuration → Utilisateurs) fixent son niveau, dont les validations. Les droits se cumulent ; une permission retirée à la personne ou désactivée pour le client reste refusée.
        Une personne qui ne touche pas à la caisse (demandeur, magasinier) prend le rôle de base <strong>Collaborateur</strong>.
      </div>
      {types.length > 0 && (<>
        <h3 style={{ fontSize: 14, fontWeight: 800, color: 'var(--brand)', margin: '4px 0 8px' }}>Types de gestion</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10, marginBottom: 16 }}>
          {types.map((t) => (
            <div key={t.code} className="cm-section" style={{ margin: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={`cm-type cm-type-${t.code}`}>{t.libelle}</span>
                <span className="cm-sous" style={{ marginTop: 0, marginLeft: 'auto' }}>{t.nb_utilisateurs} personne{t.nb_utilisateurs > 1 ? 's' : ''}</span>
              </div>
              <p className="cm-aide" style={{ margin: '6px 0' }}>{t.description}</p>
              <span className="cm-sous">{t.permissions.length} droit(s){t.personnalise ? ' · lot personnalisé' : ' · lot par défaut'}</span>
              <button type="button" className="cm-lien" style={{ marginTop: 6 }} onClick={() => setLot(t)}>Voir ou personnaliser les droits</button>
            </div>
          ))}
        </div>
      </>)}
      <h3 style={{ fontSize: 14, fontWeight: 800, color: 'var(--brand)', margin: '4px 0 8px' }}>Profils métier (niveau)</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10, marginBottom: 16 }}>
        {PROFILS.map(([n, d]) => <div key={n} className="cm-section" style={{ margin: 0 }}><strong style={{ fontSize: 13.5 }}>{n}</strong><p className="cm-aide" style={{ marginTop: 4 }}>{d}</p></div>)}
      </div>
      {erreur && <div className="cm-erreur">{erreur}</div>}
      <div className="cm-onglets" role="tablist">
        <button type="button" role="tab" aria-selected={vue === 'achats'} onClick={() => setVue('achats')}>Droits achats</button>
        <button type="button" role="tab" aria-selected={vue === 'docs'} onClick={() => setVue('docs')}>Réceptions et factures</button>
        <button type="button" role="tab" aria-selected={vue === 'stock'} onClick={() => setVue('stock')}>Droits stock</button>
        <button type="button" role="tab" aria-selected={vue === 'ventes'} onClick={() => setVue('ventes')}>Droits ventes</button>
      </div>
      <div className="cm-table-wrap">
        <table className="cm-table" style={{ minWidth: 1060 }}>
          <thead><tr><th>Utilisateur</th><th>Rôle · profil</th><th>Types de gestion</th><th>Agences</th>{COLONNES.map(([c, l]) => <th key={c} style={{ textAlign: 'center' }}>{l}</th>)}<th>Statut</th>{mod.data && peutGerer && <th aria-label="Action" />}</tr></thead>
          <tbody>
            {!donnees ? <tr><td colSpan={COLONNES.length + 5} className="cm-vide">Chargement…</td></tr>
              : liste.map((u) => (
                <tr key={u.id} className={u.actif ? '' : 'cm-inactif'}>
                  <td><strong>{u.username}</strong>{u.email && <span className="cm-sous">{u.email}</span>}</td>
                  <td>
                    {ROLES[u.role] || u.role}{u.profil && <span className="cm-sous">{u.profil}</span>}
                    {mod.data && peutGerer && membres?.get(u.id) && (mod.data.profils.length > 0) && (
                      <div style={{ marginTop: 4 }}><ProfilModule u={membres.get(u.id)} data={mod.data} code="commercial" onChange={() => recharger()} /></div>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <div className="cm-types">
                      {u.types_gestion.length ? u.types_gestion.map((c) => <span key={c} className={`cm-type cm-type-${c}`}>{libType(c)}</span>) : <span className="cm-sous" style={{ marginTop: 0 }}>Aucun</span>}
                    </div>
                    {types.length > 0 && <button type="button" className="cm-lien" onClick={() => setTypesDe(u)}>Modifier</button>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {codes(u.agences)}
                    {u.permissions.length > 0 && <button type="button" className="cm-lien" style={{ marginLeft: 8 }} onClick={() => setPerim(u)}>Modifier</button>}
                  </td>
                  {COLONNES.map(([c, l]) => (
                    <td key={c} style={{ textAlign: 'center' }} aria-label={`${l} : ${u.permissions.includes(c) ? 'oui' : 'non'}`}>
                      {u.permissions.includes(c)
                        ? <span style={{ color: u.permissions_types?.includes(c) ? '#0369a1' : '#16a34a', fontWeight: 800 }} title={u.permissions_types?.includes(c) ? 'Ouvert par un type de gestion' : 'Ouvert par le rôle, le profil ou une exception'}>✓</span>
                        : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                  ))}
                  <td><Statut actif={u.actif} /></td>
                  {mod.data && peutGerer && (
                    <td><button type="button" className="um-btn um-retirer" onClick={() => setRetrait(u)} aria-label={`Retirer ${u.username} de NJ COMMERCIAL`}>Retirer</button></td>
                  )}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <p className="cm-aide" style={{ marginTop: 8 }}><span style={{ color: '#0369a1', fontWeight: 800 }}>✓</span> bleu : droit ouvert par un type de gestion ; <span style={{ color: '#16a34a', fontWeight: 800 }}>✓</span> vert : par le rôle, le profil ou une exception. Une personne voit ses nouveaux droits à sa prochaine connexion (ou en rechargeant la page).</p>
      {mod.data && <ComptesHorsModule data={mod.data} code="commercial" peutGerer={peutGerer} onChange={() => recharger()} />}
      {peutGerer && <SessionsOuvertes />}
      {retrait && <RetraitModule cible={retrait} code="commercial" onFermer={() => setRetrait(null)} onFait={() => { setRetrait(null); recharger(); }} />}
      {nouveau && <UserModal module="commercial" onClose={() => setNouveau(false)} onSaved={(msg) => { setNouveau(false); toast(`${msg} Il fait partie de NJ COMMERCIAL.`, 'success'); recharger(); }} />}
      {perim && <Perimetre u={perim} agences={agences} onFermer={() => setPerim(null)} onEnregistre={() => { setPerim(null); toast('Périmètre enregistré.', 'success'); recharger(); }} />}
      {typesDe && <TypesPersonne u={typesDe} types={types} onFermer={() => setTypesDe(null)} onEnregistre={() => { setTypesDe(null); toast('Types de gestion enregistrés.', 'success'); recharger(); }} />}
      {lot && <LotType type={lot} catalogue={catalogue} onFermer={() => setLot(null)} onEnregistre={(m) => { setLot(null); toast(m, 'success'); recharger(); }} />}
    </div>
  );
}
