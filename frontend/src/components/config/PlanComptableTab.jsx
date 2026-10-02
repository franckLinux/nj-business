import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';

// Reprend loadTabPlan()/renderTabPlan()/openModalAddCompte()/saveNewCompte()/
// deleteCompteCustom() de legacy/js/app.js (l. 3962-4332).
// Simplification assumée : le cache des ~2000 comptes (`_planState.all` en
// legacy, au niveau module donc partagé entre montages) est repris ici au
// niveau module pour éviter de re-télécharger la liste à chaque changement
// d'onglet — en revanche les filtres (classe/recherche) redémarrent à vide à
// chaque montage plutôt que de rester globalement partagés comme en legacy ;
// différence mineure, sans impact fonctionnel.
let _planCache = null; // { all, classes, stats }

const PLAN_CLASSES_META = {
  1: { label: 'Ressources durables', color: '#dbeafe', text: '#1d4ed8', icon: '🏦' },
  2: { label: 'Actif immobilisé', color: '#dcfce7', text: '#15803d', icon: '🏗️' },
  3: { label: 'Stocks', color: '#fef9c3', text: '#a16207', icon: '📦' },
  4: { label: 'Tiers', color: '#fce7f3', text: '#be185d', icon: '🤝' },
  5: { label: 'Trésorerie', color: '#f0fdf4', text: '#166534', icon: '💰' },
  6: { label: 'Charges', color: '#ffedd5', text: '#c2410c', icon: '📉' },
  7: { label: 'Produits', color: '#ede9fe', text: '#7c3aed', icon: '📈' },
  8: { label: 'Comptes spéciaux', color: '#f1f5f9', text: '#475569', icon: '📋' },
  9: { label: 'Comptes analytiques', color: '#fdf4ff', text: '#86198f', icon: '🔬' },
};
const PLAN_NATURES = [
  { val: '', label: '— Non défini —' },
  { val: 'actif', label: 'Actif' },
  { val: 'passif', label: 'Passif' },
  { val: 'charge', label: 'Charge' },
  { val: 'produit', label: 'Produit' },
  { val: 'tresorerie', label: 'Trésorerie' },
  { val: 'hors_activites_ordinaires', label: 'Hors activités ordinaires (HAO)' },
];
const MAX_DISPLAY = 500;

