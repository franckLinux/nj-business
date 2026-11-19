import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { lignesEntite } from '@/lib/print';
import PeriodiciteBudget from '@/components/config/PeriodiciteBudget';
import BasculePlanModal, { PastilleReferentiel } from '@/components/config/BasculePlanModal';

// NJ CAISSE PRO — onglet « Entité » : identité (lecture) et paramètres de la caisse.
//   • 064 : l'identité de l'entreprise se saisit dans la configuration centrale
//     NJ BUSINESS, commune à tous les modules ; elle est seulement présentée ici ;
//   • 065 : la caisse règle ce qui lui est propre — plan comptable (CHOISI ici,
//     la forme juridique ne fait que le suggérer), périodicité du budget.
//   • 19/11/2026 : section « Signataires et exercice » retirée (non demandée).
//     Les noms déjà enregistrés restent utilisés sur les impressions ; à défaut
//     de directeur, c'est le représentant légal de l'entreprise.
const cardStyle = { background: 'white', border: '1px solid var(--border)', borderRadius: 12, padding: 24, marginBottom: 16 };
const cardTitleStyle = { fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 16 };
const nomRef = (c) => (c === 'SYCEBNL' ? 'SYCEBNL' : 'SYSCOHADA révisé');

export default function EntiteTab() {
  const { can } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const canEdit = can('config.edit');
  const [erreur, setErreur] = useState('');
  const [ent, setEnt] = useState(null);
  const [p, setP] = useState(null);             // paramètres de la caisse
  const [bascule, setBascule] = useState(null); // { de, vers, versInfo, apercu, contexte }
  const [basculeEnCours, setBasculeEnCours] = useState(false);

  const appliquer = (x) => setP(x);

  useEffect(() => {
    let annule = false;
    Promise.all([api.get('/config'), api.get('/caisse/parametres')]).then(([d, x]) => {
      if (annule) return;
      if (d.error || x.error) { setErreur(d.error || x.error); return; }
      setEnt(d);
      appliquer(x);
    });
    return () => { annule = true; };
  }, []);

  const proposerPlan = async (vers) => {
    const r = await api.get(`/caisse/parametres/plan?referentiel=${encodeURIComponent(vers)}`);
    if (r.error) { toast(r.error, 'error'); return; }
    if (!r.change) { toast(`La caisse applique déjà le ${nomRef(vers)}.`, 'success'); return; }
    setBascule({ de: r.actuel, vers: r.cible, versInfo: r.cible_info, apercu: r.apercu, contexte: 'choix' });
  };

  const confirmerBascule = async () => {
    setBasculeEnCours(true);
    const r = await api.post('/caisse/parametres/plan', { referentiel: bascule.vers, confirmer: true });
    setBasculeEnCours(false);
    if (r.error) { toast(r.error, 'error', 8000); return; }
    setBascule(null);
    if (r.parametres) setP(r.parametres);
    toast(r.message, 'success', 7000);
  };


  if (erreur) return <div className="alert-err">{erreur}</div>;
  if (!ent || !p) return <div className="loading-msg">Chargement…</div>;
  const l = lignesEntite(ent);

  return (
    <div style={{ maxWidth: 760 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 20 }}>Entité et paramètres de la caisse</h3>

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
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 14px' }}>
          Le plan comptable se choisit ici. La forme juridique de l'entreprise suggère le <b>{nomRef(p.plan.suggere)}</b>.
        </p>
        <div role="radiogroup" aria-label="Plan comptable" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
          {Object.values(p.plan.referentiels).map((r) => {
            const actif = p.plan.actuel === r.code;
            return (
              <button key={r.code} type="button" role="radio" aria-checked={actif} disabled={!canEdit || actif}
                onClick={() => proposerPlan(r.code)}
                style={{ textAlign: 'left', padding: '12px 14px', borderRadius: 10, cursor: canEdit && !actif ? 'pointer' : 'default',
                  border: `1.5px solid ${actif ? 'var(--accent)' : 'var(--border)'}`, background: actif ? '#eff6ff' : 'white', font: 'inherit', color: 'inherit' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                  <PastilleReferentiel code={r.code} />
                  {actif && <span style={{ fontSize: 11, fontWeight: 700, color: '#1d4ed8' }}>En place</span>}
                  {p.plan.suggere === r.code && <span style={{ fontSize: 11, fontWeight: 700, color: '#047857', background: '#ecfdf5', borderRadius: 999, padding: '1px 8px' }}>Suggéré</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45 }}>{r.description}</div>
                {canEdit && !actif && <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', marginTop: 8 }}>Choisir ce plan…</div>}
              </button>
            );
          })}
        </div>
        {p.plan.ecart && (
          <div className="ctl-alerte" style={{ background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a', marginTop: 14 }}>
            La caisse applique le <b>{nomRef(p.plan.actuel)}</b> alors que la forme juridique suggère le <b>{nomRef(p.plan.suggere)}</b>. C'est possible : vérifiez simplement que c'est voulu.
          </div>
        )}
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '12px 0 0' }}>
          Un changement n'efface rien : les comptes sortants sont archivés, les comptes utilisés et vos comptes ajoutés sont conservés, et le retour au plan précédent reste possible.
        </p>
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
