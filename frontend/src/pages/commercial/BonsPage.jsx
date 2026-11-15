// NJ COMMERCIAL — Bons de commande : liste des bons et demandes approuvées restant à commander.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import { Entete, useListe, useDiffere, fmtMontant } from '@/components/commercial/ui';
import { STATUTS_BC, StatutBon, Priorite, dateFr } from '@/components/commercial/achats';
import { SuiviBon } from '@/components/commercial/appro';

function ACommander() {
  const navigate = useNavigate();
  const { donnees, erreur } = useListe('/commercial/bons-commande/a-commander');
  const liste = donnees || [];
  return (
    <>
      <p className="cm-aide" style={{ margin: '0 0 10px' }}>Demandes approuvées dont une partie au moins n'est pas encore sur un bon de commande.</p>
      {erreur && <div className="cm-erreur">{erreur}</div>}
      <div className="cm-table-wrap">
        <table className="cm-table">
          <thead><tr><th>Demande</th><th>Approuvée le</th><th>Demandeur · service</th><th>Magasin</th><th className="cm-num">Montant estimé</th><th>Priorité</th><th /></tr></thead>
          <tbody>
            {!donnees ? <tr><td colSpan={7} className="cm-vide">Chargement…</td></tr>
              : liste.length === 0 ? <tr><td colSpan={7} className="cm-vide"><strong>Rien à commander</strong>Toutes les demandes approuvées sont couvertes par des bons.</td></tr>
                : liste.map((d) => (
                  <tr key={d.id}>
                    <td><span className="cm-code">{d.numero}</span><span className="cm-sous">{d.lignes_restantes} / {d.nb_lignes} ligne{d.nb_lignes > 1 ? 's' : ''} à commander</span></td>
                    <td>{dateFr(d.decidee_le)}</td>
                    <td><strong>{d.demandeur_nom}</strong>{d.service && <span className="cm-sous">{d.service}</span>}</td>
                    <td>{d.magasin_code}</td>
                    <td className="cm-num">{fmtMontant(d.montant_estime)}</td>
                    <td><Priorite valeur={d.priorite} /></td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className="cm-btn cm-primaire" onClick={() => navigate(`/commercial/bons/nouveau?demande=${d.id}`)}>Préparer un bon</button>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Liste() {
  const navigate = useNavigate();
  const [statut, setStatut] = useState('');
  const [q, setQ] = useState('');
  const [du, setDu] = useState('');
  const [au, setAu] = useState('');
  const qd = useDiffere(q);
  const { donnees, erreur } = useListe(`/commercial/bons-commande?statut=${statut}&q=${encodeURIComponent(qd)}&du=${du}&au=${au}`);
  const liste = donnees || [];
  return (
    <>
      <div className="cm-outils">
        <input className="cm-recherche" type="search" placeholder="Numéro du bon, de la demande, fournisseur…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher un bon" />
        <select className="cm-select" value={statut} onChange={(e) => setStatut(e.target.value)} aria-label="Statut">
          <option value="">Tous les statuts</option>
          {Object.entries(STATUTS_BC).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input className="cm-select" type="date" value={du} onChange={(e) => setDu(e.target.value)} aria-label="Du" title="Du" />
        <input className="cm-select" type="date" value={au} onChange={(e) => setAu(e.target.value)} aria-label="Au" title="Au" />
        <span className="cm-compteur">{donnees ? `${liste.length} bon${liste.length > 1 ? 's' : ''}` : ''}</span>
      </div>
      {erreur && <div className="cm-erreur">{erreur}</div>}
      <div className="cm-table-wrap">
        <table className="cm-table" style={{ minWidth: 860 }}>
          <thead><tr><th>Bon</th><th>Date</th><th>Fournisseur</th><th>Demande</th><th>Livraison</th><th className="cm-num">Total TTC</th><th>Statut</th></tr></thead>
          <tbody>
            {!donnees ? <tr><td colSpan={7} className="cm-vide">Chargement…</td></tr>
              : liste.length === 0 ? <tr><td colSpan={7} className="cm-vide"><strong>Aucun bon de commande</strong>Les bons se préparent à partir des demandes approuvées.</td></tr>
                : liste.map((b) => (
                  <tr key={b.id} className="cm-cliquable" tabIndex={0} onClick={() => navigate(`/commercial/bons/${b.id}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/commercial/bons/${b.id}`); }}>
                    <td>
                      <span className="cm-code">{b.statut === 'brouillon' ? 'Brouillon' : b.numero_complet}</span>
                      {b.remplace_numero && <span className="cm-sous">révise {b.remplace_numero}</span>}
                      {b.nb_proformas > 0 && <span className="cm-sous">📎 proforma</span>}
                    </td>
                    <td>{dateFr(b.emis_le || b.cree_le)}</td>
                    <td><strong>{b.fournisseur_nom}</strong></td>
                    <td>{b.demande_numero}<span className="cm-sous">{b.demandeur_nom}</span></td>
                    <td>{b.magasin_code}</td>
                    <td className="cm-num">{fmtMontant(b.total_ttc, b.devise)}</td>
                    <td>{b.statut === 'emis' && b.suivi ? <SuiviBon suivi={b.suivi} /> : <StatutBon statut={b.statut} />}{b.remplace_par_numero && <span className="cm-sous">→ {b.remplace_par_numero}</span>}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function BonsPage() {
  const { can } = useApp();
  const prepare = can('com.bc.preparer');
  const [vue, setVue] = useState(prepare ? 'a_commander' : 'bons');
  return (
    <div className="cm-page">
      <Entete titre="Bons de commande"
        description="Un bon se prépare à partir d'une demande approuvée, se contrôle, puis s'émet : il reçoit alors son numéro, son PDF définitif et un QR code de vérification." />
      {prepare && (
        <div className="cm-onglets" role="tablist">
          <button type="button" role="tab" aria-selected={vue === 'a_commander'} onClick={() => setVue('a_commander')}>À commander</button>
          <button type="button" role="tab" aria-selected={vue === 'bons'} onClick={() => setVue('bons')}>Bons de commande</button>
        </div>
      )}
      {vue === 'a_commander' && prepare ? <ACommander /> : <Liste />}
    </div>
  );
}
