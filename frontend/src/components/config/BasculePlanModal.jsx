import { useState } from 'react';

// Migration 060 — fenêtre de confirmation de la bascule du plan comptable
// (SYSCOHADA révisé ↔ SYCEBNL). Affiche l'aperçu calculé par le serveur
// (plan_client_basculer en simulation) : rien n'est écrit avant « Confirmer ».
//
// Props : de, vers, versInfo { libelle, description }, apercu, contexte
//         ('forme' : changement de forme juridique | 'alignement'),
//         enCours, onConfirmer, onAnnuler.

const COULEURS = {
  SYCEBNL: { grad: 'linear-gradient(135deg,#047857,#0d9488)', clair: '#ecfdf5', bord: '#a7f3d0', texte: '#047857' },
  SYSCOHADA: { grad: 'linear-gradient(135deg,#1d4ed8,#4f46e5)', clair: '#eff6ff', bord: '#bfdbfe', texte: '#1d4ed8' },
};
const LIBELLES = { SYSCOHADA: 'SYSCOHADA révisé', SYCEBNL: 'SYCEBNL' };

function Tuile({ v, lib, sous, couleur }) {
  return (
    <div className="bp-tuile" style={{ borderTopColor: couleur }}>
      <div className="bp-tuile-v" style={{ color: couleur }}>{v}</div>
      <div className="bp-tuile-l">{lib}</div>
      {sous && <div className="bp-tuile-s">{sous}</div>}
    </div>
  );
}

export function PastilleReferentiel({ code, taille = 'normale', titre }) {
  const c = COULEURS[code] || COULEURS.SYSCOHADA;
  return (
    <span title={titre} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, background: c.clair, color: c.texte,
      border: `1px solid ${c.bord}`, borderRadius: 20, fontWeight: 700, whiteSpace: 'nowrap',
      padding: taille === 'petite' ? '1px 8px' : '3px 10px', fontSize: taille === 'petite' ? 10 : 11,
    }}>
      <span aria-hidden>{code === 'SYCEBNL' ? '🤝' : '🏢'}</span>{LIBELLES[code] || code}
    </span>
  );
}

