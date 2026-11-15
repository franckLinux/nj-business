import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import BasculePlanModal, { PastilleReferentiel } from '@/components/config/BasculePlanModal';

// Reprend loadTabPlan()/renderTabPlan()/openModalAddCompte()/saveNewCompte()/
// deleteCompteCustom() de legacy/js/app.js (l. 3962-4332).
// Simplification assumée : le cache des ~2000 comptes (`_planState.all` en
// legacy, au niveau module donc partagé entre montages) est repris ici au
// niveau module pour éviter de re-télécharger la liste à chaque changement
// d'onglet — en revanche les filtres (classe/recherche) redémarrent à vide à
// chaque montage plutôt que de rester globalement partagés comme en legacy ;
// différence mineure, sans impact fonctionnel.
// Chaque client a désormais SON plan : le cache est attaché au client consulté
// (sinon, en changeant de client, on afficherait le plan du précédent).
let _planCache = null; // { cle, all, classes, stats }

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
              Un <strong>compte additif</strong> étend le référentiel de votre plan (SYSCOHADA ou SYCEBNL) avec vos comptes spécifiques.
              Il peut être désactivé à tout moment. Les comptes du référentiel sont protégés.
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

const STATUTS_META = {
  actif:   { label: 'Actif',   bg: '#dcfce7', fg: '#15803d' },
  inactif: { label: 'Inactif', bg: '#fef3c7', fg: '#b45309' },
  archive: { label: 'Archivé', bg: '#e2e8f0', fg: '#475569' },
};
const FILTRES_STATUT = [
  { val: 'actif', label: 'Actifs' },
  { val: 'inactif', label: 'Inactifs' },
  { val: 'archive', label: 'Archivés' },
  { val: 'utilise', label: 'Utilisés' },
  { val: 'tous', label: 'Tous' },
];
const ACTIONS_LABELS = {
  INIT_PLAN_COMPTABLE: 'Initialisation du plan',
  AJOUT_COMPTE: 'Ajout',
  MODIF_COMPTE: 'Modification',
  ACTIVATION_COMPTE: 'Réactivation',
  DESACTIVATION_COMPTE: 'Désactivation',
  ARCHIVAGE_COMPTE: 'Archivage',
};

// Modification d'un compte du plan du client (réforme du plan, étape 5).
// Le numéro n'est modifiable que pour un compte ajouté par le client et non
// utilisé : le serveur (et la base) le vérifient de toute façon.
function EditCompteModal({ compte: c, onClose, onSaved }) {
  const [intitule, setIntitule] = useState(c.intitule || '');
  const [description, setDescription] = useState(c.description || '');
  const [numero, setNumero] = useState(c.compte);
  const [saving, setSaving] = useState(false);
  const [erreur, setErreur] = useState('');
  const numeroModifiable = c.origine === 'client' && !c.utilise;

  const onSave = async () => {
    if (!intitule.trim()) { setErreur("L'intitulé est obligatoire."); return; }
    setSaving(true);
    const body = { intitule: intitule.trim(), description: description.trim() };
    if (numeroModifiable) body.compte = numero.trim();
    const res = await api.put(`/plan-comptable/comptes/${c.id}`, body);
    setSaving(false);
    if (res.error) { setErreur(res.error); return; }
    onSaved();
  };

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 520 }}>
        <div className="modal-head">
          <h3>✏️ Modifier le compte {c.compte}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-section">
            <label>Numéro de compte</label>
            <input
              type="text" value={numero} onChange={(e) => setNumero(e.target.value)} disabled={!numeroModifiable} maxLength={30}
              style={{ fontFamily: 'monospace', fontWeight: 700, background: numeroModifiable ? undefined : '#f8fafc' }}
            />
            <span className="field-hint">
              {c.origine === 'modele'
                ? 'Compte du référentiel : son numéro est verrouillé.'
                : c.utilise ? 'Compte utilisé par une rubrique : son numéro est verrouillé.' : 'Modifiable tant que le compte n\'est utilisé par aucune rubrique.'}
            </span>
          </div>
          <div className="form-section">
            <label>Intitulé <span className="req">*</span></label>
            <input type="text" value={intitule} onChange={(e) => setIntitule(e.target.value)} maxLength={300} />
          </div>
          <div className="form-section">
            <label>Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={1000} style={{ width: '100%', resize: 'vertical' }} />
          </div>
          {c.utilise && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Utilisé par : {c.rubriques.map((r) => `${r.code} — ${r.intitule}`).join(' · ')}
            </div>
          )}
          {erreur && <div className="alert-err" style={{ marginTop: 10 }}>{erreur}</div>}
        </div>
        <div className="modal-foot" style={{ gap: 10 }}>
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-add" onClick={onSave} disabled={saving}>Enregistrer</button>
        </div>
      </div>
    </div>
  );
}

