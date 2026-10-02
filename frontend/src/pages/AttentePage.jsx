import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { fmt } from '@/lib/format';
import MouvementAttenteCard from '@/components/MouvementAttenteCard';

// Reprend loadMouvementsAttentePage() de legacy/js/app.js (l. 2552-2593) —
// vue directeur de toutes les dépenses bloquées (RG-03/04/06), tous mois
// confondus, avec approbation/rejet.

export default function AttentePage() {
  const { devise } = useApp();
  const toast = useToast();
  const [list, setList] = useState(null);
  const [total, setTotal] = useState(0);
  const [erreur, setErreur] = useState('');

  const charger = useCallback(async () => {
    const res = await api.get('/mouvements-attente?statut=en_attente');
    if (res.error) { setErreur(res.error); return; }
    setList(res.mouvements || []);
    setTotal(res.total_en_attente || 0);
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const onApprouver = async (id) => {
    if (!window.confirm('Approuver cette dépense ? Elle sera écrite dans le journal de caisse.')) return;
    const res = await api.patch(`/mouvements-attente/${id}/approuver`, {});
    if (res.error) { toast(res.error, 'error'); return; }
    toast('Dépense approuvée et enregistrée ✓', 'success');
    charger();
  };

  const onRejeter = async (id) => {
    const commentaire = window.prompt('Motif du rejet (optionnel) :') || '';
    const res = await api.patch(`/mouvements-attente/${id}/rejeter`, { commentaire });
    if (res.error) { toast(res.error, 'error'); return; }
    toast('Dépense rejetée.', 'warning');
    charger();
  };

  if (erreur) return <div className="alert-err">{erreur}</div>;
  if (!list) return <div className="loading-msg">Chargement…</div>;

  if (list.length === 0) {
    return (
      <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 16, padding: '60px 40px', textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>Aucune dépense en attente</div>
        <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>Toutes les demandes de la caisse ont été traitées.</div>
      </div>
    );
  }

  const groupes = {};
  list.forEach((m) => {
    const k = `${m.mois} ${m.annee}`;
    (groupes[k] = groupes[k] || []).push(m);
  });

  return (
    <>
      <div style={{ background: 'linear-gradient(135deg,#744210,#5c340d)', borderRadius: 16, padding: '22px 26px', marginBottom: 18, boxShadow: '0 4px 24px rgba(116,66,16,.22)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 19, fontWeight: 800, color: 'white' }}>⏳ Dépenses en attente d'autorisation</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.65)', marginTop: 3 }}>
            {list.length} demande{list.length > 1 ? 's' : ''} initiée{list.length > 1 ? 's' : ''} par la caisse, à approuver ou rejeter
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.6)', textTransform: 'uppercase', fontWeight: 700 }}>Total en attente</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'white' }}>{fmt(total, devise)}</div>
        </div>
      </div>
      {Object.keys(groupes).map((k) => (
        <div key={k} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: .5, margin: '0 0 8px 2px' }}>{k}</div>
          {groupes[k].map((m) => (
            <MouvementAttenteCard key={m.id} m={m} devise={devise} onApprouver={onApprouver} onRejeter={onRejeter} />
          ))}
        </div>
      ))}
    </>
  );
}
