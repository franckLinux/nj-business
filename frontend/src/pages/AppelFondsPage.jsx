import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { fmt } from '@/lib/format';
import { printDemandeFonds } from '@/lib/print';
import BlocAttente from '@/components/BlocAttente';

// Reprend loadAppelFonds() de legacy/js/app.js (l. 3146-3261).
function SoldeBanqueInput({ initial, onSave }) {
  const [value, setValue] = useState(initial);
  useEffect(() => { setValue(initial); }, [initial]);
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', position: 'relative' }}>
      <input
        type="number" min="0" step="1000"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={(e) => {
          if ((parseFloat(e.target.value) || 0) !== (parseFloat(initial) || 0)) onSave(e.target.value);
        }}
        style={{ width: 148, textAlign: 'right', padding: '6px 44px 6px 10px', border: '1.5px solid var(--border)', borderRadius: 8, fontSize: 13, color: 'var(--accent-green)', fontWeight: 600, background: '#f0fff4', outline: 'none' }}
      />
      <span style={{ position: 'absolute', right: 9, fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', pointerEvents: 'none' }}>FCFA</span>
    </div>
  );
}

export default function AppelFondsPage() {
  const { mois, annee, devise, user, can, rubriques } = useApp();
  const toast = useToast();
  const [s, setS] = useState(null);
  const [banque, setBanque] = useState(null);
  const [erreur, setErreur] = useState('');

  const isDirecteur = can('appel_fonds.validate');
  const isCaissiere = can('previsions.edit');

  const charger = useCallback(async () => {
    setErreur('');
    const [synthese, bq] = await Promise.all([
      api.get(`/appel-fonds/synthese?mois=${mois}&annee=${annee}`),
      api.get(`/banque?mois=${mois}&annee=${annee}`),
    ]);
    if (!synthese || synthese.error) {
      setErreur((synthese && synthese.error) || 'Erreur de chargement de la demande de fonds.');
      return;
    }
    setS(synthese);
    setBanque(bq);
  }, [mois, annee]);

  useEffect(() => { setS(null); charger(); }, [charger]);

  const onAdd = async (type, rubrique, intitule, montant) => {
    if (!rubrique) { toast('Sélectionnez une rubrique.', 'error'); return; }
    const montantNum = parseFloat(montant) || 0;
    if (montantNum <= 0) { toast('Montant invalide.', 'error'); return; }
    const path = type === 'dep' ? '/budget/depenses-attente' : '/budget/ressources-attente';
    const res = await api.post(path, { mois, annee, rubrique_code: rubrique, intitule: intitule || rubrique, montant: montantNum });
    if (res.error) { toast(res.error, 'error'); return; }
    toast('Ligne ajoutée ✓', 'success');
    charger();
  };

  const onDelete = async (type, id) => {
    if (!window.confirm('Supprimer cette ligne ?')) return;
    const path = type === 'dep' ? `/budget/depenses-attente/${id}` : `/budget/ressources-attente/${id}`;
    const res = await api.delete(path);
    if (res && res.error) { toast(res.error, 'error'); return; }
    toast('Ligne supprimée.', 'success');
    charger();
  };

  const onSaveBanque = async (valeur) => {
    const montant = parseFloat(valeur) || 0;
    const res = await api.put('/banque', { mois, annee, solde_final: montant });
    if (res.error) { toast(res.error, 'error'); return; }
    toast('Solde banque enregistré ✓', 'success');
    charger();
  };

  const onStatut = async (statut) => {
    const commentaire = statut === 'valide' ? '' : (window.prompt('Commentaire (optionnel) :') || '');
    const res = await api.post('/budget/validation', { mois, annee, statut, commentaire });
    if (res.error) { toast(res.error, 'error'); return; }
    toast(`Demande ${statut === 'valide' ? 'approuvée' : statut} ✓`, 'success');
    charger();
  };

  if (erreur) return <div className="alert-err">{erreur}</div>;
  if (!s) return <div className="loading-msg">Chargement…</div>;

  const tr = s.tresorerie;
  const dispoApres = s.tresorerie_apres_attente;
  const approuve = s.validation?.statut === 'valide';

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Demande de Fonds — {mois} {annee}</h2>
        <button
          onClick={() => printDemandeFonds(s)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'white', border: '1px solid var(--border)', borderRadius: 9, fontSize: 12, fontWeight: 600, color: '#475569', cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}
        >
          🖨️ Imprimer
        </button>
      </div>

      <b style={{ color: '#1a365d', display: 'block', marginBottom: 8, fontSize: 13 }}>1. Trésorerie Actuelle</b>
      <div className="table-wrap" style={{ marginBottom: 20 }}>
        <table>
          <thead><tr><th>Désignation</th><th style={{ textAlign: 'right' }}>Montant</th></tr></thead>
          <tbody>
            <tr><td>Solde caisse espèces</td><td style={{ textAlign: 'right', color: 'var(--accent-green)' }}>{fmt(tr.solde_espece, devise)}</td></tr>
            <tr><td>Solde caisse OM</td><td style={{ textAlign: 'right', color: 'var(--accent-green)' }}>{fmt(tr.solde_om, devise)}</td></tr>
            <tr>
              <td>Solde final en banque</td>
              <td style={{ textAlign: 'right' }}>
                {isCaissiere
                  ? <SoldeBanqueInput initial={banque?.solde_final || 0} onSave={onSaveBanque} />
                  : <span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>{fmt(tr.solde_banque, devise)}</span>}
              </td>
            </tr>
          </tbody>
          <tfoot><tr style={{ background: '#f8fafc', fontWeight: 700 }}><td>TOTAL TRÉSORERIE</td><td style={{ textAlign: 'right' }}>{fmt(tr.total, devise)}</td></tr></tfoot>
        </table>
      </div>

      <BlocAttente
        num={2} titre="Ressources Additionnelles Attendues" couleur="var(--accent-green)" type="res"
        rows={s.ressources_attente} isCaissiere={isCaissiere} rubriquesListe={rubriques.entrees || []}
        devise={devise} mois={mois} annee={annee} onAdd={onAdd} onDelete={onDelete}
      />
      <BlocAttente
        num={3} titre="Dépenses en Attente" couleur="#744210" type="dep"
        rows={s.depenses_attente} isCaissiere={isCaissiere} rubriquesListe={rubriques.depenses || []}
        devise={devise} mois={mois} annee={annee} onAdd={onAdd} onDelete={onDelete}
      />

      <div style={{ background: dispoApres >= 0 ? '#f0fff4' : '#fff5f5', border: `1px solid ${dispoApres >= 0 ? '#9ae6b4' : '#feb2b2'}`, borderRadius: 7, padding: '10px 14px', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <strong style={{ fontSize: 13, color: 'var(--text-muted)' }}>Trésorerie disponible (après ressources + dépenses en attente)</strong>
        <span style={{ fontSize: 18, fontWeight: 700, color: dispoApres >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>{fmt(dispoApres, devise)}</span>
      </div>

      <b style={{ color: 'var(--accent-green)', display: 'block', marginBottom: 8, fontSize: 13 }}>
        4. Prévision des Dépenses — Demande de Fonds pour {s.mois_cible} {s.annee_cible}
      </b>

      {s.prevision.length === 0 ? (
        <div style={{ background: '#fffbeb', border: '1px solid #f6e05e', borderRadius: 7, padding: 16, textAlign: 'center', color: '#744210', fontSize: 13 }}>
          <div style={{ fontSize: 22, marginBottom: 6 }}>📋</div>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Aucune prévision saisie pour {s.mois_cible} {s.annee_cible}</div>
          <small style={{ color: '#718096' }}>
            La caissière doit saisir la prévision dans l'écran <b>Suivi Budgétaire</b> en choisissant le mois d'application : {s.mois_cible} {s.annee_cible}.
          </small>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            {approuve
              ? <span className="statut-badge statut-valide">✅ Approuvé le {(s.validation.validated_at || '').substring(0, 10)} — s'applique en {s.mois_cible} {s.annee_cible}</span>
              : <span className="statut-badge statut-attente">⏳ En attente — pour {s.mois_cible} {s.annee_cible}</span>}
            {isDirecteur && (
              <div style={{ display: 'flex', gap: 8 }}>
                {approuve ? (
                  <button className="btn-ghost" style={{ fontSize: 12, color: 'var(--text-muted)' }} onClick={() => onStatut('en_attente')}>↩ Remettre en attente</button>
                ) : (
                  <>
                    <button className="btn-ghost" style={{ fontSize: 12, color: 'var(--accent-green)' }} onClick={() => onStatut('valide')}>✅ Approuver la demande</button>
                    <button className="btn-ghost" style={{ fontSize: 12, color: 'var(--accent-red)' }} onClick={() => onStatut('rejete')}>↩ Refuser</button>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="table-wrap">
            <table>
              <thead><tr><th>Rubrique</th><th>Intitulé</th><th style={{ textAlign: 'right' }}>Montant prévisionnel</th></tr></thead>
              <tbody>
                {s.prevision.map((r) => (
                  <tr key={r.rubrique_code}>
                    <td><span className="badge-rubrique">{r.rubrique_code}</span></td>
                    <td>{r.intitule}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(r.montant, devise)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr style={{ background: '#f8fafc', fontWeight: 700 }}><td colSpan={2}>TOTAL PRÉVISIONNEL</td><td style={{ textAlign: 'right' }}>{fmt(s.total_prevision, devise)}</td></tr></tfoot>
            </table>
          </div>

          {s.besoin > 0 ? (
            <div style={{ background: '#fff5f5', border: '2px solid #e53e3e', borderRadius: 8, padding: 14, textAlign: 'center', marginTop: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#718096', textTransform: 'uppercase' }}>Fonds supplémentaires à demander pour {s.mois_cible}</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--accent-red)' }}>{fmt(s.besoin, devise)}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Trésorerie disponible : {fmt(s.tresorerie_disponible, devise)} | Prévision : {fmt(s.total_prevision, devise)}</div>
            </div>
          ) : (
            <div style={{ background: '#f0fff4', border: '2px solid #38a169', borderRadius: 8, padding: 14, textAlign: 'center', marginTop: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#718096', textTransform: 'uppercase' }}>Trésorerie suffisante pour couvrir {s.mois_cible}</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--accent-green)' }}>{fmt(s.excedent, devise)}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Trésorerie disponible : {fmt(s.tresorerie_disponible, devise)} | Prévision : {fmt(s.total_prevision, devise)}</div>
            </div>
          )}
        </>
      )}
    </>
  );
}
