// NJ COMMERCIAL — tableau de bord des achats. Uniquement des chiffres réels lus en base :
// une période sans activité s'affiche vide, jamais avec des valeurs d'exemple.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { useApp } from '@/context/AppContext';
import { Entete, Section, fmtMontant } from '@/components/commercial/ui';
import { STATUTS, dateFr } from '@/components/commercial/achats';

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const libMois = (m) => { const [a, n] = m.split('-'); return `${MOIS[Number(n) - 1]} ${a.slice(2)}`; };
const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M` : n >= 1e3 ? `${Math.round(n / 1e3).toLocaleString('fr-FR')} k` : String(Math.round(n)));

function Tuile({ libelle, valeur, detail, lien, alerte }) {
  const contenu = (
    <>
      <span className="cm-tuile-lib">{libelle}</span>
      <span className="cm-tuile-val">{valeur}</span>
      {detail && <span className="cm-tuile-det">{detail}</span>}
    </>
  );
  return lien
    ? <Link to={lien} className={'cm-tuile' + (alerte ? ' cm-tuile-alerte' : '')}>{contenu}</Link>
    : <div className={'cm-tuile' + (alerte ? ' cm-tuile-alerte' : '')}>{contenu}</div>;
}

// Stock (lot 4) : valeur et alertes du périmètre filtré, lues dans les soldes calculés.
function BlocStock({ agence, magasin, devise }) {
  const { can } = useApp();
  const [v, setV] = useState(null);
  const [c, setC] = useState(null);
  const voit = ['com.stock.voir', 'com.stock.valider'].some((x) => can(x));
  const valeurs = can('com.stock.valorisation');
  useEffect(() => {
    if (!voit) return;
    if (valeurs) api.get(`/commercial/stock/valorisation?agence_id=${agence}&magasin_id=${magasin}`).then((r) => { if (!r?.error) setV(r); });
    else setV({ total: null, magasins: [], a_valoriser: null });
    api.get('/commercial/stock/compteurs').then((r) => { if (!r?.error) setC(r); });
  }, [voit, valeurs, agence, magasin]);
  if (!voit || !v || !c) return null;
  return (
    <>
      <h2 className="cm-titre-domaine">Stock</h2>
      <div className="cm-tuiles">
        {valeurs && <Tuile libelle="Valeur du stock" valeur={fmtMontant(v.total, devise)} detail={`${v.magasins.length} magasin(s), aujourd'hui`} lien="/commercial/stock/valorisation" />}
        <Tuile libelle="Sous le seuil d'alerte" valeur={c.sous_seuil} alerte={c.sous_seuil > 0} lien={can('com.stock.voir') ? '/commercial/stock' : null} detail="tous vos magasins" />
        <Tuile libelle="Documents à valider" valeur={c.a_valider} alerte={c.a_valider > 0} lien={can('com.stock.valider') ? '/commercial/stock/validation' : null}
          detail="saisis par d'autres personnes" />
        {valeurs && <Tuile libelle="Lignes sans coût" valeur={v.a_valoriser} alerte={v.a_valoriser > 0} detail="stock d'ouverture à valoriser" />}
      </div>
    </>
  );
}

// Barres verticales d'une seule série (montant émis par mois) ; info-bulle au survol.
function BarresMois({ donnees, devise }) {
  const max = Math.max(...donnees.map((m) => m.ttc), 0);
  if (!max) return <p className="cm-aide">Aucun bon émis sur la période.</p>;
  return (
    <div className="cm-histo" role="img" aria-label="Montant TTC des bons émis par mois">
      {donnees.map((m) => (
        <div key={m.mois} className="cm-histo-col" title={`${libMois(m.mois)} : ${fmtMontant(m.ttc, devise)} · ${m.bons} bon(s) émis`}>
          <span className="cm-histo-val">{m.ttc ? compact(m.ttc) : ''}</span>
          <div className="cm-histo-zone"><div className="cm-histo-barre" style={{ height: `${Math.max(m.ttc ? 2 : 0, (m.ttc / max) * 100)}%` }} /></div>
          <span className="cm-histo-lib">{libMois(m.mois)}</span>
        </div>
      ))}
    </div>
  );
}

