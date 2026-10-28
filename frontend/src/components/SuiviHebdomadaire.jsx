import { fmt } from '@/lib/format';

// Suivi budgétaire d'un mois au budget HEBDOMADAIRE (migration 040) :
// une colonne par semaine (prévu / réalisé), le statut de validation de
// chaque semaine et, pour le directeur, les boutons de validation.
// Le « reste cumulé » d'une semaine = prévu VALIDÉ des semaines 1..k − réalisé
// des semaines 1..k : c'est exactement ce que contrôle la saisie (report du
// non-dépensé à l'intérieur du mois).
const STATUT = {
  valide: { lib: 'Validée', bg: '#dcfce7', fg: '#166534' },
  rejete: { lib: 'Rejetée', bg: '#fee2e2', fg: '#991b1b' },
  en_attente: { lib: 'En attente', bg: '#fef3c7', fg: '#92400e' },
};

export default function SuiviHebdomadaire({ data, devise, canValidate, onValiderSemaine }) {
  const { semaines = [], par_semaine: prevu = {}, realise_par_semaine: realise = {} } = data;
  const codes = [...new Set([...Object.keys(prevu), ...Object.keys(realise)])].sort();
  const intitules = Object.fromEntries((data.dotations || []).map((d) => [d.rubrique_code, d.intitule]));
  const valide = (k) => semaines.find((s) => s.num === k)?.statut === 'valide';
  const total = (obj, k) => codes.reduce((t, c) => t + ((obj[c] || {})[k] || 0), 0);
  // Reste cumulé à la fin de chaque semaine (tous rubriques confondues).
  let cumulPrevu = 0; let cumulReal = 0;
  const restes = semaines.map((s) => {
    cumulPrevu += valide(s.num) ? total(prevu, s.num) : 0;
    cumulReal += total(realise, s.num);
    return cumulPrevu - cumulReal;
  });
  const cell = { textAlign: 'right', whiteSpace: 'nowrap', fontSize: 12 };

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: 'var(--text-muted)', marginBottom: 8 }}>
        Budget hebdomadaire — prévu / réalisé par semaine
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Rubrique</th>
              {semaines.map((s) => {
                const st = STATUT[s.statut] || STATUT.en_attente;
                return (
                  <th key={s.num} style={{ textAlign: 'center', minWidth: 130 }}>
                    <div>S{s.num}</div>
                    <div style={{ fontSize: 10, fontWeight: 400, textTransform: 'none' }}>{s.libelle.replace(/^S\d+ · /, '')}</div>
                    <span style={{ display: 'inline-block', marginTop: 4, padding: '1px 8px', borderRadius: 10, fontSize: 10, background: st.bg, color: st.fg, textTransform: 'none' }}>{st.lib}</span>
                    {canValidate && s.total > 0 && (
                      <div style={{ marginTop: 4, display: 'flex', gap: 4, justifyContent: 'center' }}>
                        {s.statut !== 'valide' && <button type="button" className="btn-ghost" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => onValiderSemaine(s.num, 'valide')}>✅ Valider</button>}
                        {s.statut === 'valide' && <button type="button" className="btn-ghost" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => onValiderSemaine(s.num, 'en_attente')}>↺ Rouvrir</button>}
                        {s.statut !== 'rejete' && s.statut !== 'valide' && <button type="button" className="btn-ghost" style={{ fontSize: 10, padding: '2px 6px', color: 'var(--accent-red)' }} onClick={() => onValiderSemaine(s.num, 'rejete')}>✕</button>}
                      </div>
                    )}
                  </th>
                );
              })}
              <th style={{ textAlign: 'right' }}>Mois</th>
            </tr>
          </thead>
          <tbody>
            {codes.length === 0 && (
              <tr><td colSpan={semaines.length + 2} style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>
                Aucune prévision hebdomadaire ce mois : saisissez-les dans Prévisions de dépenses.
              </td></tr>
            )}
            {codes.map((c) => {
              const p = prevu[c] || {};
              const r = realise[c] || {};
              const totP = Object.values(p).reduce((a, b) => a + b, 0);
              const totR = Object.values(r).reduce((a, b) => a + b, 0);
              return (
                <tr key={c}>
                  <td><span className="badge-rubrique">{c}</span> <span style={{ fontSize: 12 }}>{intitules[c] || ''}</span></td>
                  {semaines.map((s) => (
                    <td key={s.num} style={cell}>
                      <div style={{ color: valide(s.num) ? 'var(--text)' : 'var(--text-light)' }} title={valide(s.num) ? 'Prévu validé' : 'Prévu non validé'}>{p[s.num] ? fmt(p[s.num], devise) : '—'}</div>
                      <div style={{ color: (r[s.num] || 0) > 0 ? 'var(--accent-red)' : 'var(--text-light)' }}>{r[s.num] ? fmt(r[s.num], devise) : '—'}</div>
                    </td>
                  ))}
                  <td style={cell}><div>{fmt(totP, devise)}</div><div style={{ color: 'var(--accent-red)' }}>{fmt(totR, devise)}</div></td>
                </tr>
              );
            })}
          </tbody>
          {codes.length > 0 && (
            <tfoot>
              <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
                <td>Reste cumulé <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)' }}>(validé − réalisé, avec report)</span></td>
                {restes.map((x, i) => (
                  <td key={semaines[i].num} style={{ ...cell, color: x >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>{fmt(x, devise)}</td>
                ))}
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
        Dans chaque case : prévu (en gris s'il n'est pas encore validé) puis réalisé (en rouge).
      </div>
    </div>
  );
}