export default function BasculePlanModal({ de, vers, versInfo, apercu, contexte = 'forme', enCours, onConfirmer, onAnnuler }) {
  const [lu, setLu] = useState(false);
  const c = COULEURS[vers] || COULEURS.SYSCOHADA;
  const a = apercu || {};
  const renommesUtilises = a.renommes_utilises || [];
  const conserves = a.conserves_utilises || [];

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget && !enCours) onAnnuler(); }}>
      <style>{`
        .bp-tuiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
        .bp-tuile{background:#fff;border:1px solid var(--border);border-top:3px solid;border-radius:10px;padding:10px 12px}
        .bp-tuile-v{font-size:20px;font-weight:800;line-height:1.1;font-variant-numeric:tabular-nums}
        .bp-tuile-l{font-size:11px;font-weight:700;color:var(--text);margin-top:3px}
        .bp-tuile-s{font-size:10.5px;color:var(--text-muted);margin-top:2px}
        .bp-liste{max-height:140px;overflow:auto;border:1px solid var(--border);border-radius:8px;font-size:12px}
        .bp-liste div{display:flex;gap:8px;padding:6px 10px;border-bottom:1px solid #f1f5f9}
        .bp-liste div:last-child{border-bottom:0}
        .bp-garanties{display:grid;gap:6px;font-size:12.5px;color:#334155;margin:0;padding:0;list-style:none}
        .bp-garanties li{display:flex;gap:8px;align-items:flex-start}
        @media (max-width:640px){.bp-tuiles{grid-template-columns:repeat(2,minmax(0,1fr))}}
      `}</style>
      <div className="modal-box" style={{ maxWidth: 640 }} role="dialog" aria-label="Bascule du plan comptable">
        <div className="modal-head" style={{ background: c.grad }}>
          <h3 style={{ color: 'white' }}>📚 Changement de plan comptable</h3>
          <button type="button" className="modal-close" style={{ color: 'white', opacity: 0.85 }} onClick={onAnnuler} disabled={enCours}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: c.clair, border: `1px solid ${c.bord}`, borderRadius: 12, padding: '12px 14px' }}>
            <PastilleReferentiel code={de} />
            <span aria-hidden style={{ fontSize: 18, color: c.texte }}>→</span>
            <PastilleReferentiel code={vers} />
            <span style={{ fontSize: 12.5, color: '#334155', flex: '1 1 220px' }}>
              {contexte === 'forme'
                ? <>La forme juridique choisie relève du <b>{versInfo?.libelle || LIBELLES[vers]}</b> — {versInfo?.description}.</>
                : contexte === 'choix'
                  ? <>Vous choisissez le <b>{versInfo?.libelle || LIBELLES[vers]}</b> pour la caisse — {versInfo?.description}.</>
                  : <>Votre entité est déclarée sous une forme qui relève du <b>{versInfo?.libelle || LIBELLES[vers]}</b> : alignez son plan comptable.</>}
            </span>
          </div>

          {a.initialisation ? (
            <div className="ctl-alerte bleue">Le plan de ce client n'est pas encore créé : il sera initialisé directement avec les <b>{a.ajoutes}</b> comptes du {LIBELLES[vers]}.</div>
          ) : (
            <div className="bp-tuiles">
              <Tuile v={a.ajoutes ?? 0} lib="Comptes ajoutés" sous={`propres au ${LIBELLES[vers]}`} couleur="#059669" />
              <Tuile v={a.renommes ?? 0} lib="Libellés repris" sous="même numéro, libellé officiel" couleur="#2563eb" />
              <Tuile v={a.archives ?? 0} lib="Comptes archivés" sous="non utilisés, restaurables" couleur="#94a3b8" />
              <Tuile v={a.reactives ?? 0} lib="Comptes réactivés" sous="archivés lors d'une bascule" couleur="#7c3aed" />
            </div>
          )}

          {renommesUtilises.length > 0 && (
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#92400e' }}>⚠️ {renommesUtilises.length} compte(s) utilisé(s) par vos rubriques changent de libellé</div>
              <div className="bp-liste">
                {renommesUtilises.map((r) => (
                  <div key={r.compte}><b className="mono" style={{ minWidth: 48 }}>{r.compte}</b>
                    <span style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}>{r.avant}</span>
                    <span aria-hidden>→</span><span>{r.apres}</span></div>
                ))}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Vérifiez ensuite les équivalences de ces rubriques dans le contrôle de régularité formelle (passerelle).</div>
            </div>
          )}
          {conserves.length > 0 && (
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1d4ed8' }}>🔒 {conserves.length} compte(s) absent(s) du {LIBELLES[vers]} restent actifs car ils sont utilisés</div>
              <div className="bp-liste">
                {conserves.map((r) => <div key={r.compte}><b className="mono" style={{ minWidth: 48 }}>{r.compte}</b><span>{r.intitule}</span></div>)}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Réaffectez ces rubriques vers un compte du nouveau plan, puis archivez-les depuis le plan comptable.</div>
            </div>
          )}

          <ul className="bp-garanties">
            <li><span aria-hidden>✅</span><span><b>Aucune suppression</b> : les comptes sortants sont archivés, jamais effacés ; les écritures de caisse ne sont pas modifiées.</span></li>
            <li><span aria-hidden>✅</span><span>Vos <b>comptes additifs</b> ({a.additifs_conserves ?? 0}) et vos <b>libellés personnalisés</b> sont conservés ; vous pourrez toujours ajouter des comptes.</span></li>
            <li><span aria-hidden>↺</span><span><b>Réversible</b> : {contexte === 'choix' ? 'revenir au plan précédent, depuis les paramètres de la caisse, restaure l\'ancien plan.' : 'revenir à l\'ancienne forme juridique restaure l\'ancien plan.'}</span></li>
          </ul>

          <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13, cursor: 'pointer', background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', margin: 0, textTransform: 'none', letterSpacing: 0, fontWeight: 500, color: '#334155' }}>
            <input type="checkbox" checked={lu} onChange={(e) => setLu(e.target.checked)} disabled={enCours}
              style={{ width: 16, height: 16, flex: '0 0 auto', margin: 0, padding: 0, accentColor: c.texte }} />
            J'ai pris connaissance de l'aperçu et je confirme le passage au {LIBELLES[vers]}.
          </label>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn-ghost" onClick={onAnnuler} disabled={enCours}>Annuler</button>
          <button type="button" className="btn-primary" style={{ width: 'auto', marginTop: 0, background: c.grad, opacity: !lu || enCours ? 0.5 : 1 }}
            disabled={!lu || enCours} onClick={onConfirmer}>
            {enCours ? 'Bascule en cours…' : `Confirmer — passer au ${LIBELLES[vers]}`}
          </button>
        </div>
      </div>
    </div>
  );
}
