// NJ COMMERCIAL — page d'entrée : les étapes du paramétrage, avec les chiffres réels.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { useApp } from '@/context/AppContext';
import { Entete } from '@/components/commercial/ui';

const ETAPES = [
  ['societe', '/commercial/societe', 'Société', 'Identité reprise de l\'Entité, mentions des documents, numérotation, règles du circuit.', ['com.parametrage.voir']],
  ['magasins', '/commercial/magasins', 'Magasins', 'Les lieux de stockage, avec leur responsable.', ['com.parametrage.voir', 'com.articles.voir']],
  ['fournisseurs', '/commercial/fournisseurs', 'Fournisseurs', 'Le registre des tiers, complété des informations d\'achat.', ['com.tiers.voir']],
  ['familles', '/commercial/familles', 'Familles d\'articles', 'Classer les articles et rattacher les fournisseurs habituels.', ['com.parametrage.voir', 'com.articles.voir']],
  ['taxes', '/commercial/taxes', 'Taxes', 'Les taxes applicables, avec leur taux.', ['com.parametrage.voir']],
  ['articles', '/commercial/articles', 'Articles', 'Le catalogue, le suivi comptable et le stock d\'ouverture.', ['com.articles.voir', 'com.da.creer']],
  ['utilisateurs', '/commercial/utilisateurs', 'Utilisateurs et rôles', 'Qui demande, qui prépare, qui approuve.', ['com.parametrage.modifier']],
];

export default function DemarragePage() {
  const { can } = useApp();
  const [n, setN] = useState({});
  useEffect(() => {
    const lire = async (cle, url, compter) => {
      const r = await api.get(url);
      if (!r?.error) setN((x) => ({ ...x, [cle]: compter(r) }));
    };
    if (can('com.parametrage.voir')) lire('societe', '/commercial/societe', (r) => (r.parametres_enregistres ? 1 : 0));
    lire('magasins', '/commercial/magasins?actifs=1', (r) => r.length);
    lire('familles', '/commercial/familles?actifs=1', (r) => r.length);
    lire('articles', '/commercial/articles?actifs=1', (r) => r.length);
    if (can('com.tiers.voir')) lire('fournisseurs', '/commercial/tiers?type=fournisseur&actifs=1', (r) => r.length);
    if (can('com.parametrage.voir')) lire('taxes', '/commercial/taxes?actifs=1', (r) => r.length);
    if (can('com.parametrage.modifier')) lire('utilisateurs', '/commercial/utilisateurs', (r) => r.utilisateurs.filter((u) => u.actif && u.permissions.length).length);
  }, [can]);

  const chiffre = (cle) => {
    const v = n[cle];
    if (v === undefined) return '…';
    if (cle === 'societe') return v ? 'Paramètres enregistrés' : 'Paramètres par défaut';
    if (cle === 'utilisateurs') return `${v} personne${v > 1 ? 's' : ''} avec des droits achats`;
    return `${v} actif${v > 1 ? 's' : ''}`;
  };
  const visibles = ETAPES.filter(([, , , , codes]) => codes.some((c) => can(c)));

  return (
    <div className="cm-page">
      <Entete titre="Bienvenue dans NJ COMMERCIAL"
        description="Le module des achats commence par le paramétrage. Les demandes d'achat, les autorisations et les bons de commande s'appuieront sur ces référentiels." />
      <div className="cm-etapes">
        {visibles.map(([cle, to, titre, texte], i) => (
          <Link key={cle} to={to} className={'cm-etape' + (n[cle] > 0 ? ' cm-fait' : '')}>
            <div className="cm-etape-tete">
              <span className="cm-etape-num" aria-hidden="true">{n[cle] > 0 ? '✓' : i + 1}</span>
              <h3>{titre}</h3>
            </div>
            <p>{texte}</p>
            <span className="cm-chiffre">{chiffre(cle)}</span>
          </Link>
        ))}
      </div>
      <div className="cm-avenir">
        <strong>À venir dans ce module :</strong> demandes d'achat avec consultation du stock, circuit d'autorisation et notifications,
        puis bons de commande en PDF avec QR code de vérification. Ces écrans ne sont pas encore disponibles.
      </div>
    </div>
  );
}
