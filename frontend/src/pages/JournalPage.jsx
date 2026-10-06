import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { TYPES_ICONS, fmt } from '@/lib/format';
import MouvementModal from '@/components/MouvementModal';
import RanModal from '@/components/RanModal';
import BudgetCaisseModal from '@/components/BudgetCaisseModal';
import ArretCaisseModal from '@/components/ArretCaisseModal';
import { printJournalView } from '@/lib/print';
import { BonPretModal, BoutonBon } from '@/components/BonCaisse';
import { syncManager } from '@/lib/syncManager';

// Reprend loadJournalPage() de legacy/js/app.js (l. 295) — même structure DOM,
// mêmes couleurs, mêmes calculs, y compris les actions RAN / Budget caisse /
// Arrêt-Réouverture de caisse (l. 434-462, 1478-1806).
const TYPE_COLOR = { caisse: '#16a34a', om: '#ea580c', momo: '#ca8a04', carte_prepayee: '#7c3aed', banque: '#0369a1', autre: '#64748b' };
const TYPE_LABEL = { caisse: 'Caisse Espèces', om: 'Orange Money', momo: 'Mobile Money', carte_prepayee: 'Carte Prépayée', banque: 'Banque', autre: 'Autre' };
const ALERTE_COLOR = { depasse: '#dc2626', critique: '#ea580c', attention: '#d97706', ok: '#7c3aed' };
const ALERTE_BG = { depasse: 'linear-gradient(135deg,#fef2f2,#fee2e2)', critique: 'linear-gradient(135deg,#fff7ed,#fed7aa)', attention: 'linear-gradient(135deg,#fffbeb,#fef08a)', ok: 'linear-gradient(135deg,#f5f3ff,#ede9fe)' };
const ALERTE_BORDER = { depasse: '#fca5a5', critique: '#fdba74', attention: '#fde68a', ok: '#c4b5fd' };

