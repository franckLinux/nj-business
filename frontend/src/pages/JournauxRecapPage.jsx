import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import { api } from '@/lib/api';
import { fmt } from '@/lib/format';
import { printJournauxRecap } from '@/lib/print';
import { exporterExcel, num, STYLE_BOUTON_EXPORT } from '@/lib/export';

// Reprend loadJournauxRecap() de legacy/js/app.js (l. 2085-2328) — vue
// consolidée de tous les journaux de la période. Cliquer une carte/ligne
// ouvre `/journal/:id` (JournalPage) plutôt que la vue lecture-seule dédiée
// du legacy (loadJournalView, l. 673) : la cible React est un sur-ensemble
// fonctionnel de cette vue, pas besoin de la porter séparément.
const ICONS = { caisse: '💵', banque: '🏦', om: '🟠', momo: '🟡', carte_prepayee: '💳', autre: '📒' };
const TYPE_LABEL = { caisse: 'Caisse Espèces', banque: 'Banque (journal)', om: 'Orange Money', momo: 'Mobile Money', carte_prepayee: 'Carte Prépayée', autre: 'Autre' };
const TYPE_COLOR = { caisse: '#16a34a', banque: '#0369a1', om: '#ea580c', momo: '#ca8a04', carte_prepayee: '#7c3aed', autre: '#64748b' };

const soldeColor = (n) => (n >= 0 ? '#15803d' : '#dc2626');
const soldeBg = (n) => (n >= 0 ? '#f0fdf4' : '#fef2f2');

