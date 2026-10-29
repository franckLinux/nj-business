// NJ COMMERCIAL — Demandes d'achat (liste) et Autorisations (file d'examen).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import { Entete, useListe, useDiffere, fmtMontant } from '@/components/commercial/ui';
import { STATUTS, StatutDemande, Priorite, dateFr, EtatCommande } from '@/components/commercial/achats';

export default function DemandesPage({ autorisations = false }) {
  const { can } = useApp();
  const navigate = useNavigate();
  const voitTout = can('com.da.voir_tout');
  const [vue, setVue] = useState(autorisations ? 'a_examiner' : (voitTout ? 'toutes' : 'mes'));
  const [statut, setStatut] = useState('');
  const [q, setQ] = useState('');
  const [du, setDu] = useState('');
  const [au, setAu] = useState('');
  const qd = useDiffere(q);
  const { donnees, erreur } = useListe(`/commercial/demandes?vue=${vue}&statut=${statut}&q=${encodeURIComponent(qd)}&du=${du}&au=${au}`);
  const liste = donnees || [];

  return (
    <div className="cm-page">
      {autorisations ? (
        <Entete titre="Autorisations d'achat" description="Les demandes qui attendent votre décision. Vous ne voyez jamais ici vos propres demandes : personne ne valide ce qu'il a demandé." />
      ) : (
        <Entete titre="Demandes d'achat" description="Exprimez un besoin, consultez le stock du magasin et suivez l'avancement de chaque demande.">
          {can('com.da.creer') && <button type="button" className="cm-btn cm-primaire" onClick={() => navigate('/commercial/demandes/nouvelle')}>+ Nouvelle demande</button>}
        </Entete>
      )}
      {!autorisations && voitTout && (
        <div className="cm-onglets" role="tablist">
          <button type="button" role="tab" aria-selected={vue === 'toutes'} onClick={() => setVue('toutes')}>Toutes les demandes</button>
          <button type="button" role="tab" aria-selected={vue === 'mes'} onClick={() => setVue('mes')}>Mes demandes</button>
        </div>
      )}
      <div className="cm-outils">
        <input className="cm-recherche" type="search" placeholder="Numéro, motif, service, article, demandeur…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher une demande" />
        {!autorisations && (
          <select className="cm-select" value={statut} onChange={(e) => setStatut(e.target.value)} aria-label="Statut">
            <option value="">Tous les statuts</option>
            {Object.entries(STATUTS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
          </select>
        )}
        <input className="cm-select" type="date" value={du} onChange={(e) => setDu(e.target.value)} aria-label="Du" title="Du" />
        <input className="cm-select" type="date" value={au} onChange={(e) => setAu(e.target.value)} aria-label="Au" title="Au" />
        <span className="cm-compteur">{donnees ? `${liste.length} demande${liste.length > 1 ? 's' : ''}` : ''}</span>
      </div>
      {erreur && <div className="cm-erreur">{erreur}</div>}
      <div className="cm-table-wrap">
        <table className="cm-table" style={{ minWidth: 900 }}>
          <thead><tr><th>Numéro</th><th>Date</th><th>Demandeur · service</th><th>Magasin</th><th>Motif</th><th className="cm-num">Montant estimé</th><th>Priorité</th><th>Statut</th></tr></thead>
          <tbody>
            {!donnees ? <tr><td colSpan={8} className="cm-vide">Chargement…</td></tr>
              : liste.length === 0 ? (
                <tr><td colSpan={8} className="cm-vide">
                  <strong>{autorisations ? 'Rien à autoriser' : 'Aucune demande'}</strong>
                  {autorisations ? 'Aucune demande n\'attend votre décision.' : can('com.da.creer') ? 'Créez votre première demande d\'achat.' : ''}
                </td></tr>
              ) : liste.map((d) => (
                <tr key={d.id} className="cm-cliquable" onClick={() => navigate(`/commercial/demandes/${d.id}`)} tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/commercial/demandes/${d.id}`); }}>
                  <td><span className="cm-code">{d.numero}</span>{d.nb_documents > 0 && <span className="cm-sous">📎 {d.nb_documents} pièce{d.nb_documents > 1 ? 's' : ''}</span>}</td>
                  <td>{dateFr(d.date_demande)}</td>
                  <td><strong>{d.demandeur_nom}</strong>{d.service && <span className="cm-sous">{d.service}</span>}</td>
                  <td>{d.magasin_code}</td>
                  <td style={{ maxWidth: 260 }}>{d.motif ? `${d.motif.slice(0, 70)}${d.motif.length > 70 ? '…' : ''}` : <span className="cm-sous">—</span>}<span className="cm-sous">{d.nb_lignes} article{d.nb_lignes > 1 ? 's' : ''}</span></td>
                  <td className="cm-num">{d.statut === 'brouillon' && !d.nb_soumissions ? '—' : fmtMontant(d.montant_estime)}{d.montant_incomplet && <span className="cm-sous">prix incomplets</span>}</td>
                  <td><Priorite valeur={d.priorite} /></td>
                  <td><StatutDemande statut={d.statut} />{d.etat_commande && <span style={{ display: 'block', marginTop: 4 }}><EtatCommande etat={d.etat_commande} /></span>}{d.direction_requise && ['examen_achats', 'examen_direction'].includes(d.statut) && <span className="cm-sous">2 étapes</span>}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