export default function JournalPage() {
  const { id } = useParams();
  const journalId = Number(id);
  const { journaux, mois, annee, MOIS, devise, user, can, activeTenantNom } = useApp();
  const toast = useToast();

  const [data, setData] = useState(null);
  const [budgetCaisse, setBudgetCaisse] = useState(null);
  const [erreur, setErreur] = useState('');
  const [modal, setModal] = useState(undefined); // undefined = fermée, null = création, objet = édition
  const [ranOpen, setRanOpen] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [arretOpen, setArretOpen] = useState(false);

  const j = journaux.find((x) => x.id === journalId);

  const charger = useCallback(async () => {
    if (!j) return;
    setErreur('');
    const [d, b] = await Promise.all([
      api.get(`/journal?mois=${mois}&annee=${annee}&journal_id=${j.id}`),
      api.get(`/budget-caisse?journal_id=${j.id}&mois=${mois}&annee=${annee}`),
    ]);
    if (d.error) { setErreur(d.error); return; }
    setData(d);
    setBudgetCaisse(b && !b.error ? b : null);

    // Mise en cache du contexte de contrôle budgétaire pour le pré-contrôle
    // hors-ligne (reprend loadJournalPage(), l. 336-341 de legacy/js/app.js).
    if (navigator.onLine) {
      api.get(`/journal/controle-context?journal_id=${j.id}&mois=${mois}&annee=${annee}`)
        .then((ctx) => { if (ctx && !ctx.error) syncManager.cacheControleContext(ctx); })
        .catch(() => {});
    }
  }, [j, mois, annee]);

  useEffect(() => { setData(null); charger(); }, [charger]);

  // Annulation = contre-passation (écriture négative) ; jamais de suppression.
  // Directeur (journal.annuler) : annule directement. Caissière : demande.
  const peutAnnuler = can('journal.annuler');
  const peutDemander = peutAnnuler || can('journal.annulation_demander');
  const onAnnuler = async (m) => {
    const motif = window.prompt(
      `${peutAnnuler ? 'Annuler' : 'Demander l\'annulation de'} l'écriture n°${m.numero} « ${m.intitule} » ?\n`
      + 'Une écriture identique en négatif sera passée ; l\'écriture d\'origine reste visible.\n\nMotif (obligatoire) :');
    if (motif === null) return;
    const res = await api.post(`/journal/${m.id}/annulation`, { motif });
    if (res.error) { toast(res.error, 'error'); return; }
    toast(res.message, 'success');
    charger();
  };

  const [bonPret, setBonPret] = useState(null);

  const onImprimer = () => {
    printJournalView({ j, data, mois, annee, tenantNom: activeTenantNom || user?.tenantNom });
  };

  const onRouvrir = async () => {
    if (!window.confirm(`Rouvrir la caisse pour ${mois} ${annee} ?\nLes mouvements redeviendront éditables.`)) return;
    const res = await api.delete(`/journaux/${j.id}/arreter?mois=${mois}&annee=${annee}`);
    if (res.error) { toast(res.error, 'error'); return; }
    toast('Caisse réouverte.', 'success');
    charger();
  };

  if (!j) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 40px', background: 'white', border: '1px solid var(--border)', borderRadius: 16, boxShadow: '0 1px 8px rgba(0,0,0,.05)' }}>
        <div style={{ width: 64, height: 64, background: 'linear-gradient(135deg,#e2e8f0,#cbd5e1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, marginBottom: 16 }}>📒</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>Sélectionnez un journal</div>
        <div style={{ fontSize: 13, color: '#94a3b8' }}>Cliquez sur un journal dans la barre latérale gauche.</div>
      </div>
    );
  }

  if (erreur) return <div className="alert-err">{erreur}</div>;
  if (!data) return <div className="loading-msg">Chargement…</div>;

  const s = data.soldes || {};
  const ranAuto = data.ran_auto || 0;
  const soldePrev = data.solde_precedent || 0;
  const prevIdx = MOIS.indexOf(mois);
  const prevLabel = prevIdx === 0 ? `Décembre ${annee - 1}` : `${MOIS[prevIdx - 1]} ${annee}`;
  const arret = data.arret || null;
  const isArrete = Boolean(arret);
  const mouvements = data.mouvements || [];

  const budgetMontant = budgetCaisse ? parseFloat(budgetCaisse.montant) : 0;
  const budgetSorties = budgetCaisse ? (parseFloat(budgetCaisse.sorties_actuelles) || (parseFloat(s.sorties) || 0)) : (parseFloat(s.sorties) || 0);
  const budgetTaux = budgetCaisse?.taux_consommation ?? (budgetMontant > 0 ? Math.round((budgetSorties / budgetMontant) * 100) : 0);
  const budgetRestant = budgetCaisse?.restant ?? (budgetMontant > 0 ? budgetMontant - budgetSorties : 0);
  const budgetAlerte = budgetCaisse?.alerte ?? (budgetMontant > 0 && budgetSorties > budgetMontant ? 'depasse' : 'ok');
  const budgetDepasse = budgetAlerte === 'depasse';
  const budgetEnAttenteNb = budgetCaisse?.en_attente_nb || 0;
  const budgetPct = Math.min(budgetTaux, 100);
  const alerteColor = ALERTE_COLOR[budgetAlerte] || '#7c3aed';
  const alerteBg = ALERTE_BG[budgetAlerte] || ALERTE_BG.ok;
  const alerteBorder = ALERTE_BORDER[budgetAlerte] || '#c4b5fd';

  const typeColor = TYPE_COLOR[j.type] || '#64748b';
  const soldeColor = (parseFloat(s.solde) || 0) >= 0 ? '#15803d' : '#dc2626';
  const soldeBg = (parseFloat(s.solde) || 0) >= 0
    ? 'linear-gradient(135deg,#16a34a,#15803d)'
    : 'linear-gradient(135deg,#dc2626,#b91c1c)';

  const nbE = mouvements.filter((m) => parseFloat(m.entree) > 0).length;
  const nbS = mouvements.filter((m) => parseFloat(m.sortie) > 0).length;

  // Lignes avec cumul progressif (RAN + entrées − sorties), comme le legacy.
  let cumul = ranAuto;
  const lignes = mouvements.map((m) => {
    const e = parseFloat(m.entree) || 0;
    const so = parseFloat(m.sortie) || 0;
    cumul += e - so;
    return { m, e, so, cumul };
  });

  return (
    <>
      {/* ── Hero header ─────────────────────────────────────────────── */}
      <div style={{ background: 'linear-gradient(135deg,#1e293b 0%,#0f172a 100%)', borderRadius: 16, padding: '22px 26px', marginBottom: 16, boxShadow: '0 4px 24px rgba(15,23,42,.18)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -30, right: -30, width: 160, height: 160, borderRadius: '50%', background: typeColor, opacity: .12, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: -40, right: 60, width: 100, height: 100, borderRadius: '50%', background: typeColor, opacity: .08, pointerEvents: 'none' }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: typeColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, boxShadow: '0 2px 12px rgba(0,0,0,.2)' }}>
              {TYPES_ICONS[j.type] || '📒'}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 20, fontWeight: 800, color: 'white' }}>{j.nom}</span>
                <span style={{ background: 'rgba(255,255,255,.15)', color: 'rgba(255,255,255,.9)', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6 }}>{j.code}</span>
                {isArrete
                  ? <span style={{ background: '#dcfce7', color: '#15803d', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6 }}>🔒 Arrêtée</span>
                  : <span style={{ background: 'rgba(251,191,36,.2)', color: '#fbbf24', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6 }}>🔓 Ouverte</span>}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.55)' }}>
                {TYPE_LABEL[j.type] || j.type} · {mois} {annee}
                {j.responsable_saisie_nom && <> · Saisi par <strong style={{ color: 'rgba(255,255,255,.8)' }}>{j.responsable_saisie_nom}</strong></>}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {!isArrete && (
              <button
                onClick={() => setModal(null)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 16px', background: 'linear-gradient(135deg,#16a34a,#15803d)', border: 'none', borderRadius: 9, color: 'white', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 10px rgba(22,163,74,.35)' }}
              >
                + Nouveau mouvement
              </button>
            )}
            {can('journal.ran') && !isArrete && (
              <button
                onClick={() => setRanOpen(true)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 9, color: 'rgba(255,255,255,.8)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >
                📊 RAN
              </button>
            )}
            <button
              onClick={() => setBudgetOpen(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'rgba(139,92,246,.25)', border: '1px solid rgba(139,92,246,.4)', borderRadius: 9, color: '#c4b5fd', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              💰 Budget
            </button>
            {!isArrete ? (
              <button
                onClick={() => setArretOpen(true)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'rgba(217,119,6,.2)', border: '1px solid rgba(217,119,6,.4)', borderRadius: 9, color: '#fbbf24', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >
                🔒 Arrêter
              </button>
            ) : can('journaux.reouvrir') && (
              <button
                onClick={onRouvrir}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'rgba(239,68,68,.2)', border: '1px solid rgba(239,68,68,.4)', borderRadius: 9, color: '#fca5a5', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >
                🔓 Rouvrir
              </button>
            )}
            <button
              onClick={onImprimer}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 9, color: 'rgba(255,255,255,.8)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              🖨️ Imprimer
            </button>
            <button
              onClick={charger}
              title="Actualiser"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '8px 12px', background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 9, color: 'rgba(255,255,255,.7)', fontSize: 12, cursor: 'pointer' }}
            >
              ↺
            </button>
          </div>
        </div>

        {isArrete && (
          <div style={{ marginTop: 14, padding: '10px 14px', background: 'rgba(134,239,172,.12)', border: '1px solid rgba(134,239,172,.3)', borderRadius: 10, fontSize: 12, color: '#86efac' }}>
            🔒 Caisse arrêtée le <strong>{new Date(arret.arrete_le).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}</strong>
            {' '}par <strong>{arret.arrete_par_nom || '—'}</strong>
            {' '}· Solde arrêté : <strong>{fmt(parseFloat(arret.solde_final), devise)}</strong>
            {arret.commentaire && <> · <em>"{arret.commentaire}"</em></>}
          </div>
        )}
      </div>

      {/* ── KPI cards ───────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(190px,1fr))', gap: 12, marginBottom: 16 }}>
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid var(--border)', padding: '16px 18px', boxShadow: '0 1px 6px rgba(0,0,0,.05)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .6, color: '#92400e', marginBottom: 6 }}>Report à Nouveau</div>
          <div style={{ fontSize: 19, fontWeight: 800, color: '#78350f' }}>{fmt(ranAuto, devise)}</div>
          {soldePrev > 0 && <div style={{ fontSize: 10, color: '#a16207', marginTop: 4 }}>↑ Solde {prevLabel} : {fmt(soldePrev, devise)}</div>}
        </div>

        <div style={{ background: 'linear-gradient(135deg,#f0fdf4,#dcfce7)', borderRadius: 12, border: '1px solid #86efac', padding: '16px 18px', boxShadow: '0 1px 6px rgba(22,163,74,.08)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .6, color: '#16a34a', marginBottom: 6 }}>Entrées du mois</div>
          <div style={{ fontSize: 19, fontWeight: 800, color: '#15803d' }}>{fmt(s.entrees, devise)}</div>
          <div style={{ fontSize: 10, color: '#16a34a', marginTop: 4 }}>{nbE} opération{nbE > 1 ? 's' : ''}</div>
        </div>

        <div style={{ background: 'linear-gradient(135deg,#fef2f2,#fee2e2)', borderRadius: 12, border: '1px solid #fca5a5', padding: '16px 18px', boxShadow: '0 1px 6px rgba(220,38,38,.08)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .6, color: '#dc2626', marginBottom: 6 }}>Sorties du mois</div>
          <div style={{ fontSize: 19, fontWeight: 800, color: '#b91c1c' }}>{fmt(s.sorties, devise)}</div>
          <div style={{ fontSize: 10, color: '#dc2626', marginTop: 4 }}>{nbS} opération{nbS > 1 ? 's' : ''}</div>
        </div>

        <div style={{ background: soldeBg, borderRadius: 12, padding: '16px 18px', boxShadow: '0 2px 12px rgba(0,0,0,.12)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .6, color: 'rgba(255,255,255,.75)', marginBottom: 6 }}>Solde Final</div>
          <div style={{ fontSize: 19, fontWeight: 800, color: 'white' }}>{fmt(s.solde, devise)}</div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,.65)', marginTop: 4 }}>RAN + Entrées − Sorties</div>
        </div>

        {budgetMontant > 0 ? (
          <div
            onClick={() => setBudgetOpen(true)}
            style={{ background: alerteBg, borderRadius: 12, border: `1px solid ${alerteBorder}`, padding: '14px 16px', boxShadow: '0 1px 6px rgba(0,0,0,.07)', cursor: 'pointer' }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .6, color: alerteColor, marginBottom: 3 }}>
              {budgetAlerte === 'depasse' ? '⛔ Budget dépassé' : budgetAlerte === 'critique' ? '🔴 Critique' : budgetAlerte === 'attention' ? '🟡 Attention' : '💰 Budget dépenses'}
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: alerteColor }}>{fmt(budgetMontant, devise)}</div>
            <div style={{ marginTop: 7 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: alerteColor, marginBottom: 3 }}>
                <span>{budgetTaux}% consommé</span>
                <span>{budgetDepasse ? `−${fmt(Math.abs(budgetRestant), devise)}` : `${fmt(budgetRestant, devise)} restant`}</span>
              </div>
              <div style={{ background: 'rgba(0,0,0,.08)', borderRadius: 100, height: 7, overflow: 'hidden' }}>
                <div style={{ background: alerteColor, height: '100%', borderRadius: 100, width: `${budgetPct}%`, minWidth: 4 }} />
              </div>
            </div>
            {budgetEnAttenteNb > 0 && (
              <div style={{ marginTop: 7, fontSize: 10, fontWeight: 600, color: '#92400e', background: '#fef3c7', borderRadius: 6, padding: '3px 7px', display: 'inline-block' }}>
                ⏳ {budgetEnAttenteNb} demande{budgetEnAttenteNb > 1 ? 's' : ''} en attente
              </div>
            )}
          </div>
        ) : (
          <div
            onClick={() => setBudgetOpen(true)}
            style={{ background: '#f5f3ff', borderRadius: 12, border: '2px dashed #c4b5fd', padding: '16px 18px', textAlign: 'center', cursor: 'pointer' }}
          >
            <div style={{ fontSize: 20, marginBottom: 4 }}>💰</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', marginBottom: 2 }}>Budget non défini</div>
            <div style={{ fontSize: 10, color: '#a78bfa' }}>Cliquez pour définir un plafond mensuel</div>
          </div>
        )}
      </div>

      {/* ── Tableau des mouvements ──────────────────────────────────── */}
      <div style={{ background: 'white', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden', boxShadow: '0 1px 8px rgba(0,0,0,.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'linear-gradient(90deg,#f8fafc,#fff)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: typeColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
              {TYPES_ICONS[j.type] || '📒'}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>Mouvements — {mois} {annee}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>{mouvements.length} ligne{mouvements.length > 1 ? 's' : ''}</div>
            </div>
          </div>
        </div>

        <div className="table-wrap" style={{ margin: 0 }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 52 }}>N°</th>
                <th style={{ width: 90 }}>Date</th>
                <th style={{ width: 90 }}>Rubrique</th>
                <th>Intitulé</th>
                <th>Bénéficiaire</th>
                <th style={{ textAlign: 'right', width: 120 }}>Entrée</th>
                <th style={{ textAlign: 'right', width: 120 }}>Sortie</th>
                <th style={{ textAlign: 'right', width: 130 }}>Solde cumulé</th>
                <th style={{ width: 90, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {lignes.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: 50, color: '#94a3b8' }}>
                  <div style={{ fontSize: 32, marginBottom: 10 }}>📭</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Aucun mouvement</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>Aucune opération enregistrée pour {mois} {annee}</div>
                </td></tr>
              ) : lignes.map(({ m, e, so, cumul: c }) => {
                const cumulColor = c >= 0 ? '#15803d' : '#dc2626';
                const barree = m.annule ? { textDecoration: 'line-through', opacity: 0.55 } : {};
                return (
                  <tr key={m.id} style={m.annulation_de_id ? { background: '#fef2f2' } : undefined}>
                    <td style={{ color: '#475569', fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{m.numero ?? '—'}</td>
                    <td style={{ color: '#64748b', fontSize: 12, whiteSpace: 'nowrap', ...barree }}>
                      {new Date(m.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
                    </td>
                    <td>
                      <span style={{ background: '#f1f5f9', color: '#475569', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5, whiteSpace: 'nowrap' }}>{m.rubrique_code}</span>
                    </td>
                    <td>
                      <div style={{ fontSize: 13, fontWeight: 500, color: m.annulation_de_id ? '#b91c1c' : '#0f172a', ...barree }}>{m.intitule}</div>
                      {m.objet && <div style={{ fontSize: 11, color: '#94a3b8' }}>{m.annulation_de_id ? `Motif : ${m.objet}` : m.objet}</div>}
                      {m.annule && <span style={{ fontSize: 10, fontWeight: 700, color: '#b91c1c', background: '#fee2e2', borderRadius: 5, padding: '1px 6px' }}>ANNULÉE{m.motif_annulation ? ` — ${m.motif_annulation}` : ''}</span>}
                    </td>
                    <td style={{ fontSize: 12, color: '#64748b' }}>{m.beneficiaire || '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: e < 0 ? '#b91c1c' : '#16a34a', fontSize: 13, ...barree }}>{e !== 0 ? fmt(e, devise) : ''}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: '#dc2626', fontSize: 13, ...barree }}>{so !== 0 ? fmt(so, devise) : ''}</td>
                    <td style={{ textAlign: 'right', fontWeight: 800, fontSize: 13, color: cumulColor }}>{fmt(c, devise)}</td>
                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {m.id && m.numero != null && <BoutonBon m={m} toast={toast} onDone={charger} />}
                      {!isArrete && !m.annule && !m.annulation_de_id ? (
                        <>
                          {can('journal.edit') && (
                          <button
                            title="Corriger le libellé, l'objet ou le bénéficiaire"
                            onClick={() => setModal(m)}
                            style={{ padding: '4px 8px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 6, cursor: 'pointer', fontSize: 12, color: '#0369a1', marginRight: 3 }}
                          >✏️</button>
                          )}
                          {peutDemander && (
                          <button
                            title={peutAnnuler ? 'Annuler (contre-passation)' : 'Demander l\'annulation'}
                            onClick={() => onAnnuler(m)}
                            style={{ padding: '4px 8px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, cursor: 'pointer', fontSize: 12, color: '#dc2626' }}
                          >↩</button>
                          )}
                        </>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {lignes.length > 0 && (
              <tfoot>
                <tr style={{ background: 'linear-gradient(90deg,#0f172a,#1e293b)', color: 'white', fontWeight: 800 }}>
                  <td colSpan={5} style={{ color: 'rgba(255,255,255,.7)', fontSize: 12 }}>TOTAL DU MOIS</td>
                  <td style={{ textAlign: 'right', color: '#86efac', fontSize: 14 }}>{fmt(s.entrees, devise)}</td>
                  <td style={{ textAlign: 'right', color: '#fca5a5', fontSize: 14 }}>{fmt(s.sorties, devise)}</td>
                  <td style={{ textAlign: 'right', color: 'white', fontSize: 15 }}>{fmt(s.solde, devise)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {modal !== undefined && (
        <MouvementModal
          journal={j}
          mouvement={modal}
          onClose={() => setModal(undefined)}
          onSaved={(cree) => { setModal(undefined); charger(); if (cree?.id && cree?.numero) setBonPret(cree); else if (cree) toast('Mouvement enregistré ✓', 'success'); }}
        />
      )}

      {bonPret && (
        <BonPretModal
          m={bonPret}
          devise={devise}
          toast={toast}
          onDone={charger}
          onClose={() => setBonPret(null)}
          onNouvelle={() => { setBonPret(null); setModal(null); }}
        />
      )}

      {ranOpen && (
        <RanModal
          journal={j}
          ranActuel={ranAuto}
          onClose={() => setRanOpen(false)}
          onSaved={() => { setRanOpen(false); charger(); }}
        />
      )}

      {budgetOpen && (
        <BudgetCaisseModal
          journal={j}
          onClose={() => setBudgetOpen(false)}
          onSaved={() => { setBudgetOpen(false); charger(); }}
        />
      )}

      {arretOpen && (
        <ArretCaisseModal
          journal={j}
          soldeFinal={parseFloat(s.solde) || 0}
          onClose={() => setArretOpen(false)}
          onSaved={() => { setArretOpen(false); charger(); }}
        />
      )}
    </>
  );
}
