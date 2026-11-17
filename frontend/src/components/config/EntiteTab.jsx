import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { lignesEntite } from '@/lib/print';
import PeriodiciteBudget from '@/components/config/PeriodiciteBudget';
import BasculePlanModal, { PastilleReferentiel } from '@/components/config/BasculePlanModal';

// NJ CAISSE PRO — onglet « Entité » (064).
// L'identité de l'entreprise (raison sociale, logo, références légales,
// représentant légal) se saisit désormais dans la configuration centrale
// NJ BUSINESS, commune à tous les modules : elle est seulement présentée ici.
// L'onglet garde les réglages propres à la caisse : plan comptable et
// périodicité du budget.
const cardStyle = { background: 'white', border: '1px solid var(--border)', borderRadius: 12, padding: 24, marginBottom: 16 };
const cardTitleStyle = { fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 16 };

export default function EntiteTab() {
  const { can } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const canEdit = can('config.edit');
  const [erreur, setErreur] = useState('');
  const [ent, setEnt] = useState(null);
  const [planRef, setPlanRef] = useState({ actuel: 'SYSCOHADA', attendu: 'SYSCOHADA', referentiels: {} });
  const [bascule, setBascule] = useState(null);   // { de, vers, versInfo, apercu, contexte }
  const [basculeEnCours, setBasculeEnCours] = useState(false);

  useEffect(() => {
    let annule = false;
    Promise.all([
      api.get('/config'),
      api.get('/config/referentiel').catch(() => ({ formes_juridiques: [] })),
    ]).then(([d, ref]) => {
      if (annule) return;
      if (d.error) { setErreur(d.error); return; }
      setEnt({ ...d, forme_libelle: (ref.formes_juridiques || []).find((f) => f.code === d.forme_juridique)?.label || d.forme_juridique });
      setPlanRef({ actuel: d.plan_referentiel || 'SYSCOHADA', attendu: d.plan_referentiel_attendu || 'SYSCOHADA', referentiels: ref.referentiels || {} });
    });
    return () => { annule = true; };
  }, []);

  const confirmerBascule = async () => {
    setBasculeEnCours(true);
    const res = await api.post('/config/plan-referentiel/bascule', { confirmer: true });
    if (res.error) toast(res.error, 'error', 8000);
    else {
      setBascule(null);
      setPlanRef((p) => ({ ...p, actuel: res.etat?.actuel || p.actuel, attendu: res.etat?.attendu || p.attendu }));
      toast(res.message, 'success', 7000);
    }
    setBasculeEnCours(false);
  };

  const ouvrirAlignement = async () => {
    const r = await api.get('/config/plan-referentiel');
    if (r.error) { toast(r.error, 'error'); return; }
    if (!r.change) { toast('Le plan comptable correspond déjà à la forme juridique.', 'success'); return; }
    setBascule({ de: r.actuel, vers: r.cible, versInfo: r.cible_info, apercu: r.apercu, contexte: 'alignement' });
  };

  if (erreur) return <div className="alert-err">{erreur}</div>;
  if (!ent) return <div className="loading-msg">Chargement…</div>;
  const l = lignesEntite(ent);
  const nomRef = (c) => (c === 'SYCEBNL' ? 'SYCEBNL' : 'SYSCOHADA révisé');
  const info = planRef.referentiels?.[planRef.actuel];

  return (
    <div style={{ maxWidth: 760 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 20 }}>Entité et réglages de la caisse</h3>

      <div style={cardStyle}>
        <h4 style={cardTitleStyle}>🏢 Identité de l'entreprise</h4>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
          {ent.logo_url && <img src={ent.logo_url} alt="Logo de l'entité" style={{ maxHeight: 50, maxWidth: 130, objectFit: 'contain' }} />}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#1e293b' }}>{ent.nom}{ent.sigle && <small style={{ fontWeight: 600, color: '#64748b' }}> ({ent.sigle})</small>}</div>
            <div style={{ fontSize: 11.5, color: '#64748b', overflowWrap: 'anywhere' }}>{l.coord.join(' · ') || 'Coordonnées non renseignées'}</div>
            {l.legal.length > 0 && <div style={{ fontSize: 11.5, color: '#64748b' }}>{l.legal.join(' · ')}</div>}
            {ent.dirigeant_nom && <div style={{ fontSize: 11.5, color: '#64748b' }}>Représentant légal : {ent.dirigeant_nom}</div>}
          </div>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '12px 0' }}>
          L'identité, le logo, les références légales et le représentant légal sont communs à tous les modules NJ BUSINESS.
          Ils se modifient dans la configuration de l'entreprise et s'appliquent aux documents de la caisse.
        </p>
        {can('entreprise.view') && (
          <button type="button" className="btn-add" onClick={() => navigate('/entreprise')}>
            {can('entreprise.edit') ? 'Modifier la configuration de l\'entreprise' : 'Voir la configuration de l\'entreprise'}
          </button>
        )}
      </div>

      <div style={cardStyle}>
        <h4 style={cardTitleStyle}>📚 Plan comptable de la caisse</h4>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <PastilleReferentiel code={planRef.actuel} />
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{info?.description || nomRef(planRef.actuel)}</span>
        </div>
        {planRef.attendu !== planRef.actuel && (
          <div className="ctl-alerte" style={{ background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 14 }}>
            <span style={{ flex: '1 1 260px' }}>
              La forme juridique de l'entreprise suggère le <b>{nomRef(planRef.attendu)}</b> ; la caisse applique le <b>{nomRef(planRef.actuel)}</b>.
            </span>
            {canEdit && <button type="button" className="btn-ghost" style={{ background: 'white' }} onClick={ouvrirAlignement}>Passer au {nomRef(planRef.attendu)}…</button>}
          </div>
        )}
      </div>

      <PeriodiciteBudget />

      {bascule && (
        <BasculePlanModal {...bascule} enCours={basculeEnCours}
          onConfirmer={confirmerBascule} onAnnuler={() => { if (!basculeEnCours) setBascule(null); }} />
      )}

      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>🔑 Pour changer votre mot de passe : cliquez sur votre nom, en bas du menu latéral (« Mon compte »).</p>
    </div>
  );
}
