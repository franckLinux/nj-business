// NJ COMMERCIAL — Utilisateurs et rôles : qui peut quoi dans les achats (lecture).
// Les comptes et profils se gèrent dans Configuration → Utilisateurs (procédure habituelle).
import { Link } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import { Entete, Statut, useListe } from '@/components/commercial/ui';

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
  const { donnees, erreur } = useListe('/commercial/utilisateurs');
  const liste = donnees?.utilisateurs || [];
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
        <table className="cm-table" style={{ minWidth: 980 }}>
          <thead><tr><th>Utilisateur</th><th>Rôle · profil</th>{COLONNES.map(([c, l]) => <th key={c} style={{ textAlign: 'center' }}>{l}</th>)}<th>Statut</th></tr></thead>
          <tbody>
            {!donnees ? <tr><td colSpan={COLONNES.length + 3} className="cm-vide">Chargement…</td></tr>
              : liste.map((u) => (
                <tr key={u.id} className={u.actif ? '' : 'cm-inactif'}>
                  <td><strong>{u.username}</strong>{u.email && <span className="cm-sous">{u.email}</span>}</td>
                  <td>{ROLES[u.role] || u.role}{u.profil && <span className="cm-sous">{u.profil}</span>}</td>
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
    </div>
  );
}