function HistoriqueModal({ compte: c, onClose }) {
  const [lignes, setLignes] = useState(null);
  const [erreur, setErreur] = useState('');
  useEffect(() => {
    let annule = false;
    api.get(`/plan-comptable/comptes/${c.id}/historique`).then((res) => {
      if (annule) return;
      if (res.error) setErreur(res.error); else setLignes(Array.isArray(res) ? res : []);
    });
    return () => { annule = true; };
  }, [c.id]);
  const NOMS = { compte: 'numéro', intitule: 'intitulé', description: 'description', statut: 'statut', classe: 'classe' };
  const resume = (v) => (v ? Object.entries(v).filter(([k]) => NOMS[k]).map(([k, x]) => `${NOMS[k]} : ${x === '' || x == null ? '—' : x}`).join(' · ') : '');

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 640 }}>
        <div className="modal-head">
          <h3>🕘 Historique du compte {c.compte}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {erreur && <div className="alert-err">{erreur}</div>}
          {!lignes && !erreur && <div className="loading-msg">Chargement…</div>}
          {lignes && lignes.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Aucune modification depuis la création du plan.</p>
          )}
          {lignes && lignes.map((h, i) => (
            <div key={i} style={{ borderBottom: '1px solid #f1f5f9', padding: '10px 0' }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>
                {ACTIONS_LABELS[h.action] || h.action}
                <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8, fontSize: 12 }}>
                  {new Date(h.created_at).toLocaleString('fr-FR')}{h.username ? ` · ${h.username}` : ''}
                </span>
              </div>
              {h.ancienne_valeur && <div style={{ fontSize: 12, color: '#b91c1c' }}>Avant : {resume(h.ancienne_valeur)}</div>}
              {h.nouvelle_valeur && <div style={{ fontSize: 12, color: '#15803d' }}>Après : {resume(h.nouvelle_valeur)}</div>}
            </div>
          ))}
        </div>
        <div className="modal-foot"><button className="btn-secondary" onClick={onClose}>Fermer</button></div>
      </div>
    </div>
  );
}

