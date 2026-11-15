import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { api } from '@/lib/api';
import { fmt } from '@/lib/format';
import { printCompteEmploi, decomposerCompteEmploi } from '@/lib/print';
import CEEmploiDetailModal from '@/components/CEEmploiDetailModal';
import { exporterExcel, num, STYLE_BOUTON_EXPORT } from '@/lib/export';

// Reprend loadCompteEmploi() de legacy/js/app.js (l. 3371-3753).
// Impression (printCE, l. 3863-3910) reconstruite ici de façon déclarative à
// partir des données de l'API plutôt que par clonage DOM de #ce-printable
// (technique legacy) — voir lib/print.js#printCompteEmploi.
// Le sélecteur de client (showTenantSelector) n'est pas non plus branché ici
// (écart déjà documenté) : un super_admin sans tenant actif voit le message,
// sans bouton d'action.
const CE_TYPE_LABEL = { caisse: 'Caisse Espèces', om: 'Orange Money', momo: 'Mobile Money', carte_prepayee: 'Carte Prépayée', autre: 'Autre' };
const CE_TYPE_ICO = { caisse: '💵', om: '📱', momo: '📲', carte_prepayee: '💳', autre: '🏦' };

// Présentation en 4 parties : I. Soldes initiaux · II. Ressources (fonds reçus
// de la période) · III. Emplois · IV. Trésorerie finale = I + II − III.
// Le serveur renvoie ressources.total = soldes initiaux + fonds reçus : la
// séparation se fait ici (decomposerCompteEmploi), sans changer les montants.
function ResRow({ ico, label, montant, sub, devise, couleur = '#059669' }) {
  if (montant === 0) return null;
  return (
    <tr className="ce-res-row">
      <td style={{ padding: '9px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 15, flexShrink: 0 }}>{ico}</span>
        <span>
          <span style={{ fontWeight: 500, color: 'var(--text)' }}>{label}</span>
          {sub && <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginTop: 1 }}>{sub}</span>}
        </span>
      </td>
      <td style={{ padding: '9px 16px', textAlign: 'right', fontWeight: 600, color: couleur, fontSize: 13 }}>{fmt(montant, devise)}</td>
    </tr>
  );
}

// ── Présentation des emplois : par rubrique (défaut) ou par compte comptable ──
// Le choix est mémorisé dans ce navigateur (confort personnel uniquement).
const CLE_MODE = 'ce-emplois-mode';
const lireMode = () => { try { return localStorage.getItem(CLE_MODE) === 'compte' ? 'compte' : 'rubrique'; } catch { return 'rubrique'; } };
const ecrireMode = (m) => { try { localStorage.setItem(CLE_MODE, m); } catch { /* stockage indisponible */ } };

function ChoixPresentation({ mode, onChange }) {
  const opts = [['rubrique', 'Par rubrique', '🏷️'], ['compte', 'Par compte comptable', '📒']];
  return (
    <div className="ce-seg" role="radiogroup" aria-label="Présentation des emplois">
      {opts.map(([v, lib, ico]) => (
        <button key={v} type="button" role="radio" aria-checked={mode === v} className={mode === v ? 'on' : ''}
          onClick={(e) => { e.stopPropagation(); onChange(v); }}>
          <span aria-hidden>{ico}</span>{lib}
        </button>
      ))}
    </div>
  );
}