// Barres horizontales : principaux fournisseurs (montant émis), libellé et valeur en clair.
function BarresFournisseurs({ donnees, devise }) {
  if (!donnees.length) return <p className="cm-aide">Aucun bon émis sur la période.</p>;
  const max = donnees[0].ttc || 1;
  return (
    <ul className="cm-hbarres">
      {donnees.map((f) => (
        <li key={f.id} title={`${f.nom} : ${fmtMontant(f.ttc, devise)} · ${f.n} bon(s)`}>
          <span className="cm-hb-nom">{f.nom}</span>
          <span className="cm-hb-piste"><span className="cm-hb-barre" style={{ width: `${Math.max(1, (f.ttc / max) * 100)}%` }} /></span>
          <span className="cm-hb-val">{fmtMontant(f.ttc, '')}<span className="cm-sous">{f.n} bon{f.n > 1 ? 's' : ''}</span></span>
        </li>
      ))}
    </ul>
  );
}

export default function TableauBordPage() {
  const { can } = useApp();
  const [du, setDu] = useState('');
  const [au, setAu] = useState('');
  const [agence, setAgence] = useState('');
  const [magasin, setMagasin] = useState('');
  const [refs, setRefs] = useState({ agences: [], magasins: [] });
  const [t, setT] = useState(null);
  const [erreur, setErreur] = useState('');
  useEffect(() => {
    Promise.all([api.get('/commercial/agences'), api.get('/commercial/magasins?perimetre=1')]).then(([a, m]) => {
      const magasins = Array.isArray(m) ? m : [];
      const ids = new Set(magasins.map((x) => x.agence_id));
      setRefs({ agences: Array.isArray(a) ? a.filter((x) => ids.has(x.id)) : [], magasins });
    });
  }, []);
  useEffect(() => {
    api.get(`/commercial/tableau-bord?du=${du}&au=${au}&agence_id=${agence}&magasin_id=${magasin}`).then((r) => {
      if (r?.error) { setErreur(r.error); return; }
      setErreur(''); setT(r);
      if (!du && !au) { setDu(r.periode.du); setAu(r.periode.au); }
    });
  }, [du, au, agence, magasin]);
  const magasinsVisibles = refs.magasins.filter((m) => !agence || String(m.agence_id) === agence);

  if (!t) return <div className="cm-page">{erreur ? <div className="cm-erreur">{erreur}</div> : <div className="loading-msg">Chargement…</div>}</div>;
  const at = t.a_traiter;
  const devise = t.devise || 'FCFA';
  const statuts = Object.entries(t.demandes.par_statut).sort((a, b) => b[1].n - a[1].n);

  return (
    <div className="cm-page">
      <Entete titre="Tableau de bord commercial" description="Chiffres lus en temps réel dans les documents enregistrés. « À traiter » porte sur aujourd'hui, le reste sur la période. Les ventes s'ajouteront ici quand leur lot sera livré." />
      <div className="cm-outils">
        <input className="cm-select" type="date" value={du} max={au || undefined} onChange={(e) => setDu(e.target.value)} aria-label="Du" title="Du" />
        <input className="cm-select" type="date" value={au} min={du || undefined} onChange={(e) => setAu(e.target.value)} aria-label="Au" title="Au" />
        {refs.agences.length > 1 && (
          <select className="cm-select" value={agence} onChange={(e) => { setAgence(e.target.value); setMagasin(''); }} aria-label="Agence">
            <option value="">Toutes les agences</option>
            {refs.agences.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.nom}</option>)}
          </select>
        )}
        {magasinsVisibles.length > 1 && (
          <select className="cm-select" value={magasin} onChange={(e) => setMagasin(e.target.value)} aria-label="Magasin">
            <option value="">Tous les magasins</option>
            {magasinsVisibles.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.nom}</option>)}
          </select>
        )}
      </div>
      <h2 className="cm-titre-domaine">Achats</h2>
      {erreur && <div className="cm-erreur">{erreur}</div>}

      <h3 className="cm-titre-bloc">À traiter aujourd'hui</h3>
      <div className="cm-tuiles">
        <Tuile libelle="À autoriser (achats)" valeur={at.examen_achats} alerte={at.examen_achats > 0}
          lien={can('com.da.approuver') ? '/commercial/autorisations' : null}
          detail={at.plus_ancienne_en_attente ? `la plus ancienne depuis le ${dateFr(at.plus_ancienne_en_attente)}` : 'aucune en attente'} />
        <Tuile libelle="À autoriser (direction)" valeur={at.examen_direction} alerte={at.examen_direction > 0}
          lien={can('com.da.approuver_direction') ? '/commercial/autorisations' : null} />
        <Tuile libelle="Renvoyées pour correction" valeur={at.a_corriger} lien={can('com.da.voir_tout') ? '/commercial/demandes' : null} />
        <Tuile libelle="Approuvées à commander" valeur={at.a_commander} alerte={at.a_commander > 0}
          lien={can('com.bc.preparer') ? '/commercial/bons' : null} detail="quantités pas encore sur un bon" />
      </div>

      <h3 className="cm-titre-bloc">Sur la période</h3>
      <div className="cm-tuiles">
        <Tuile libelle="Demandes" valeur={t.demandes.total} detail={`${t.demandes.par_statut.approuvee?.n || 0} approuvée(s) · ${t.demandes.par_statut.rejetee?.n || 0} rejetée(s)`} />
        <Tuile libelle="Bons émis" valeur={t.bons.emis} detail={fmtMontant(t.bons.montant_emis, devise) + ' TTC'} lien="/commercial/bons" />
        <Tuile libelle="Annulés · remplacés" valeur={`${t.bons.annules} · ${t.bons.remplaces}`} detail={`${t.bons.brouillons} brouillon(s) en cours`} />
        <Tuile libelle="Délai moyen d'autorisation" valeur={t.delai_moyen_autorisation_jours === null ? '—' : `${String(t.delai_moyen_autorisation_jours).replace('.', ',')} j`}
          detail={t.delai_moyen_autorisation_jours === null ? 'aucune demande approuvée' : 'de la soumission à l\'approbation'} />
      </div>

      <div className="cm-deux cm-deux-egal">
        <Section titre="Montant TTC des bons émis, par mois">
          <BarresMois donnees={t.par_mois} devise={devise} />
          <details className="cm-detail-table">
            <summary>Voir les chiffres</summary>
            <table className="cm-lignes">
              <thead><tr><th>Mois</th><th style={{ textAlign: 'right' }}>Demandes</th><th style={{ textAlign: 'right' }}>Bons émis</th><th style={{ textAlign: 'right' }}>TTC émis</th></tr></thead>
              <tbody>{t.par_mois.map((m) => (
                <tr key={m.mois}><td>{libMois(m.mois)}</td><td className="cm-num">{m.demandes}</td><td className="cm-num">{m.bons}</td><td className="cm-num">{fmtMontant(m.ttc, '')}</td></tr>
              ))}</tbody>
            </table>
          </details>
        </Section>
        <Section titre="Principaux fournisseurs (bons émis)">
          <BarresFournisseurs donnees={t.par_fournisseur} devise={devise} />
        </Section>
      </div>

      <div className="cm-deux cm-deux-egal">
        <Section titre="Demandes par statut">
          {statuts.length === 0 ? <p className="cm-aide">Aucune demande sur la période.</p> : (
            <table className="cm-lignes">
              <thead><tr><th>Statut</th><th style={{ textAlign: 'right' }}>Nombre</th><th style={{ textAlign: 'right' }}>Montant estimé</th></tr></thead>
              <tbody>{statuts.map(([s, v]) => (
                <tr key={s}><td>{STATUTS[s]?.[0] || s}</td><td className="cm-num">{v.n}</td><td className="cm-num">{s === 'brouillon' ? '—' : fmtMontant(v.montant, '')}</td></tr>
              ))}</tbody>
            </table>
          )}
        </Section>
        <Section titre="Par demandeur">
          {t.par_demandeur.length === 0 ? <p className="cm-aide">Aucune demande soumise sur la période.</p> : (
            <table className="cm-lignes">
              <thead><tr><th>Demandeur · service</th><th style={{ textAlign: 'right' }}>Soumises</th><th style={{ textAlign: 'right' }}>Approuvées</th><th style={{ textAlign: 'right' }}>Montant approuvé</th></tr></thead>
              <tbody>{t.par_demandeur.map((d) => (
                <tr key={`${d.demandeur}-${d.service}`}><td><strong>{d.demandeur}</strong>{d.service && <span className="cm-sous">{d.service}</span>}</td>
                  <td className="cm-num">{d.n}</td><td className="cm-num">{d.approuvees}{d.rejetees ? <span className="cm-sous">{d.rejetees} rejetée(s)</span> : null}</td>
                  <td className="cm-num">{fmtMontant(d.montant_approuve, '')}</td></tr>
              ))}</tbody>
            </table>
          )}
        </Section>
      </div>
      <BlocStock agence={agence} magasin={magasin} devise={devise} />
      <p className="cm-aide">Pièces sur la période : {t.pieces.bons_avec_proforma} bon(s) avec proforma, {t.pieces.demandes_avec_pieces} demande(s) avec justificatifs.
        Réceptions, retours et factures fournisseurs se suivent dans leurs écrans ; les règlements se saisissent dans NJ CAISSE PRO.</p>
    </div>
  );
}