function AddCompteModal({ onClose, onSaved }) {
  const [compte, setCompte] = useState('');
  const [intitule, setIntitule] = useState('');
  const [nature, setNature] = useState('');
  const [classe, setClasse] = useState('');
  const [saving, setSaving] = useState(false);

  const firstDigit = compte.trim().match(/^(\d)/);
  const meta = firstDigit ? PLAN_CLASSES_META[firstDigit[1]] : null;

  const onSave = async () => {
    if (!compte.trim()) { window.alert('Le numéro de compte est obligatoire.'); return; }
    if (!intitule.trim()) { window.alert("L'intitulé du compte est obligatoire."); return; }
    const classeNum = classe ? parseInt(classe, 10) : (firstDigit ? parseInt(firstDigit[1], 10) : null);
    setSaving(true);
    const res = await api.post('/plan-comptable', { compte: compte.trim(), intitule: intitule.trim(), classe: classeNum, nature });
    setSaving(false);
    if (res.error) { window.alert(res.error); return; }
    onSaved(compte.trim(), intitule.trim());
  };

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 520 }}>
        <div className="modal-head" style={{ background: 'linear-gradient(135deg,#6d28d9,#4f46e5)' }}>
          <h3 style={{ color: 'white' }}>✦ Nouveau compte additif</h3>
          <button className="modal-close" style={{ color: 'white', opacity: .8 }} onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 10, padding: '12px 14px', marginBottom: 20, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 18, flexShrink: 0 }}>💡</span>
            <p style={{ fontSize: 12, color: '#5b21b6', margin: 0, lineHeight: 1.6 }}>
              Un <strong>compte additif</strong> étend le référentiel SYSCOHADA avec vos comptes spécifiques.
              Il peut être supprimé à tout moment. Les comptes SYSCOHADA sont protégés.
            </p>
          </div>

          <div className="form-section">
            <label>Numéro de compte <span className="req">*</span></label>
            <input
              type="text" value={compte} onChange={(e) => setCompte(e.target.value)} placeholder="Ex: 6011, 411200, 5312…" maxLength={20}
              style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 700, letterSpacing: 1 }}
            />
            <span className="field-hint">La classe est automatiquement déduite du premier chiffre.</span>
          </div>

          {meta && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, background: meta.color, color: meta.text }}>
                <span style={{ fontSize: 20 }}>{meta.icon}</span>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .4, opacity: .7 }}>Classe {firstDigit[1]}</div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{meta.label}</div>
                </div>
              </div>
            </div>
          )}

          <div className="form-section">
            <label>Intitulé du compte <span className="req">*</span></label>
            <input type="text" value={intitule} onChange={(e) => setIntitule(e.target.value)} placeholder="Ex: Achats de carburant, Loyer bureau central…" maxLength={300} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className="form-section">
              <label>Nature comptable</label>
              <select value={nature} onChange={(e) => setNature(e.target.value)}>
                {PLAN_NATURES.map((n) => <option key={n.val} value={n.val}>{n.label}</option>)}
              </select>
            </div>
            <div className="form-section">
              <label>Classe (si non déduite)</label>
              <select value={classe} onChange={(e) => setClasse(e.target.value)}>
                <option value="">— Auto —</option>
                {Object.entries(PLAN_CLASSES_META).map(([k, v]) => <option key={k} value={k}>{k} — {v.label}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="modal-foot" style={{ gap: 10 }}>
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button
            onClick={onSave} disabled={saving}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 22px', background: 'linear-gradient(135deg,#6d28d9,#4f46e5)', color: 'white', border: 'none', borderRadius: 9, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}
          >
            + Ajouter au plan
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PlanComptableTab() {
  const { can } = useApp();
  const toast = useToast();
  const [data, setData] = useState(_planCache);
  const [erreur, setErreur] = useState('');
  const [currentClasse, setCurrentClasse] = useState(null);
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState(null);
  const searchTimer = useRef(null);

  const canEdit = can('plan_comptable.edit');
  // Désactiver un compte additif l'enlève pour TOUS les clients : droit distinct.
  const canDelete = can('plan_comptable.delete');

  const charger = useCallback(async (force) => {
    if (_planCache && !force) { setData(_planCache); return; }
    const [listRes, classesRes, statsRes] = await Promise.all([
      api.get('/plan-comptable/list?limit=2000'),
      api.get('/plan-comptable/classes'),
      api.get('/plan-comptable/stats'),
    ]);
    if (listRes?.error && (!listRes.comptes || listRes.comptes.length === 0)) { setErreur('__EMPTY__'); return; }
    _planCache = {
      all: listRes?.comptes || [],
      classes: Array.isArray(classesRes) ? classesRes : [],
      stats: statsRes || { par_classe: [], total: 0 },
    };
    setData(_planCache);
  }, []);

  useEffect(() => { charger(false); }, [charger]);

  const onQueryInput = (v) => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setQuery(v), 120);
  };

  const onDeleteCustom = async (compte, intitule) => {
    if (!window.confirm(`Désactiver le compte additif "${compte} — ${intitule}" ?\n\nIl n'apparaîtra plus dans le plan comptable.`)) return;
    const res = await api.delete(`/plan-comptable/${encodeURIComponent(compte)}`);
    if (res.error) { toast(res.error, 'error'); return; }
    toast(`Compte ${compte} retiré du plan.`, 'success');
    charger(true);
  };

  if (erreur === '__EMPTY__') {
    return (
      <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 12, padding: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📚</div>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Plan comptable non chargé</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          La table <code>plan_comptable_syscohada</code> est vide ou inexistante en base.<br />
          Contactez l'administrateur pour charger le référentiel SYSCOHADA révisé.
        </p>
      </div>
    );
  }
  if (!data) return <div className="loading-msg">Chargement du plan comptable SYSCOHADA…</div>;

  const { all, classes, stats } = data;
  const nbByClasse = Object.fromEntries((stats?.par_classe || []).map((s) => [s.classe, s.nb]));

  let filtered = all;
  if (currentClasse !== null) filtered = filtered.filter((c) => c.classe === currentClasse);
  if (query) {
    const q = query.toLowerCase();
    filtered = filtered.filter((c) => c.compte.toLowerCase().includes(q) || (c.intitule || '').toLowerCase().includes(q));
  }
  const displayed = filtered.slice(0, MAX_DISPLAY);
  const truncated = filtered.length > MAX_DISPLAY;
  const customCount = all.filter((c) => c.source === 'custom').length;

  return (
    <div style={{ maxWidth: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px 0' }}>Plan comptable SYSCOHADA révisé</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{stats?.total || all.length} comptes · Référentiel OHADA</span>
            {customCount > 0 && <span style={{ fontSize: 11, background: '#ede9fe', color: '#6d28d9', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>{customCount} compte{customCount > 1 ? 's' : ''} additif{customCount > 1 ? 's' : ''}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="search" placeholder="🔍 Rechercher compte ou intitulé…" defaultValue={query}
            onChange={(e) => onQueryInput(e.target.value)}
            style={{ padding: '9px 12px', border: '1.5px solid var(--border)', borderRadius: 7, fontSize: 13, minWidth: 240 }}
          />
          {(currentClasse !== null || query) && (
            <button className="btn-ghost" style={{ padding: '9px 14px', fontSize: 12 }} onClick={() => { setCurrentClasse(null); setQuery(''); }}>✕ Effacer</button>
          )}
          {canEdit && (
            <button
              onClick={() => setModal('add')}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', background: 'linear-gradient(135deg,#6d28d9,#4f46e5)', color: 'white', border: 'none', borderRadius: 9, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
            >
              + Compte additif
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', overflowX: 'auto', paddingBottom: 4 }}>
        <button
          onClick={() => setCurrentClasse(null)}
          style={{
            background: currentClasse === null ? 'var(--accent-purple,#7c3aed)' : 'white', color: currentClasse === null ? 'white' : 'var(--text)',
            border: `1.5px solid ${currentClasse === null ? 'var(--accent-purple,#7c3aed)' : 'var(--border)'}`, padding: '10px 14px', borderRadius: 8,
            cursor: 'pointer', fontSize: 12, fontWeight: 600, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, minWidth: 140, textAlign: 'left',
          }}
        >
          <span>Toutes</span>
          <span style={{ fontSize: 10, fontWeight: 500, opacity: .8 }}>Classes 1 à 7</span>
          <span style={{ fontSize: 10, fontWeight: 700, marginTop: 2 }}>{stats?.total || all.length} comptes</span>
        </button>
        {classes.map((c) => (
          <button
            key={c.id} onClick={() => setCurrentClasse(c.id)}
            style={{
              background: currentClasse === c.id ? 'var(--accent-purple,#7c3aed)' : 'white', color: currentClasse === c.id ? 'white' : 'var(--text)',
              border: `1.5px solid ${currentClasse === c.id ? 'var(--accent-purple,#7c3aed)' : 'var(--border)'}`, padding: '10px 14px', borderRadius: 8,
              cursor: 'pointer', fontSize: 12, fontWeight: 600, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, minWidth: 140, textAlign: 'left',
            }}
          >
            <span>Classe {c.id}</span>
            <span style={{ fontSize: 10, fontWeight: 500, opacity: .8 }}>{c.label.replace(/^Classe \d+ — /, '')}</span>
            <span style={{ fontSize: 10, fontWeight: 700, marginTop: 2 }}>{nbByClasse[c.id] || 0} comptes</span>
          </button>
        ))}
      </div>

      <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', background: '#f8fafc', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{filtered.length} compte(s){currentClasse !== null ? ` · Classe ${currentClasse}` : ''}{query ? ` · « ${query} »` : ''}</span>
          {truncated && <span style={{ color: '#d97706', fontWeight: 600 }}>⚠️ Affichage limité à {MAX_DISPLAY} — affinez votre recherche</span>}
        </div>
        <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, background: 'white', zIndex: 1 }}>
              <tr style={{ borderBottom: '1.5px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '10px 16px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .4, color: 'var(--text-muted)', width: 130 }}>Compte</th>
                <th style={{ textAlign: 'left', padding: '10px 16px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .4, color: 'var(--text-muted)' }}>Intitulé</th>
                <th style={{ textAlign: 'center', padding: '10px 16px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .4, color: 'var(--text-muted)', width: 80 }}>Classe</th>
                <th style={{ textAlign: 'left', padding: '10px 16px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .4, color: 'var(--text-muted)', width: 110 }}>Nature</th>
                <th style={{ textAlign: 'center', padding: '10px 16px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .4, color: 'var(--text-muted)', width: 110 }}>Source</th>
                {canDelete && <th style={{ width: 60 }} />}
              </tr>
            </thead>
            <tbody>
              {displayed.length === 0 ? (
                <tr><td colSpan={canDelete ? 6 : 5} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 13 }}>Aucun compte ne correspond aux critères.</td></tr>
              ) : displayed.map((c) => {
                const isCustom = c.source === 'custom';
                return (
                  <tr key={c.compte} style={{ borderBottom: '1px solid #f1f5f9', background: isCustom ? '#faf5ff' : undefined }}>
                    <td style={{ padding: '10px 16px' }}>
                      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, fontSize: 13, color: isCustom ? '#6d28d9' : 'var(--text)' }}>{c.compte}</span>
                    </td>
                    <td style={{ padding: '10px 16px', fontSize: 13 }}>{c.intitule || '—'}</td>
                    <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                      <span style={{ background: '#f1f5f9', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{c.classe ?? '—'}</span>
                    </td>
                    <td style={{ padding: '10px 16px', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: .3 }}>{c.nature || '—'}</td>
                    <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                      {isCustom
                        ? <span style={{ background: '#ede9fe', color: '#6d28d9', padding: '2px 9px', borderRadius: 10, fontSize: 10, fontWeight: 700, letterSpacing: .3 }}>✦ ADDITIF</span>
                        : <span style={{ background: '#f1f5f9', color: '#94a3b8', padding: '2px 9px', borderRadius: 10, fontSize: 10, fontWeight: 600 }}>SYSCOHADA</span>}
                    </td>
                    {canDelete && (
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                        {isCustom && (
                          <button
                            onClick={() => onDeleteCustom(c.compte, c.intitule || '')} title="Supprimer ce compte additif"
                            style={{ background: 'none', border: '1px solid #fca5a5', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', color: '#dc2626', fontSize: 12 }}
                          >✕</button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {modal === 'add' && (
        <AddCompteModal
          onClose={() => setModal(null)}
          onSaved={(compte, intitule) => { setModal(null); toast(`Compte ${compte} — ${intitule} ajouté au plan.`, 'success'); charger(true); }}
        />
      )}
    </div>
  );
}