export default function PlanComptableTab() {
  const { can, activeTenantId, user } = useApp();
  const cleClient = activeTenantId || user?.tenantId || 'global';
  const toast = useToast();
  const [data, setData] = useState(_planCache?.cle === cleClient ? _planCache : null);
  const [erreur, setErreur] = useState('');
  const [currentClasse, setCurrentClasse] = useState(null);
  const [query, setQuery] = useState('');
  const [statutFiltre, setStatutFiltre] = useState('actif');
  const [modal, setModal] = useState(null); // 'add' | { edit: compte } | { histo: compte }
  const searchTimer = useRef(null);
  // 060 : référentiel du plan (SYSCOHADA révisé / SYCEBNL) et alignement sur la forme juridique.
  const [ref, setRef] = useState(null);
  const [bascule, setBascule] = useState(null);
  const [basculeEnCours, setBasculeEnCours] = useState(false);
  useEffect(() => {
    let annule = false;
    api.get('/config/plan-referentiel').then((r) => { if (!annule && !r.error) setRef(r); });
    return () => { annule = true; };
  }, [cleClient]);
  const estSycebnl = ref?.actuel === 'SYCEBNL';

  const canEdit = can('plan_comptable.edit');
  // Désactiver un compte ajouté : droit distinct de l'ajout.
  const canDelete = can('plan_comptable.delete');

  const charger = useCallback(async (force) => {
    if (_planCache && _planCache.cle === cleClient && !force) { setData(_planCache); return; }
    // Plan propre au client (tous statuts, avec l'usage par les rubriques) ;
    // à défaut (client sans plan propre, ou aucun client), ancienne liste.
    const [clientRes, classesRes, statsRes] = await Promise.all([
      api.get('/plan-comptable/comptes'),
      api.get('/plan-comptable/classes'),
      api.get('/plan-comptable/stats'),
    ]);
    const modeClient = Boolean(clientRes?.plan_client && Array.isArray(clientRes.comptes));
    const listRes = modeClient ? clientRes : await api.get('/plan-comptable/list?limit=2000');
    if (listRes?.error && (!listRes.comptes || listRes.comptes.length === 0)) { setErreur('__EMPTY__'); return; }
    _planCache = {
      cle: cleClient,
      modeClient,
      all: listRes?.comptes || [],
      classes: Array.isArray(classesRes) ? classesRes : [],
      stats: statsRes || { par_classe: [], total: 0 },
    };
    setData(_planCache);
  }, [cleClient]);

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

  const changerStatut = async (c, statut) => {
    const verbe = { actif: 'Réactiver', inactif: 'Désactiver', archive: 'Archiver' }[statut];
    const usage = c.utilise ? `\n\nAttention : ce compte est utilisé par ${c.rubriques.length} rubrique(s) (${c.rubriques.map((r) => r.code).join(', ')}).` : '';
    const effet = statut === 'actif' ? '' : '\nIl ne sera plus proposé dans les listes, mais rien n\'est supprimé.';
    if (!window.confirm(`${verbe} le compte ${c.compte} — ${c.intitule} ?${effet}${usage}`)) return;
    const res = await api.patch(`/plan-comptable/comptes/${c.id}/statut`, { statut });
    if (res.error) { toast(res.error, 'error'); return; }
    toast(`Compte ${c.compte} : ${STATUTS_META[statut].label.toLowerCase()}.`, 'success');
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
  if (!data) return <div className="loading-msg">Chargement du plan comptable…</div>;

  const { all: tous, classes, stats, modeClient } = data;
  // Plan du client : filtre par statut (actifs par défaut) et compteurs
  // recalculés sur ce filtre ; ancienne liste : actifs uniquement, comme avant.
  const all = !modeClient ? tous
    : statutFiltre === 'tous' ? tous
      : statutFiltre === 'utilise' ? tous.filter((c) => c.utilise)
        : tous.filter((c) => c.statut === statutFiltre);
  const nbByClasse = modeClient
    ? all.reduce((acc, c) => { acc[c.classe] = (acc[c.classe] || 0) + 1; return acc; }, {})
    : Object.fromEntries((stats?.par_classe || []).map((s) => [s.classe, s.nb]));
  const totalAffiche = modeClient ? all.length : (stats?.total || all.length);
  const avecActions = modeClient ? (canEdit || canDelete) : canDelete;

  let filtered = all;
  if (currentClasse !== null) filtered = filtered.filter((c) => c.classe === currentClasse);
  if (query) {
    const q = query.toLowerCase();
    filtered = filtered.filter((c) => c.compte.toLowerCase().includes(q) || (c.intitule || '').toLowerCase().includes(q));
  }
  const displayed = filtered.slice(0, MAX_DISPLAY);
  const truncated = filtered.length > MAX_DISPLAY;
  const customCount = all.filter((c) => c.source === 'custom').length;
  // SYCEBNL : classes 8 (autres charges et produits) et 9 (contributions
  // volontaires en nature) font partie des états ; on les rend filtrables.
  const classesAffichees = estSycebnl
    ? [...classes, ...[{ id: 8, label: 'Classe 8 — Autres charges et autres produits' }, { id: 9, label: 'Classe 9 — Contributions volontaires en nature' }]
      .filter((x) => !classes.some((c) => c.id === x.id))]
    : classes;
  const confirmerBascule = async () => {
    setBasculeEnCours(true);
    const r = await api.post('/config/plan-referentiel/bascule', { confirmer: true });
    setBasculeEnCours(false);
    if (r.error) { toast(r.error, 'error', 8000); return; }
    setBascule(null);
    toast(r.message, 'success', 7000);
    const e = await api.get('/config/plan-referentiel');
    if (!e.error) setRef(e);
    charger(true);
  };
  const ouvrirAlignement = () => setBascule({ de: ref.actuel, vers: ref.cible, versInfo: ref.cible_info, apercu: ref.apercu, contexte: 'alignement' });

  return (
    <div style={{ maxWidth: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            Plan comptable {estSycebnl ? 'SYCEBNL' : 'SYSCOHADA révisé'}
            {ref && <PastilleReferentiel code={ref.actuel} titre={ref.actuel_info?.description} />}
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{totalAffiche} comptes · Référentiel OHADA{estSycebnl ? ' — entités à but non lucratif (associations, ONG)' : ''}</span>
            {customCount > 0 && <span style={{ fontSize: 11, background: '#ede9fe', color: '#6d28d9', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>{customCount} compte{customCount > 1 ? 's' : ''} additif{customCount > 1 ? 's' : ''}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {modeClient && (
            <select
              value={statutFiltre} onChange={(e) => setStatutFiltre(e.target.value)}
              style={{ padding: '9px 10px', border: '1.5px solid var(--border)', borderRadius: 7, fontSize: 13 }}
              title="Filtrer par statut"
            >
              {FILTRES_STATUT.map((f) => <option key={f.val} value={f.val}>{f.label}</option>)}
            </select>
          )}
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

      {ref?.a_basculer && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', background: 'linear-gradient(135deg,#fffbeb,#fef3c7)', border: '1px solid #fde68a', borderRadius: 12, padding: '12px 16px', marginBottom: 16 }}>
          <span style={{ fontSize: 22 }} aria-hidden>🧭</span>
          <div style={{ flex: '1 1 300px', fontSize: 13, color: '#78350f' }}>
            <b>Plan à aligner sur la forme juridique.</b> L'entité est déclarée « {ref.forme_juridique || 'sans forme'} », qui relève du <b>{ref.attendu_info?.libelle}</b> ; ce plan applique encore le {ref.actuel_info?.libelle}.
          </div>
          {can('config.edit')
            ? <button type="button" onClick={ouvrirAlignement} style={{ padding: '9px 16px', borderRadius: 9, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, color: 'white', background: ref.attendu === 'SYCEBNL' ? 'linear-gradient(135deg,#047857,#0d9488)' : 'linear-gradient(135deg,#1d4ed8,#4f46e5)' }}>
                Charger le plan {ref.attendu_info?.libelle}…</button>
            : <span style={{ fontSize: 12, color: '#92400e' }}>Demandez au directeur (Configuration → Entité).</span>}
        </div>
      )}

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
          <span style={{ fontSize: 10, fontWeight: 500, opacity: .8 }}>Classes 1 à {estSycebnl ? 9 : 7}</span>
          <span style={{ fontSize: 10, fontWeight: 700, marginTop: 2 }}>{totalAffiche} comptes</span>
        </button>
        {classesAffichees.map((c) => (
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
                {avecActions && <th style={{ width: modeClient ? 150 : 60 }} />}
              </tr>
            </thead>
            <tbody>
              {displayed.length === 0 ? (
                <tr><td colSpan={avecActions ? 6 : 5} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 13 }}>Aucun compte ne correspond aux critères.</td></tr>
              ) : displayed.map((c) => {
                const isCustom = c.source === 'custom';
                return (
                  <tr key={c.id ?? c.compte} style={{ borderBottom: '1px solid #f1f5f9', background: isCustom ? '#faf5ff' : undefined, opacity: modeClient && c.statut !== 'actif' ? 0.65 : 1 }}>
                    <td style={{ padding: '10px 16px' }}>
                      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, fontSize: 13, color: isCustom ? '#6d28d9' : 'var(--text)' }}>{c.compte}</span>
                    </td>
                    <td style={{ padding: '10px 16px', fontSize: 13 }}>
                      {c.intitule || '—'}
                      {modeClient && c.statut !== 'actif' && (
                        <span style={{ marginLeft: 8, background: STATUTS_META[c.statut].bg, color: STATUTS_META[c.statut].fg, padding: '1px 7px', borderRadius: 8, fontSize: 10, fontWeight: 700 }}>{STATUTS_META[c.statut].label}</span>
                      )}
                      {modeClient && c.utilise && (
                        <span
                          title={`Utilisé par : ${c.rubriques.map((r) => `${r.code} — ${r.intitule}`).join(', ')}`}
                          style={{ marginLeft: 8, background: '#e0f2fe', color: '#0369a1', padding: '1px 7px', borderRadius: 8, fontSize: 10, fontWeight: 700 }}
                        >utilisé ({c.rubriques.length})</span>
                      )}
                      {modeClient && c.personnalise && (
                        <span title="Libellé personnalisé par rapport au modèle" style={{ marginLeft: 6, fontSize: 10, color: '#7c3aed' }}>✎</span>
                      )}
                      {modeClient && c.description && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.description}</div>}
                    </td>
                    <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                      <span style={{ background: '#f1f5f9', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{c.classe ?? '—'}</span>
                    </td>
                    <td style={{ padding: '10px 16px', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: .3 }}>{c.nature || '—'}</td>
                    <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                      {isCustom
                        ? <span style={{ background: '#ede9fe', color: '#6d28d9', padding: '2px 9px', borderRadius: 10, fontSize: 10, fontWeight: 700, letterSpacing: .3 }}>✦ ADDITIF</span>
                        : c.referentiel === 'SYCEBNL'
                          ? <span style={{ background: '#ecfdf5', color: '#047857', padding: '2px 9px', borderRadius: 10, fontSize: 10, fontWeight: 700 }}>SYCEBNL</span>
                          : <span style={{ background: '#f1f5f9', color: '#94a3b8', padding: '2px 9px', borderRadius: 10, fontSize: 10, fontWeight: 600 }}>SYSCOHADA</span>}
                    </td>
                    {avecActions && modeClient && (
                      <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          {canEdit && <button className="btn-icon" title="Modifier" onClick={() => setModal({ edit: c })}>✏️</button>}
                          {canDelete && c.statut !== 'actif' && <button className="btn-icon" title="Réactiver" onClick={() => changerStatut(c, 'actif')}>↺</button>}
                          {canDelete && c.statut === 'actif' && <button className="btn-icon" title="Désactiver" onClick={() => changerStatut(c, 'inactif')}>⏸</button>}
                          {canDelete && c.statut !== 'archive' && <button className="btn-icon" title="Archiver" onClick={() => changerStatut(c, 'archive')}>🗄</button>}
                          <button className="btn-icon" title="Historique" onClick={() => setModal({ histo: c })}>🕘</button>
                        </div>
                      </td>
                    )}
                    {avecActions && !modeClient && (
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

      {modal?.edit && (
        <EditCompteModal
          compte={modal.edit}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); toast('Compte mis à jour.', 'success'); charger(true); }}
        />
      )}
      {modal?.histo && <HistoriqueModal compte={modal.histo} onClose={() => setModal(null)} />}

      {modal === 'add' && (
        <AddCompteModal
          onClose={() => setModal(null)}
          onSaved={(compte, intitule) => { setModal(null); toast(`Compte ${compte} — ${intitule} ajouté au plan.`, 'success'); charger(true); }}
        />
      )}
      {bascule && (
        <BasculePlanModal {...bascule} enCours={basculeEnCours}
          onConfirmer={confirmerBascule} onAnnuler={() => { if (!basculeEnCours) setBascule(null); }} />
      )}
    </div>
  );
}