export default function JournauxRecapPage() {
  const { mois, annee, devise, user, activeTenantId, activeTenantNom, can, entite } = useApp();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [erreur, setErreur] = useState('');

  const charger = useCallback(async () => {
    setErreur('');
    const res = await api.get(`/journal/recap?mois=${mois}&annee=${annee}`);
    if (res.error) { setErreur(res.error); return; }
    setData(res);
  }, [mois, annee]);

  useEffect(() => { setData(null); charger(); }, [charger]);

  // NB : contrairement au legacy (l. 2089), on inclut le fallback user.tenantId
  // — sans lui, tout utilisateur non-super_admin serait bloqué ici, y compris
  // ceux rattachés à un tenant. Bug legacy repéré en testant ce port, corrigé
  // plutôt que reproduit (cf. le même fallback déjà utilisé ailleurs, l. 43/1406).
  if (!(activeTenantId || user?.tenantId) && user?.role !== 'super_admin') {
    return (
      <div style={{ textAlign: 'center', padding: 60, background: 'white', border: '1px solid var(--border)', borderRadius: 12 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📒</div>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Sélectionnez un client</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Choisissez un client dans la barre du haut.</p>
      </div>
    );
  }

  if (erreur) return <div className="alert-err">{erreur}</div>;
  if (!data) return <div className="loading-msg">Chargement…</div>;

  const { journaux, banque } = data;
  const totalEntrees = journaux.reduce((s, j) => s + j.total_entrees, 0);
  const totalSorties = journaux.reduce((s, j) => s + j.total_sorties, 0);
  const totalSolde = journaux.reduce((s, j) => s + j.solde_final, 0);
  const totalRan = journaux.reduce((s, j) => s + j.ran, 0);
  const banqueVisible = banque.solde_final > 0 || banque.fonds_recus > 0;

  const goToJournal = (id) => navigate(`/journal/${id}`);

  const onImprimer = () => {
    printJournauxRecap({ journaux, banque, mois, annee, tenantNom: activeTenantNom || user?.tenantNom, entite });
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 18 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', marginBottom: 4 }}>📒 Journaux de caisse</h2>
          <div style={{ fontSize: 12, color: '#64748b' }}>{mois} {annee} · Vue d'ensemble consolidée</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {can('rapport.export') && (
            <button style={STYLE_BOUTON_EXPORT} onClick={() => exporterExcel(`Journaux_de_caisse_${mois}_${annee}`,
              ['Journal', 'Code', 'Type', `RAN (${devise})`, `Entrées (${devise})`, `Sorties (${devise})`, `Solde final (${devise})`, 'Statut'],
              [...journaux.map((j) => [j.nom, j.code, TYPE_LABEL[j.type] || j.type, num(j.ran), num(j.total_entrees), num(j.total_sorties), num(j.solde_final), j.arrete ? 'Arrêtée' : 'Ouverte']),
                ...(banqueVisible ? [['Banque (saisie manuelle)', '', 'Compte bancaire', num(banque.solde_initial), num(banque.fonds_recus), '', num(banque.solde_final), '']] : []),
                ['TOTAL GÉNÉRAL', '', '', num(totalRan), num(totalEntrees), num(totalSorties), num(totalSolde + banque.solde_final), '']],
              [`Journaux de caisse — ${mois} ${annee}`, activeTenantNom || user?.tenantNom || ''])}>📊 Excel</button>
          )}
          <button
            onClick={onImprimer}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'white', border: '1px solid var(--border)', borderRadius: 9, fontSize: 12, fontWeight: 600, color: '#475569', cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}
          >
            🖨️ Imprimer le récap
          </button>
          <button
            onClick={charger}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'white', border: '1px solid var(--border)', borderRadius: 9, fontSize: 12, fontWeight: 600, color: '#475569', cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}
          >
            ↺ Actualiser
          </button>
        </div>
      </div>

      {/* ── KPI globaux ─────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 12, marginBottom: 20 }}>
        <div style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)', color: 'white', borderRadius: 14, padding: '18px 20px', boxShadow: '0 2px 12px rgba(22,163,74,.25)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, opacity: .85, textTransform: 'uppercase', letterSpacing: .6, marginBottom: 8 }}>Total Entrées</div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{fmt(totalEntrees, devise)}</div>
          <div style={{ fontSize: 10, opacity: .7, marginTop: 4 }}>{journaux.length} journal{journaux.length > 1 ? 'x' : ''}</div>
        </div>
        <div style={{ background: 'linear-gradient(135deg,#dc2626,#b91c1c)', color: 'white', borderRadius: 14, padding: '18px 20px', boxShadow: '0 2px 12px rgba(220,38,38,.25)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, opacity: .85, textTransform: 'uppercase', letterSpacing: .6, marginBottom: 8 }}>Total Sorties</div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{fmt(totalSorties, devise)}</div>
        </div>
        <div style={{ background: 'linear-gradient(135deg,#0369a1,#075985)', color: 'white', borderRadius: 14, padding: '18px 20px', boxShadow: '0 2px 12px rgba(3,105,161,.25)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, opacity: .85, textTransform: 'uppercase', letterSpacing: .6, marginBottom: 8 }}>Solde Global Caisses</div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{fmt(totalSolde, devise)}</div>
          <div style={{ fontSize: 10, opacity: .7, marginTop: 4 }}>RAN : {fmt(totalRan, devise)}</div>
        </div>
        {banqueVisible && (
          <div style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', color: 'white', borderRadius: 14, padding: '18px 20px', boxShadow: '0 2px 12px rgba(124,58,237,.25)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, opacity: .85, textTransform: 'uppercase', letterSpacing: .6, marginBottom: 8 }}>🏦 Banque</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{fmt(banque.solde_final, devise)}</div>
            <div style={{ fontSize: 10, opacity: .7, marginTop: 4 }}>Reçu ce mois : {fmt(banque.fonds_recus, devise)}</div>
          </div>
        )}
      </div>

      {/* ── Cartes par journal ──────────────────────────────────────── */}
      {journaux.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 50, background: 'white', borderRadius: 14, border: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
          Aucun journal de caisse configuré pour cette période.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 14, marginBottom: 20 }}>
          {journaux.map((j) => {
            const color = TYPE_COLOR[j.type] || '#64748b';
            return (
              <div
                key={j.id}
                onClick={() => goToJournal(j.id)}
                style={{ background: 'white', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden', boxShadow: '0 1px 6px rgba(0,0,0,.05)', cursor: 'pointer' }}
              >
                <div style={{ height: 4, background: color }} />
                <div style={{ padding: '16px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 26, lineHeight: 1 }}>{ICONS[j.type] || '📒'}</span>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{j.nom}</div>
                        <div style={{ fontSize: 11, color, fontWeight: 600 }}>{TYPE_LABEL[j.type] || j.type}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <span style={{ background: '#f1f5f9', color: '#64748b', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6 }}>{j.code}</span>
                      {j.arrete && <span style={{ background: '#dcfce7', color: '#15803d', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6 }}>🔒 Arrêtée</span>}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                    <div style={{ background: '#f0fdf4', borderRadius: 8, padding: '8px 10px' }}>
                      <div style={{ fontSize: 10, color: '#16a34a', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>Entrées</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: '#15803d' }}>{fmt(j.total_entrees, devise)}</div>
                    </div>
                    <div style={{ background: '#fef2f2', borderRadius: 8, padding: '8px 10px' }}>
                      <div style={{ fontSize: 10, color: '#dc2626', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>Sorties</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: '#b91c1c' }}>{fmt(j.total_sorties, devise)}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: soldeBg(j.solde_final), borderRadius: 8, padding: '8px 12px' }}>
                    <div style={{ fontSize: 11, color: '#64748b' }}>RAN : <strong>{fmt(j.ran, devise)}</strong></div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 10, color: soldeColor(j.solde_final), fontWeight: 700, textTransform: 'uppercase' }}>Solde</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: soldeColor(j.solde_final) }}>{fmt(j.solde_final, devise)}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', marginTop: 8, fontSize: 11, color: '#94a3b8' }}>Voir les mouvements →</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {banqueVisible && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
          🏦 <strong>Banque (saisie manuelle)</strong> : solde saisi dans la Demande de fonds. Cette ligne n'apparaît que si aucun journal de type
          banque n'existe ; dès qu'un journal banque est créé, c'est lui qui porte le solde bancaire.
        </div>
      )}
      {/* ── Tableau récapitulatif ───────────────────────────────────── */}
      <div style={{ background: 'white', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden', boxShadow: '0 1px 8px rgba(0,0,0,.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--border)', background: 'linear-gradient(90deg,#f8fafc,#fff)' }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#0369a1,#075985)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 15 }}>📊</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Tableau récapitulatif — {mois} {annee}</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>{journaux.length} journal{journaux.length > 1 ? 'x' : ''} de caisse</div>
          </div>
        </div>
        <div className="table-wrap" style={{ margin: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Journal</th>
                <th>Type</th>
                <th style={{ textAlign: 'right' }}>RAN</th>
                <th style={{ textAlign: 'right' }}>Entrées</th>
                <th style={{ textAlign: 'right' }}>Sorties</th>
                <th style={{ textAlign: 'right' }}>Solde final</th>
                <th style={{ textAlign: 'center' }}>Statut</th>
              </tr>
            </thead>
            <tbody>
              {journaux.map((j) => (
                <tr key={j.id} onClick={() => goToJournal(j.id)} style={{ cursor: 'pointer' }}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 16 }}>{ICONS[j.type] || '📒'}</span>
                      <span style={{ fontWeight: 600 }}>{j.nom}</span>
                      <span style={{ background: '#f1f5f9', color: '#64748b', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 5 }}>{j.code}</span>
                    </div>
                  </td>
                  <td><span style={{ color: TYPE_COLOR[j.type] || '#64748b', fontWeight: 600, fontSize: 12 }}>{TYPE_LABEL[j.type] || j.type}</span></td>
                  <td style={{ textAlign: 'right', color: '#92400e', fontWeight: 600 }}>{fmt(j.ran, devise)}</td>
                  <td style={{ textAlign: 'right', color: '#16a34a', fontWeight: 700 }}>{fmt(j.total_entrees, devise)}</td>
                  <td style={{ textAlign: 'right', color: '#dc2626', fontWeight: 700 }}>{fmt(j.total_sorties, devise)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 800, color: soldeColor(j.solde_final) }}>{fmt(j.solde_final, devise)}</td>
                  <td style={{ textAlign: 'center' }}>
                    {j.arrete
                      ? <span style={{ background: '#dcfce7', color: '#15803d', fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 12 }}>🔒 Arrêtée</span>
                      : <span style={{ background: '#fef9c3', color: '#92400e', fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 12 }}>🔓 Ouverte</span>}
                  </td>
                </tr>
              ))}
              {banqueVisible && (
                <tr style={{ background: '#faf5ff' }}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 16 }}>🏦</span>
                      <span style={{ fontWeight: 600, color: '#7c3aed' }}>Banque (saisie manuelle)</span>
                    </div>
                  </td>
                  <td><span style={{ color: '#7c3aed', fontWeight: 600, fontSize: 12 }}>Compte bancaire</span></td>
                  <td style={{ textAlign: 'right', color: '#92400e', fontWeight: 600 }}>{fmt(banque.solde_initial, devise)}</td>
                  <td style={{ textAlign: 'right', color: '#16a34a', fontWeight: 700 }}>{fmt(banque.fonds_recus, devise)}</td>
                  <td style={{ textAlign: 'right', color: '#dc2626', fontWeight: 700 }}>—</td>
                  <td style={{ textAlign: 'right', fontWeight: 800, color: '#7c3aed' }}>{fmt(banque.solde_final, devise)}</td>
                  <td />
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr style={{ background: 'linear-gradient(90deg,#0f172a,#1e293b)', color: 'white', fontWeight: 800 }}>
                <td colSpan={2} style={{ color: 'white' }}>TOTAL GÉNÉRAL</td>
                <td style={{ textAlign: 'right', color: '#fde68a' }}>{fmt(totalRan, devise)}</td>
                <td style={{ textAlign: 'right', color: '#86efac' }}>{fmt(totalEntrees, devise)}</td>
                <td style={{ textAlign: 'right', color: '#fca5a5' }}>{fmt(totalSorties, devise)}</td>
                <td style={{ textAlign: 'right', color: '#93c5fd', fontSize: 15 }}>{fmt(totalSolde + banque.solde_final, devise)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </>
  );
}
