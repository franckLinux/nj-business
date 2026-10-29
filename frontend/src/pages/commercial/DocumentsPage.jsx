// NJ COMMERCIAL — registre des pièces justificatives des achats (demandes et bons).
// Lecture seule : une pièce s'ajoute ou se retire depuis sa demande ou son bon.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { Entete, useListe, useDiffere } from '@/components/commercial/ui';
import { dateFr, ouvrirFichier, tailleFichier } from '@/components/commercial/achats';

const CATEGORIES = { justificatif: 'Justificatif', proforma: 'Proforma' };

export default function DocumentsPage() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [categorie, setCategorie] = useState('');
  const [retires, setRetires] = useState(false);
  const qd = useDiffere(q);
  const { donnees, erreur } = useListe(`/commercial/documents?q=${encodeURIComponent(qd)}&categorie=${categorie}&retires=${retires ? 1 : ''}`);
  const liste = donnees || [];
  const ouvrir = (x) => ouvrirFichier(api, x.objet_type === 'demande'
    ? `/commercial/demandes/${x.objet_id}/pieces/${x.id}` : `/commercial/bons-commande/${x.objet_id}/pieces/${x.id}`, x.nom, x.mime, toast);
  return (
    <div className="cm-page">
      <Entete titre="Documents justificatifs" description="Toutes les pièces jointes aux demandes d'achat et aux bons de commande. Chaque fichier est conservé avec son empreinte SHA-256 ; un retrait le masque sans l'effacer." />
      <div className="cm-outils">
        <input className="cm-recherche" type="search" placeholder="Nom du fichier, numéro, fournisseur…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher une pièce" />
        <select className="cm-select" value={categorie} onChange={(e) => setCategorie(e.target.value)} aria-label="Catégorie">
          <option value="">Toutes les pièces</option>
          {Object.entries(CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}s</option>)}
        </select>
        <label className="cm-aide" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
          <input type="checkbox" checked={retires} onChange={(e) => setRetires(e.target.checked)} /> Afficher les pièces retirées
        </label>
        <span className="cm-compteur">{donnees ? `${liste.length} pièce${liste.length > 1 ? 's' : ''}` : ''}</span>
      </div>
      {erreur && <div className="cm-erreur">{erreur}</div>}
      <div className="cm-table-wrap">
        <table className="cm-table" style={{ minWidth: 820 }}>
          <thead><tr><th>Fichier</th><th>Nature</th><th>Rattachée à</th><th>Ajoutée</th><th>Empreinte</th><th /></tr></thead>
          <tbody>
            {!donnees ? <tr><td colSpan={6} className="cm-vide">Chargement…</td></tr>
              : liste.length === 0 ? <tr><td colSpan={6} className="cm-vide"><strong>Aucune pièce</strong>Les pièces se joignent depuis une demande d'achat ou un bon de commande.</td></tr>
                : liste.map((x) => (
                  <tr key={x.id} className={x.retire ? 'cm-inactif' : ''}>
                    <td style={{ maxWidth: 280 }}><strong style={{ wordBreak: 'break-word' }}>{x.nom}</strong><span className="cm-sous">{tailleFichier(x.taille)}{x.retire ? ` · retirée : ${x.motif_retrait}` : ''}</span></td>
                    <td><span className={`cm-pastille ${x.categorie === 'proforma' ? 'cm-violet' : 'cm-info'}`}>{CATEGORIES[x.categorie] || x.categorie}</span></td>
                    <td>
                      <Link to={x.objet_type === 'demande' ? `/commercial/demandes/${x.objet_id}` : `/commercial/bons/${x.objet_id}`}>
                        {x.objet_type === 'demande' ? 'Demande' : 'Bon'} {x.objet_numero?.startsWith('BROUILLON') ? '(brouillon)' : x.objet_numero}
                      </Link>
                      {x.fournisseur && <span className="cm-sous">{x.fournisseur}</span>}
                    </td>
                    <td>{dateFr(x.ajoute_le)}<span className="cm-sous">{x.ajoute_par_nom}</span></td>
                    <td><code className="cm-sha" title={x.sha256}>{x.sha256.slice(0, 12)}…</code></td>
                    <td style={{ textAlign: 'right' }}>{!x.retire && <button type="button" className="cm-lien" onClick={() => ouvrir(x)}>Ouvrir</button>}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