function EmploisParCompte({ groupes, total, fmtM, onDetail }) {
  const [ouverts, setOuverts] = useState(() => new Set());
  const basculer = (k) => setOuverts((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const tous = groupes.length > 0 && groupes.every((g) => ouverts.has(g.compte));
  const max = Math.max(...groupes.map((g) => g.total), 1);
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ background: '#fff8f8' }}>
          <th style={{ padding: '8px 16px', textAlign: 'left', borderBottom: '1px solid #fecaca', fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', width: 92 }}>
            <button type="button" className="ce-lien" onClick={() => setOuverts(tous ? new Set() : new Set(groupes.map((g) => g.compte)))}>{tous ? '− Replier' : '+ Déplier'}</button>
          </th>
          <th style={{ padding: '8px 4px', textAlign: 'left', borderBottom: '1px solid #fecaca', fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase' }}>Compte comptable</th>
          <th style={{ padding: '8px 16px', textAlign: 'right', borderBottom: '1px solid #fecaca', fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase' }}>Espèces</th>
          <th style={{ padding: '8px 16px', textAlign: 'right', borderBottom: '1px solid #fecaca', fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase' }}>MM</th>
          <th style={{ padding: '8px 16px', textAlign: 'right', borderBottom: '1px solid #fecaca', fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase' }}>Total</th>
        </tr>
      </thead>
      <tbody>
        {groupes.length === 0 && (
          <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: 13 }}>Aucune dépense enregistrée ce mois.</td></tr>
        )}
        {groupes.map((g) => {
          const ouvert = ouverts.has(g.compte);
          const pct = total ? Math.round((g.total / total) * 100) : 0;
          const sansCompte = !g.compte;
          return [
            <tr key={`c-${g.compte}`} className="ce-emp-row" style={{ cursor: 'pointer' }} onClick={() => basculer(g.compte)}
              tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); basculer(g.compte); } }} aria-expanded={ouvert}>
              <td style={{ padding: '10px 16px' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span aria-hidden style={{ display: 'inline-block', transition: 'transform .15s', transform: ouvert ? 'rotate(90deg)' : 'none', color: '#f87171', fontSize: 11 }}>▶</span>
                  <span className="ce-compte" style={sansCompte ? { background: '#fffbeb', borderColor: '#fde68a', color: '#b45309' } : undefined}>{sansCompte ? '—' : g.compte}</span>
                </span>
              </td>
              <td style={{ padding: '10px 4px' }}>
                <div style={{ fontWeight: 600, color: sansCompte ? '#b45309' : 'var(--text)', fontSize: 13 }}>{g.intitule}</div>
                <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, height: 4, background: '#f1f5f9', borderRadius: 2, maxWidth: 160 }}>
                    <div style={{ width: `${Math.round((g.total / max) * 100)}%`, height: '100%', background: sansCompte ? '#fbbf24' : '#f87171', borderRadius: 2 }} />
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{pct}% · {g.rubriques.length} rubrique{g.rubriques.length > 1 ? 's' : ''}</span>
                </div>
              </td>
              <td style={{ padding: '10px 16px', textAlign: 'right', color: '#9a3412', fontSize: 12 }}>{g.esp ? fmtM(g.esp) : '—'}</td>
              <td style={{ padding: '10px 16px', textAlign: 'right', color: '#9a3412', fontSize: 12 }}>{g.om ? fmtM(g.om) : '—'}</td>
              <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 800, color: '#dc2626', whiteSpace: 'nowrap' }}>{fmtM(g.total)}</td>
            </tr>,
            ...(ouvert ? g.rubriques.map((r) => (
              <tr key={`c-${g.compte}-${r.rubrique_code}`} className="ce-sub-row" style={{ cursor: 'pointer' }} onClick={() => onDetail(r)}>
                <td style={{ padding: '7px 16px 7px 40px' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 30, height: 20, padding: '0 4px', background: '#fff', border: '1px solid #fecdd3', borderRadius: 5, fontSize: 10, fontWeight: 700, color: '#dc2626' }}>{r.rubrique_code}</span>
                </td>
                <td style={{ padding: '7px 4px', fontSize: 12, color: '#475569' }}>{r.intitule}</td>
                <td style={{ padding: '7px 16px', textAlign: 'right', color: '#9a3412', fontSize: 11 }}>{r.esp ? fmtM(r.esp) : '—'}</td>
                <td style={{ padding: '7px 16px', textAlign: 'right', color: '#9a3412', fontSize: 11 }}>{r.om ? fmtM(r.om) : '—'}</td>
                <td style={{ padding: '7px 16px', textAlign: 'right', fontWeight: 600, color: '#b91c1c', fontSize: 12, whiteSpace: 'nowrap' }}>
                  {fmtM(r.total)}
                  <svg style={{ marginLeft: 4, opacity: .4, verticalAlign: 'middle' }} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
                </td>
              </tr>
            )) : []),
          ];
        })}
      </tbody>
    </table>
  );
}

export default function CompteEmploiPage() {
  const { mois, annee, user, activeTenantId, can, entite } = useApp();
  const [data, setData] = useState(null);
  const [erreur, setErreur] = useState('');
  const [detail, setDetail] = useState(null);
  const [mode, setModeEtat] = useState(lireMode);
  const setMode = (m) => { setModeEtat(m); ecrireMode(m); };

  const isAdmin = ['super_admin', 'comptable_cabinet'].includes(user?.role);
  const gated = isAdmin && !(activeTenantId || user?.tenantId);

  const charger = useCallback(async () => {
    if (gated) return;
    setErreur('');
    const res = await api.get(`/rapport/compte-emploi?mois=${mois}&annee=${annee}`);
    if (res.error) { setErreur(res.error); return; }
    setData(res);
  }, [mois, annee, gated]);

  useEffect(() => { setData(null); charger(); }, [charger]);

  if (gated) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 320, background: 'white', borderRadius: 16, boxShadow: '0 2px 16px rgba(0,0,0,.07)', border: '1px solid var(--border)', gap: 16 }}>
        <div style={{ width: 64, height: 64, background: 'linear-gradient(135deg,#dbeafe,#eff6ff)', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>🏢</div>
        <div style={{ textAlign: 'center' }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Sélectionnez un client</h3>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Choisissez le client pour générer son compte d'emploi</p>
        </div>
      </div>
    );
  }

  if (erreur) return <div className="alert-err">{erreur}</div>;
  if (!data) return <div className="loading-msg">Chargement…</div>;

  const { meta, ressources, emplois, tresorerie_finale, solde_net } = data;
  const devise = meta.devise;
  const fmtM = (v) => fmt(v, devise);
  const { soldesInitiaux, fondsRecus } = decomposerCompteEmploi(data);
  const disponible = soldesInitiaux + fondsRecus; // I + II
  const txUtilisation = disponible > 0 ? Math.round((emplois.total / disponible) * 100) : 0;
  const jTypeLabel = (t) => CE_TYPE_LABEL[t] || t;
  const jTypeIco = (t) => CE_TYPE_ICO[t] || '💼';

  const ranLignes = (ressources.journaux || []).filter((j) => j.ran > 0);
  const fondsLignes = (ressources.journaux || []).filter((j) => j.fonds_recus > 0);
  const emploisTriees = [...(emplois.lignes || [])].sort((a, b) => b.total - a.total);
  const maxEmploi = emploisTriees[0]?.total || 1;
  // Serveur plus ancien (sans par_compte) : regroupement refait ici, mêmes montants.
  const parCompte = emplois.par_compte || Object.values((emplois.lignes || []).reduce((acc, e) => {
    const k = e.code_comptable || '';
    acc[k] = acc[k] || { compte: k, intitule: k ? (e.compte_intitule || `Compte ${k}`) : 'Sans compte comptable', esp: 0, om: 0, total: 0, rubriques: [] };
    acc[k].esp += e.esp; acc[k].om += e.om; acc[k].total += e.total; acc[k].rubriques.push(e);
    return acc;
  }, {}));
  const sansCompte = parCompte.find((g) => !g.compte);
  const lignesEmploisExcel = mode === 'compte'
    ? parCompte.flatMap((g) => [
      ['III. Emplois', `${g.compte || '—'} — ${g.intitule}`, num(g.esp), num(g.om), num(g.total)],
      ...g.rubriques.map((r) => ['', `    rubrique ${r.rubrique_code} — ${r.intitule}`, num(r.esp), num(r.om), num(r.total)]),
    ])
    : emploisTriees.map((e) => ['III. Emplois', `${e.rubrique_code} — ${e.intitule}${e.code_comptable ? ` (${e.code_comptable})` : ''}`, num(e.esp), num(e.om), num(e.total)]);

  const tresFinale = solde_net;
  const ecart = tresorerie_finale.ecart !== undefined ? tresorerie_finale.ecart : (tresFinale - tresorerie_finale.disponible);
  const ecartOk = Math.abs(ecart) < 1;

  return (
    <>
      <style>{`
        .ce-res-row:hover{background:#f8fafc}
        .ce-res-row td{border-bottom:1px solid #f1f5f9;transition:background .15s}
        .ce-emp-row:hover{background:#fff5f5}
        .ce-emp-row td{border-bottom:1px solid #fff1f2;transition:background .15s}
        .ce-section{background:white;border-radius:14px;border:1px solid var(--border);overflow:hidden;box-shadow:0 1px 8px rgba(0,0,0,.06);margin-bottom:14px}
        .ce-section-head{display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid var(--border)}
        .ce-num{width:26px;height:26px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;flex-shrink:0}
        .ce-subtit{padding:7px 16px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid var(--border)}
        .ce-seg{display:inline-flex;background:#fff;border:1px solid #fecaca;border-radius:10px;padding:3px;gap:2px}
        .ce-seg button{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;padding:6px 12px;border-radius:7px;font-size:12px;font-weight:600;color:#9f1239;cursor:pointer;transition:background .15s,color .15s}
        .ce-seg button:hover{background:#fff1f2}
        .ce-seg button.on{background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;box-shadow:0 1px 4px rgba(220,38,38,.35)}
        .ce-seg button:focus-visible{outline:2px solid #2563eb;outline-offset:1px}
        .ce-compte{display:inline-flex;align-items:center;justify-content:center;min-width:44px;height:24px;padding:0 6px;background:#fff1f2;border:1px solid #fecdd3;border-radius:6px;font-size:11.5px;font-weight:800;color:#b91c1c;font-family:'JetBrains Mono',ui-monospace,monospace}
        .ce-sub-row td{background:#fffafa;border-bottom:1px dashed #fde2e2}
        .ce-sub-row:hover td{background:#fff1f2}
        .ce-lien{border:0;background:none;padding:0;font-size:11px;font-weight:700;color:#dc2626;cursor:pointer;text-transform:none}
        @media (max-width:640px){.ce-section-head{flex-wrap:wrap}.ce-seg{width:100%}.ce-seg button{flex:1;justify-content:center}}
      `}</style>

      <div style={{ maxWidth: 860 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18, flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }}>
            {isAdmin && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 11, padding: '3px 10px', background: '#dbeafe', color: '#1d4ed8', borderRadius: 20, fontWeight: 700 }}>{meta.tenant_nom}</span>
              </div>
            )}
            <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: 'var(--text)' }}>Compte d'Emploi</h2>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
              Période : <strong>{meta.mois} {meta.annee}</strong>
              {meta.directeur_nom && <>&nbsp;·&nbsp;Dir. : <strong>{meta.directeur_nom}</strong></>}
              {meta.caissier_nom && <>&nbsp;·&nbsp;Caissier : <strong>{meta.caissier_nom}</strong></>}
            </p>
          </div>
          <button
            onClick={charger}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'white', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: 'var(--text)' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
            Actualiser
          </button>
          {can('rapport.export') && (
            <button style={STYLE_BOUTON_EXPORT} onClick={() => exporterExcel(`Compte_emploi_${meta.mois}_${meta.annee}`,
              ['Section', 'Libellé', `Espèces (${devise})`, `Mobile money (${devise})`, `Montant (${devise})`],
              [
                ...ranLignes.map((j) => ['I. Soldes initiaux', j.journal_nom, '', '', num(j.ran)]),
                ...(ressources.solde_banque_initial > 0 ? [['I. Soldes initiaux', 'Banque', '', '', num(ressources.solde_banque_initial)]] : []),
                ['', 'TOTAL SOLDES INITIAUX', '', '', num(soldesInitiaux)],
                ...fondsLignes.map((j) => ['II. Ressources', j.journal_nom, '', '', num(j.fonds_recus)]),
                ...(ressources.fonds_recus_banque > 0 ? [['II. Ressources', 'Banque', '', '', num(ressources.fonds_recus_banque)]] : []),
                ['', 'TOTAL RESSOURCES', '', '', num(fondsRecus)],
                ...lignesEmploisExcel,
                ['', 'TOTAL EMPLOIS', '', '', num(emplois.total)],
                ['IV. Trésorerie finale & soldes', 'Soldes initiaux + Ressources − Emplois', '', '', num(tresFinale)],
                ...(tresorerie_finale.journaux || []).map((j) => ['IV. Trésorerie finale & soldes', `dont ${j.journal_nom}`, '', '', num(j.solde_final)]),
                ['IV. Trésorerie finale & soldes', 'dont Banque', '', '', num(tresorerie_finale.solde_banque || 0)],
                ['', 'Écart (trésorerie − soldes)', '', '', num(ecart)],
              ],
              [`Compte d'emploi — ${meta.mois} ${meta.annee}${mode === 'compte' ? ' — emplois par compte comptable' : ''}`, meta.tenant_nom || ''])}>📊 Excel</button>
          )}
          <button
            onClick={() => printCompteEmploi(data, entite, { mode, parCompte })}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', border: 'none', borderRadius: 10, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: 'white', boxShadow: '0 2px 8px rgba(37,99,235,.35)' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>
            Imprimer
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 18 }}>
          <div style={{ background: 'linear-gradient(135deg,#f0fdfa,#ccfbf1)', border: '1px solid #99f6e4', borderRadius: 14, padding: '16px 18px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .6, color: '#0d9488', marginBottom: 6 }}>I · Soldes initiaux</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#0f766e', lineHeight: 1.1 }}>{fmtM(soldesInitiaux)}</div>
            <div style={{ fontSize: 11, color: '#2dd4bf', marginTop: 4 }}>Report à nouveau</div>
          </div>
          <div style={{ background: 'linear-gradient(135deg,#f0fdf4,#dcfce7)', border: '1px solid #bbf7d0', borderRadius: 14, padding: '16px 18px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .6, color: '#16a34a', marginBottom: 6 }}>II · Ressources</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#15803d', lineHeight: 1.1 }}>{fmtM(fondsRecus)}</div>
            <div style={{ fontSize: 11, color: '#4ade80', marginTop: 4 }}>Fonds reçus sur la période</div>
          </div>
          <div style={{ background: 'linear-gradient(135deg,#fff1f2,#fee2e2)', border: '1px solid #fecaca', borderRadius: 14, padding: '16px 18px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .6, color: '#dc2626', marginBottom: 6 }}>III · Emplois</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#b91c1c', lineHeight: 1.1 }}>{fmtM(emplois.total)}</div>
            <div style={{ marginTop: 6, height: 4, background: '#fecaca', borderRadius: 2, overflow: 'hidden' }} title={`${txUtilisation} % du disponible (I + II)`}>
              <div style={{ width: `${Math.min(txUtilisation, 100)}%`, height: '100%', background: txUtilisation > 90 ? '#ef4444' : txUtilisation > 70 ? '#f59e0b' : '#f87171', borderRadius: 2 }} />
            </div>
            <div style={{ fontSize: 11, color: '#f87171', marginTop: 4 }}>{txUtilisation} % du disponible (I + II)</div>
          </div>
          <div style={{ background: solde_net >= 0 ? 'linear-gradient(135deg,#eff6ff,#dbeafe)' : 'linear-gradient(135deg,#fff1f2,#fee2e2)', border: `1px solid ${solde_net >= 0 ? '#bfdbfe' : '#fecaca'}`, borderRadius: 14, padding: '16px 18px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .6, color: solde_net >= 0 ? '#1d4ed8' : '#dc2626', marginBottom: 6 }}>IV · Trésorerie finale</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: solde_net >= 0 ? '#1e40af' : '#b91c1c', lineHeight: 1.1 }}>{fmtM(solde_net)}</div>
            <div style={{ fontSize: 11, color: solde_net >= 0 ? '#60a5fa' : '#f87171', marginTop: 4 }}>I + II − III</div>
          </div>
        </div>

        {/* ── I. SOLDES INITIAUX ─────────────────────────────────────── */}
        <div className="ce-section">
          <div className="ce-section-head" style={{ background: 'linear-gradient(135deg,#f0fdfa,#ccfbf1)' }}>
            <span className="ce-num" style={{ background: '#0d9488', color: 'white' }}>I</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0f766e', textTransform: 'uppercase', letterSpacing: .5 }}>Soldes initiaux</div>
              <div style={{ fontSize: 11, color: '#2dd4bf', marginTop: 1 }}>Report à Nouveau (RAN) en début de période</div>
            </div>
            <div style={{ marginLeft: 'auto', fontSize: 16, fontWeight: 800, color: '#0f766e' }}>{fmtM(soldesInitiaux)}</div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              {ranLignes.length === 0 && !(ressources.solde_banque_initial > 0) ? (
                <tr className="ce-res-row"><td style={{ padding: '9px 16px', color: 'var(--text-muted)', fontStyle: 'italic' }} colSpan={2}>Aucun solde initial enregistré</td></tr>
              ) : ranLignes.map((j) => (
                <ResRow key={`ran-${j.journal_id ?? j.journal_nom}`} ico={jTypeIco(j.journal_type)} label={j.journal_nom} montant={j.ran} sub={`Solde initial (RAN) · ${jTypeLabel(j.journal_type)}`} devise={devise} couleur="#0f766e" />
              ))}
              {ressources.solde_banque_initial > 0 && (
                <ResRow ico="🏦" label="Banque" montant={ressources.solde_banque_initial} sub="Solde initial (mois précédent)" devise={devise} couleur="#0f766e" />
              )}
            </tbody>
            <tfoot>
              <tr style={{ background: 'linear-gradient(135deg,#f0fdfa,#ccfbf1)' }}>
                <td style={{ padding: '12px 16px', fontWeight: 700, fontSize: 13, color: '#0f766e', borderTop: '2px solid #5eead4', letterSpacing: .3 }}>TOTAL SOLDES INITIAUX</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 800, fontSize: 16, color: '#0f766e', borderTop: '2px solid #5eead4' }}>{fmtM(soldesInitiaux)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* ── II. RESSOURCES ────────────────────────────────────────── */}
        <div className="ce-section">
          <div className="ce-section-head" style={{ background: 'linear-gradient(135deg,#f0fdf4,#dcfce7)' }}>
            <span className="ce-num" style={{ background: '#16a34a', color: 'white', fontSize: 11 }}>II</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#15803d', textTransform: 'uppercase', letterSpacing: .5 }}>Ressources</div>
              <div style={{ fontSize: 11, color: '#4ade80', marginTop: 1 }}>Fonds reçus au cours de la période</div>
            </div>
            <div style={{ marginLeft: 'auto', fontSize: 16, fontWeight: 800, color: '#15803d' }}>{fmtM(fondsRecus)}</div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              {fondsLignes.length === 0 && !(ressources.fonds_recus_banque > 0) ? (
                <tr className="ce-res-row"><td style={{ padding: '9px 16px', color: 'var(--text-muted)', fontStyle: 'italic' }} colSpan={2}>Aucun fonds reçu ce mois</td></tr>
              ) : fondsLignes.map((j) => (
                <ResRow key={`fonds-${j.journal_id ?? j.journal_nom}`} ico={jTypeIco(j.journal_type)} label={j.journal_nom} montant={j.fonds_recus} sub={`Fonds reçus · ${jTypeLabel(j.journal_type)}`} devise={devise} />
              ))}
              {ressources.fonds_recus_banque > 0 && (
                <ResRow ico="🏦" label="Banque" montant={ressources.fonds_recus_banque} sub="Fonds reçus en banque" devise={devise} />
              )}
            </tbody>
            <tfoot>
              <tr style={{ background: 'linear-gradient(135deg,#f0fdf4,#dcfce7)' }}>
                <td style={{ padding: '12px 16px', fontWeight: 700, fontSize: 13, color: '#15803d', borderTop: '2px solid #86efac', letterSpacing: .3 }}>TOTAL RESSOURCES</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 800, fontSize: 16, color: '#15803d', borderTop: '2px solid #86efac' }}>{fmtM(fondsRecus)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* ── III. EMPLOIS ──────────────────────────────────────────── */}
        <div className="ce-section">
          <div className="ce-section-head" style={{ background: 'linear-gradient(135deg,#fff1f2,#fee2e2)' }}>
            <span className="ce-num" style={{ background: '#dc2626', color: 'white', fontSize: 10 }}>III</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#b91c1c', textTransform: 'uppercase', letterSpacing: .5 }}>Emplois</div>
              <div style={{ fontSize: 11, color: '#f87171', marginTop: 1 }}>
                {mode === 'compte' ? 'Regroupés par compte comptable — cliquez un compte pour voir ses rubriques' : 'Journal de dépenses — cliquez pour voir le détail'}
              </div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <ChoixPresentation mode={mode} onChange={setMode} />
              <div style={{ fontSize: 16, fontWeight: 800, color: '#b91c1c' }}>{fmtM(emplois.total)}</div>
            </div>
          </div>
          {mode === 'compte' && sansCompte && (
            <div style={{ padding: '8px 16px', background: '#fffbeb', borderBottom: '1px solid #fde68a', fontSize: 12, color: '#92400e' }}>
              ⚠️ {sansCompte.rubriques.length} rubrique(s) sans compte comptable ({fmtM(sansCompte.total)}) : renseignez leur équivalence dans le contrôle de régularité formelle.
            </div>
          )}
          {mode === 'compte' ? (
            <EmploisParCompte groupes={parCompte} total={emplois.total} fmtM={fmtM} onDetail={setDetail} />
          ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#fff8f8' }}>
                <th style={{ padding: '8px 16px', textAlign: 'left', borderBottom: '1px solid #fecaca', fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', width: 52 }}>Code</th>
                <th style={{ padding: '8px 4px', textAlign: 'left', borderBottom: '1px solid #fecaca', fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase' }}>Rubrique</th>
                <th style={{ padding: '8px 16px', textAlign: 'right', borderBottom: '1px solid #fecaca', fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase' }}>Espèces</th>
                <th style={{ padding: '8px 16px', textAlign: 'right', borderBottom: '1px solid #fecaca', fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase' }}>MM</th>
                <th style={{ padding: '8px 16px', textAlign: 'right', borderBottom: '1px solid #fecaca', fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {emploisTriees.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: 13 }}>Aucune dépense enregistrée ce mois.</td></tr>
              ) : emploisTriees.map((e) => {
                const pct = Math.round((e.total / emplois.total) * 100);
                const barW = Math.round((e.total / maxEmploi) * 100);
                const barColor = pct > 30 ? '#ef4444' : pct > 15 ? '#f97316' : '#fb923c';
                return (
                  <tr key={e.rubrique_code} className="ce-emp-row" style={{ cursor: 'pointer' }} onClick={() => setDetail(e)}>
                    <td style={{ padding: '10px 16px', width: 52 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 24, background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 6, fontSize: 11, fontWeight: 700, color: '#dc2626' }}>{e.rubrique_code}</span>
                    </td>
                    <td style={{ padding: '10px 4px' }}>
                      <div style={{ fontWeight: 500, color: 'var(--text)', fontSize: 13 }}>
                        {e.intitule}
                        {e.code_comptable && <span title={e.compte_intitule || ''} style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, color: '#64748b', background: '#f1f5f9', borderRadius: 5, padding: '1px 6px', fontFamily: "'JetBrains Mono',ui-monospace,monospace" }}>{e.code_comptable}</span>}
                      </div>
                      <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, height: 4, background: '#f1f5f9', borderRadius: 2, maxWidth: 160 }}>
                          <div style={{ width: `${barW}%`, height: '100%', background: barColor, borderRadius: 2 }} />
                        </div>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{pct}% du total</span>
                      </div>
                    </td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', color: '#9a3412', fontSize: 12 }}>{e.esp > 0 ? fmtM(e.esp) : '—'}</td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', color: '#9a3412', fontSize: 12 }}>{e.om > 0 ? fmtM(e.om) : '—'}</td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 700, color: '#dc2626', whiteSpace: 'nowrap' }}>
                      {fmtM(e.total)}
                      <svg style={{ marginLeft: 4, opacity: .4, verticalAlign: 'middle' }} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: 'linear-gradient(135deg,#fff1f2,#fee2e2)' }}>
                <td colSpan={4} style={{ padding: '12px 16px', fontWeight: 700, fontSize: 13, color: '#b91c1c', borderTop: '2px solid #fca5a5', letterSpacing: .3 }}>TOTAL EMPLOIS</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 800, fontSize: 16, color: '#b91c1c', borderTop: '2px solid #fca5a5' }}>{fmtM(emplois.total)}</td>
              </tr>
            </tfoot>
          </table>
          )}
          {mode === 'compte' && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <tfoot>
                <tr style={{ background: 'linear-gradient(135deg,#fff1f2,#fee2e2)' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 700, fontSize: 13, color: '#b91c1c', borderTop: '2px solid #fca5a5', letterSpacing: .3 }}>TOTAL EMPLOIS · {parCompte.filter((g) => g.compte).length} compte(s)</td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 800, fontSize: 16, color: '#b91c1c', borderTop: '2px solid #fca5a5' }}>{fmtM(emplois.total)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {/* ── IV. TRÉSORERIE FINALE & SOLDES ───────────────────────── */}
        <div className="ce-section">
          <div className="ce-section-head" style={{ background: 'linear-gradient(135deg,#eff6ff,#dbeafe)' }}>
            <span className="ce-num" style={{ background: '#1d4ed8', color: 'white', fontSize: 10 }}>IV</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1e40af', textTransform: 'uppercase', letterSpacing: .5 }}>Trésorerie Finale &amp; Soldes</div>
              <div style={{ fontSize: 11, color: '#93c5fd', marginTop: 1 }}>Soldes initiaux + Ressources − Emplois, et ventilation par compte</div>
            </div>
            <div style={{ marginLeft: 'auto', fontSize: 16, fontWeight: 800, color: tresFinale >= 0 ? '#1d4ed8' : '#dc2626' }}>{fmtM(tresFinale)}</div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              {[
                ['I', 'Soldes initiaux', '+', soldesInitiaux, '#0f766e'],
                ['II', 'Ressources', '+', fondsRecus, '#15803d'],
                ['III', 'Emplois', '−', emplois.total, '#b91c1c'],
              ].map(([n, lib, signe, m, c]) => (
                <tr key={n} className="ce-res-row">
                  <td style={{ padding: '8px 16px', fontSize: 13 }}>
                    <span style={{ display: 'inline-block', width: 26, fontWeight: 700, color: c }}>{n}.</span>{lib}
                  </td>
                  <td style={{ padding: '8px 16px', textAlign: 'right', fontWeight: 600, color: c, whiteSpace: 'nowrap' }}>{signe} {fmtM(m)}</td>
                </tr>
              ))}
              <tr style={{ background: 'linear-gradient(135deg,#eff6ff,#dbeafe)' }}>
                <td style={{ padding: '13px 16px', fontWeight: 700, fontSize: 13, color: '#1e40af', borderBottom: '2px solid #bfdbfe', borderTop: '2px solid #bfdbfe', letterSpacing: .2 }}>
                  ⚖️ Trésorerie Finale &nbsp;<span style={{ fontSize: 11, fontWeight: 500, color: '#60a5fa' }}>(I + II − III)</span>
                </td>
                <td style={{ padding: '13px 16px', textAlign: 'right', fontWeight: 800, fontSize: 16, color: tresFinale >= 0 ? '#1d4ed8' : '#dc2626', borderBottom: '2px solid #bfdbfe', borderTop: '2px solid #bfdbfe' }}>{fmtM(tresFinale)}</td>
              </tr>
              {(tresorerie_finale.journaux || []).map((j) => {
                const pos = j.solde_final >= 0;
                return (
                  <tr key={`treso-${j.journal_id ?? j.journal_nom}`} className="ce-res-row">
                    <td style={{ padding: '8px 16px 8px 36px', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13 }}>{jTypeIco(j.journal_type)}</span>
                      <span>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>dont</span>
                        <strong style={{ marginLeft: 4, color: 'var(--text)' }}>{j.journal_nom}</strong>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>({jTypeLabel(j.journal_type)})</span>
                      </span>
                    </td>
                    <td style={{ padding: '8px 16px', textAlign: 'right', fontWeight: 600, fontSize: 13, color: pos ? '#1d4ed8' : '#dc2626' }}>{fmtM(j.solde_final)}</td>
                  </tr>
                );
              })}
              <tr className="ce-res-row">
                <td style={{ padding: '8px 16px 8px 36px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13 }}>🏦</span>
                  <span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>dont</span>
                    <strong style={{ marginLeft: 4, color: 'var(--text)' }}>Banque</strong>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>(Compte bancaire)</span>
                  </span>
                </td>
                <td style={{ padding: '8px 16px', textAlign: 'right', fontWeight: 600, fontSize: 13, color: (tresorerie_finale.solde_banque || 0) >= 0 ? '#1d4ed8' : '#dc2626' }}>{fmtM(tresorerie_finale.solde_banque || 0)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr style={{ background: ecartOk ? 'linear-gradient(135deg,#f0fdf4,#dcfce7)' : 'linear-gradient(135deg,#fffbeb,#fef3c7)', borderTop: `2px solid ${ecartOk ? '#86efac' : '#fcd34d'}` }}>
                <td style={{ padding: '12px 16px', fontWeight: 700, color: ecartOk ? '#15803d' : '#92400e' }}>
                  {ecartOk ? '✅' : '⚠️'} Écart &nbsp;<span style={{ fontSize: 11, fontWeight: 500 }}>(Trésorerie − Σ Soldes des comptes)</span>
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 800, fontSize: 15, color: ecartOk ? '#15803d' : '#b45309' }}>
                  {ecart >= 0 ? '+' : ''}{fmtM(ecart)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: 'white', borderRadius: 12, border: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          <span>Édité le {new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, background: '#2563eb', borderRadius: '50%', display: 'inline-block' }} />
            CaissePro v2
          </span>
        </div>
      </div>

      {detail && (
        <CEEmploiDetailModal
          code={detail.rubrique_code} intitule={detail.intitule} esp={detail.esp} om={detail.om} total={detail.total}
          onClose={() => setDetail(null)}
        />
      )}
    </>
  );
}
