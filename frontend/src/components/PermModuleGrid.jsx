// Reprend MODULE_META / _renderPermModule / _renderPermChip / toggleAllPerms
// de legacy/js/app.js (l. 5332-5640) — réécrit de façon déclarative (state React
// à la place des attributs `data-*` + mutation directe du DOM du legacy).
export const MODULE_META = {
  entreprise: { label: 'Entreprise (socle NJ BUSINESS)', color: '#f1f5f9', text: '#0f172a' },
  journal: { label: 'Journal de caisse', color: '#dbeafe', text: '#1d4ed8' },
  budget: { label: 'Suivi budgétaire', color: '#dcfce7', text: '#15803d' },
  previsions: { label: 'Prévisions', color: '#fef9c3', text: '#a16207' },
  appel_fonds: { label: 'Appel de fonds', color: '#fce7f3', text: '#be185d' },
  rubriques: { label: 'Rubriques', color: '#ede9fe', text: '#7c3aed' },
  users: { label: 'Utilisateurs', color: '#ffedd5', text: '#c2410c' },
  config: { label: 'Configuration', color: '#e0f2fe', text: '#0369a1' },
  rapport: { label: 'Rapports', color: '#f0fdf4', text: '#166534' },
  plan_comptable: { label: 'Plan comptable', color: '#fdf4ff', text: '#86198f' },
  journaux: { label: 'Caisses & journaux', color: '#e0e7ff', text: '#4338ca' },
  pieces: { label: 'Pièces justificatives', color: '#fef2f2', text: '#b91c1c' },
  banque: { label: 'Banque', color: '#f0f9ff', text: '#0c4a6e' },
  roles: { label: 'Profils métier', color: '#fff7ed', text: '#9a3412' },
  passerelle: { label: 'Passerelle comptable', color: '#ecfeff', text: '#0e7490' },
  controle: { label: 'Contrôle comptable', color: '#f0fdfa', text: '#0f766e' },
  commercial: { label: 'NJ COMMERCIAL', color: '#eef2ff', text: '#3730a3' },
  finance: { label: 'NJ FINANCE — Comptabilité', color: '#f0fdf4', text: '#166534' },
};

// NJ COMMERCIAL : un seul module en base, présenté en quatre blocs (configuration,
// achats, stock, ventes) pour que chaque fonction se retrouve facilement à cocher.
const SOUS_GROUPES = {
  'commercial:config': { label: 'NJ COMMERCIAL — Configuration', color: '#eef2ff', text: '#3730a3' },
  'commercial:achats': { label: 'NJ COMMERCIAL — Achats', color: '#f5f3ff', text: '#6d28d9' },
  'commercial:stock': { label: 'NJ COMMERCIAL — Stock', color: '#ecfdf5', text: '#047857' },
  'commercial:ventes': { label: 'NJ COMMERCIAL — Ventes', color: '#ecfeff', text: '#0e7490' },
};
const ORDRE_STOCK = ['voir', 'initial', 'entree', 'sortie', 'transfert', 'inventaire', 'valider', 'annuler', 'journal', 'valorisation'];
export const groupeDe = (p) => {
  if (p.module !== 'commercial') return p.module;
  if (p.code.startsWith('com.stock.')) return 'commercial:stock';
  if (p.code.startsWith('com.ventes.')) return 'commercial:ventes';
  if (/^com\.(da|bc|documents|tableau_bord|receptions|retours_fourn|factures_fourn)\./.test(p.code)) return 'commercial:achats';
  return 'commercial:config';
};
// Permissions regroupées par bloc, dans l'ordre de lecture (le stock suit le circuit).
export const regrouper = (permissions) => {
  const groupes = {};
  permissions.forEach((p) => { (groupes[groupeDe(p)] ??= []).push(p); });
  const rang = (p) => { const i = ORDRE_STOCK.indexOf(p.code.slice(10)); return i < 0 ? 99 : i; };
  if (groupes['commercial:stock']) groupes['commercial:stock'].sort((a, b) => rang(a) - rang(b));
  const cles = Object.keys(groupes).sort((a, b) => {
    const ca = a.startsWith('commercial'); const cb = b.startsWith('commercial');
    if (ca !== cb) return ca ? 1 : -1;
    return ca ? Object.keys(SOUS_GROUPES).indexOf(a) - Object.keys(SOUS_GROUPES).indexOf(b) : 0;
  });
  return cles.map((k) => [k, groupes[k]]);
};

export const moduleMeta = (mod) => SOUS_GROUPES[mod] || MODULE_META[mod] || { label: mod, color: '#f1f5f9', text: '#64748b' };

// permissions: [{code,nom,module,description}], granted: Set<string>, onChange: (Set) => void
export default function PermModuleGrid({ permissions, granted, onChange }) {

  const toggle = (code) => {
    const next = new Set(granted);
    if (next.has(code)) next.delete(code); else next.add(code);
    onChange(next);
  };

  const toggleAll = (list) => {
    const allOn = list.every((p) => granted.has(p.code));
    const next = new Set(granted);
    list.forEach((p) => { if (allOn) next.delete(p.code); else next.add(p.code); });
    onChange(next);
  };

  return (
    <>
      {regrouper(permissions).map(([mod, list]) => {
        const meta = moduleMeta(mod);
        const allOn = list.every((p) => granted.has(p.code));
        return (
          <div key={mod} style={{ marginBottom: 14, border: `1.5px solid ${meta.text}22`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ background: meta.color, padding: '9px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ color: meta.text, fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: .8 }}>{meta.label}</span>
              <button
                onClick={() => toggleAll(list)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 12px', borderRadius: 20, cursor: 'pointer',
                  fontSize: 11, fontWeight: 700, background: allOn ? meta.text + '22' : 'transparent', color: meta.text,
                  border: `1.5px solid ${allOn ? meta.text + '44' : meta.text + '33'}`,
                }}
              >
                {allOn ? '✓ Désélectionner' : 'Sélectionner'} tout
              </button>
            </div>
            <div style={{ padding: '10px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, background: 'white' }}>
              {list.map((p) => {
                const isOn = granted.has(p.code);
                return (
                  <button
                    key={p.code} onClick={() => toggle(p.code)} title={p.description || undefined}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', borderRadius: 9, cursor: 'pointer',
                      fontSize: 12, fontWeight: 600, textAlign: 'left', background: isOn ? meta.color : '#f8fafc', color: isOn ? meta.text : '#94a3b8',
                      border: `1.5px solid ${isOn ? meta.text + '55' : '#e2e8f0'}`,
                    }}
                  >
                    <span style={{ width: 17, height: 17, borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 900, background: isOn ? meta.text : '#e2e8f0', color: 'white' }}>
                      {isOn ? '✓' : ''}
                    </span>
                    <span style={{ lineHeight: 1.3 }}>{p.nom}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}
