// NJ COMMERCIAL — Utilisateurs et rôles : qui peut quoi dans les achats (lecture).
// Les comptes et profils se gèrent dans Configuration → Utilisateurs (procédure habituelle).
import { useState } from 'react';
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

const ROLES = { directeur: 'Directeur', caissier: 'Caissier(ère)', auditeur: 'Comptable', collaborateur: 'Collaborateur', comptable_cabinet: 'Comptable cabinet' };
const COLONNES = [
  ['com.da.creer', 'Demande'], ['com.da.voir_tout', 'Voit tout'], ['com.da.approuver', 'Approuve (achats)'],
  ['com.da.approuver_direction', 'Approuve (direction)'], ['com.bc.preparer', 'Prépare BC'], ['com.bc.emettre', 'Émet BC'],
  ['com.articles.modifier', 'Articles'], ['com.parametrage.modifier', 'Paramétrage'], ['com.tiers.banque', 'Banque'],
];
const PROFILS = [
  ['Demandeur achats', 'Exprime ses besoins et suit ses demandes.'],
  ['Gestionnaire des achats (GAS)', 'Vérifie stocks et fournisseurs, prépare les bons de commande, saisit le stock d\'ouverture.'],
  ['Responsable des achats', 'Approuve ou rejette, émet et annule les bons, voit les coordonnées bancaires.'],
  ['Directeur (rôle)', 'Tous les droits du module, dont l\'approbation au-delà du seuil.'],
];

export default function UtilisateursPage() {
  const { can } = useApp();
  const toast = useToast();
  const { donnees, erreur, recharger } = useListe('/commercial/utilisateurs');
  const [perim, setPerim] = useState(null);
  const liste = donnees?.utilisateurs || [];
  const agences = donnees?.agences || [];
  const codes = (ids) => (ids.length ? agences.filter((a) => ids.includes(a.id)).map((a) => a.code).join(', ') : 'Toutes');
  return (
    <div className="cm-page">
      <Entete titre="Utilisateurs et rôles" description="Les droits d'achat de chaque personne, tels que le serveur les applique. Personne ne peut approuver sa propre demande.">
        {can('users.view') && <Link to="/config" className="cm-btn cm-secondaire" style={{ textDecoration: 'none' }}>Gérer dans Configuration</Link>}
      </Entete>
      <div className="cm-note">
        Pour donner un rôle achats : dans Configuration → Utilisateurs, attribuez un des profils métier créés à l'activation du module.
        Une personne qui ne touche pas à la caisse (demandeur, magasinier) prend le rôle de base <strong>Collaborateur</strong>.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10, marginBottom: 16 }}>
        {PROFILS.map(([n, d]) => <div key={n} className="cm-section" style={{ margin: 0 }}><strong style={{ fontSize: 13.5 }}>{n}</strong><p className="cm-aide" style={{ marginTop: 4 }}>{d}</p></div>)}
      </div>
      {erreur && <div className="cm-erreur">{erreur}</div>}
      <div className="cm-table-wrap">
        <table className="cm-table" style={{ minWidth: 1060 }}>
          <thead><tr><th>Utilisateur</th><th>Rôle · profil</th><th>Agences</th>{COLONNES.map(([c, l]) => <th key={c} style={{ textAlign: 'center' }}>{l}</th>)}<th>Statut</th></tr></thead>
          <tbody>
            {!donnees ? <tr><td colSpan={COLONNES.length + 4} className="cm-vide">Chargement…</td></tr>
              : liste.map((u) => (
                <tr key={u.id} className={u.actif ? '' : 'cm-inactif'}>
                  <td><strong>{u.username}</strong>{u.email && <span className="cm-sous">{u.email}</span>}</td>
                  <td>{ROLES[u.role] || u.role}{u.profil && <span className="cm-sous">{u.profil}</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {codes(u.agences)}
                    {u.permissions.length > 0 && <button type="button" className="cm-lien" style={{ marginLeft: 8 }} onClick={() => setPerim(u)}>Modifier</button>}
                  </td>
                  {COLONNES.map(([c, l]) => (
                    <td key={c} style={{ textAlign: 'center' }} aria-label={`${l} : ${u.permissions.includes(c) ? 'oui' : 'non'}`}>
                      {u.permissions.includes(c) ? <span style={{ color: '#16a34a', fontWeight: 800 }}>✓</span> : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                  ))}
                  <td><Statut actif={u.actif} /></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {perim && <Perimetre u={perim} agences={agences} onFermer={() => setPerim(null)} onEnregistre={() => { setPerim(null); toast('Périmètre enregistré.', 'success'); recharger(); }} />}
    </div>
  );
}
