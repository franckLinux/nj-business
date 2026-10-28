import { fmt } from '@/lib/format';
import { STATUTS } from '@/components/LigneControle';
import PlanComptableAutocomplete from '@/components/PlanComptableAutocomplete';
import { AnomaliesSaisies, HistoriqueControle } from '@/components/ControleRegularite';

// Fiche de contrôle d'une opération (migrations 042-044), ouverte depuis le
// Rapport (seul point d'accès au contrôle). Contrôle COMPTABLE uniquement :
// identification, tiers et compte tiers, code comptable (corrigeable par le
// comptable), observation saisie à la main, statut. Aucune vérification de
// justificatif. L'écriture d'origine n'est jamais modifiée.
// 045 : anomalies constatées (saisie manuelle), « Confirmer la validation »,
// pièce validée verrouillée (réouverture motivée), historique.
const dateFr = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const dateHeure = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '');

// Valeurs éditables d'une opération (brouillon de la fiche). `compte` est le
// code affiché ; `retablir` demande le retour au compte de la rubrique.
export const editionDe = (l) => ({
  id: l.id, tiers_nui: l.tiers_nui, tiers_nom: l.tiers_nom, tiers_id: l.registre?.id || null,
  observation: l.observation, compte: l.compte || '', retablir: false, ajouter_registre: false,
});
// Corps envoyé à l'API : le code comptable n'est transmis que s'il a changé.
export const corpsDe = (l, d) => {
  const { compte, retablir, ...reste } = d;
  const c = String(compte || '').trim().toUpperCase();
  if (retablir) return { ...reste, compte_corrige: '' };
  if (c !== String(l.compte || '').toUpperCase()) return { ...reste, compte_corrige: c };
  return reste;
};
export const brouillonModifie = (l, d) => {
  if (!l || !d) return false;
  const a = editionDe(l);
  return Object.keys(a).some((k) => String(a[k] ?? '') !== String(d[k] ?? ''));
};

const Info = ({ lib, children, mono }) => (
  <div className="ctl-info">
    <span>{lib}</span>
    <b className={mono ? 'mono' : undefined}>{children}</b>
  </div>
);

export default function PanneauControle({
  l, draft, setDraft, tiers, devise, peutSaisir: peutSaisirBrut, peutCorriger: peutCorrigerBrut, peutRouvrir, saving, modifie,
  onEnregistrer, onPrecedent, onSuivant, position, ouverte, onFermer, onMaj, onValider, onRouvrir,
}) {
  // Pièce validée : tout est verrouillé jusqu'à sa réouverture.
  const validee = l.statut === 'controle';
  const peutSaisir = peutSaisirBrut && !validee;
  const peutCorriger = peutCorrigerBrut && !validee;
  const maj = (k) => (e) => setDraft({ ...draft, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const nuiNorm = String(draft.tiers_nui || '').toUpperCase().replace(/\s+/g, '');
  const fiche = tiers.find((t) => t.source === 'registre' && ((draft.tiers_id && t.tiers_id === draft.tiers_id) || (nuiNorm && t.nui === nuiNorm)));
  const choisirNui = (v) => {
    const t = tiers.find((x) => x.nui && x.nui === v.toUpperCase().replace(/\s+/g, ''));
    setDraft({ ...draft, tiers_nui: v, tiers_id: t?.tiers_id || null, ...(t ? { tiers_nom: t.nom } : {}) });
  };
  const choisirNom = (v) => {
    const t = tiers.find((x) => x.source === 'registre' && x.nom === v);
    setDraft({ ...draft, tiers_nom: v, tiers_id: t?.tiers_id || null, ...(t ? { tiers_nui: t.nui || draft.tiers_nui } : {}) });
  };

  const st = STATUTS[l.statut] || STATUTS.a_controler;
  const peutAgir = peutSaisir || peutCorriger;
  const compteModifiable = peutCorriger && !l.virement && !l.exporte;
  // Compte tiers affiché : celui du tiers choisi dans la fiche s'il change.
  const compteTiers = fiche && fiche.tiers_id !== l.registre?.id
    ? (fiche.compte_tiers || (fiche.type === 'client' || (fiche.type === 'mixte' && l.credit) ? '411' : '401'))
    : l.compte_tiers;
  const compteTiersCollectif = fiche && fiche.tiers_id !== l.registre?.id ? !fiche.compte_tiers : l.compte_tiers_source === 'collectif';

  return (
    <aside className={`ctl-fiche tiroir${ouverte ? ' ouverte' : ''}`} aria-label={`Contrôle de l'opération ${l.reference}`}>
      <div className="ctl-fiche-tete">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 800, whiteSpace: 'nowrap' }}>{l.reference}</div>
          <span style={{ padding: '2px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: st.bg, color: st.fg, whiteSpace: 'nowrap' }}>{st.lib}</span>
          <div style={{ marginLeft: 'auto', fontSize: 18, fontWeight: 800, whiteSpace: 'nowrap', color: l.debit ? '#b91c1c' : '#15803d' }}>
            {l.debit ? `− ${fmt(l.debit, devise)}` : `+ ${fmt(l.credit, devise)}`}
          </div>
          <button type="button" className="ctl-btn mini ctl-fermer" onClick={onFermer} aria-label="Fermer la fiche">✕</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={l.libelle}>{l.libelle}</div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{position}</span>
          <button type="button" className="ctl-btn mini" onClick={onPrecedent} title="Opération précédente (↑)" aria-label="Opération précédente">↑</button>
          <button type="button" className="ctl-btn mini" onClick={onSuivant} title="Opération suivante (↓)" aria-label="Opération suivante">↓</button>
        </div>
      </div>

      <div className="ctl-fiche-corps">
        {/* Identification de l'opération : lecture seule */}
        <div className="ctl-infos">
          <Info lib="Journal">{l.journal_code}{l.journal_nom ? ` – ${l.journal_nom}` : ''}</Info>
          <Info lib="Référence" mono>{l.reference}</Info>
          <Info lib="Date">{dateFr(l.date)}</Info>
          <Info lib="Rubrique">{l.rubrique_code}{l.rubrique_intitule ? ` – ${l.rubrique_intitule}` : ''}</Info>
          {l.exporte && <div className="ctl-alerte bleue" style={{ gridColumn: '1 / -1' }}>📤 Opération transmise à la comptabilité : son imputation ne se modifie plus (annulation / contre-passation si nécessaire).</div>}
        </div>

        {l.anomalies.length > 0 ? (
          <div className="ctl-alerte rouge" style={{ marginTop: 12 }}>
            <b>Points à vérifier ({l.anomalies.length})</b>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{l.anomalies_libelles.map((a) => <li key={a}>{a}</li>)}</ul>
          </div>
        ) : (
          <div className="ctl-alerte verte" style={{ marginTop: 12 }}>✓ Aucune anomalie comptable détectée.</div>
        )}
        {validee && (
          <div className="ctl-alerte verte" style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>✓ <b>Validée</b> par {l.controle_par || '?'} le {dateHeure(l.controle_le)}. Pièce verrouillée.</span>
            {peutRouvrir && <button type="button" className="ctl-btn mini" style={{ marginLeft: 'auto' }} onClick={onRouvrir}>↺ Rouvrir</button>}
          </div>
        )}
        {l.reouverture && !validee && (
          <div className="ctl-alerte bleue" style={{ marginTop: 8 }}>Rouverte par {l.reouverture.par || '?'} le {dateHeure(l.reouverture.le)} : « {l.reouverture.motif} »</div>
        )}
        {!peutAgir && !validee && <div className="ctl-alerte bleue" style={{ marginTop: 8 }}>Consultation seule.</div>}

        <div className="ctl-sec">
          <div className="ctl-sec-titre">👤 Fournisseur / client</div>
          {l.virement ? (
            <div className="ctl-alerte bleue">Virement entre caisses : pas de tiers.</div>
          ) : (
            <fieldset disabled={!peutSaisir} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <div className="ctl-grille2">
                <div className="plein"><label className="ctl-lbl" htmlFor="ctl-nom">Nom / raison sociale</label>
                  <input id="ctl-nom" list="ctl-tiers-nom" className={`ctl-in${draft.tiers_nom ? '' : ' vide'}`} value={draft.tiers_nom}
                    onChange={(e) => choisirNom(e.target.value)} autoComplete="off" /></div>
                <div><label className="ctl-lbl" htmlFor="ctl-nui">NUI</label>
                  <input id="ctl-nui" list="ctl-tiers-nui" className={`ctl-in mono${draft.tiers_nui ? '' : ' vide'}`} value={draft.tiers_nui}
                    onChange={(e) => choisirNui(e.target.value)} placeholder="Ex. M050000123456P" autoComplete="off" /></div>
                <div><label className="ctl-lbl">Compte tiers</label>
                  <div className={`ctl-in mono ctl-lecture${compteTiers ? '' : ' muet'}`} title={compteTiersCollectif ? 'Collectif par défaut : le tiers n\'a pas encore de compte individuel au registre' : 'Compte du tiers au registre'}>
                    {compteTiers || 'non identifié'}{compteTiers && compteTiersCollectif && <span className="ctl-pastille">collectif</span>}
                  </div></div>
                <div className="plein" style={{ fontSize: 12 }}>
                  {fiche ? (
                    <span style={{ color: '#166534' }}>📒 Au registre : <b>{fiche.nom}</b>{fiche.verifie ? ' · ✓ vérifié' : ''}</span>
                  ) : peutSaisir ? (
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                      <input type="checkbox" checked={draft.ajouter_registre} onChange={maj('ajouter_registre')} style={{ appearance: 'auto' }} />
                      Ajouter ce tiers au registre des bénéficiaires payés / encaissés
                    </label>
                  ) : <span className="muet">Tiers absent du registre.</span>}
                  {(l.tiers_saisi.nom || l.tiers_saisi.nui) && (
                    <div style={{ color: 'var(--text-muted)', marginTop: 3 }}>Saisi en caisse : {l.tiers_saisi.nom || '—'} {l.tiers_saisi.nui}</div>
                  )}
                </div>
              </div>
            </fieldset>
          )}
        </div>

        <div className="ctl-sec">
          <div className="ctl-sec-titre">📒 Imputation comptable</div>
          <div className="ctl-grille2">
            <div className="plein"><label className="ctl-lbl" htmlFor="ctl-compte">Code comptable de l'opération</label>
              {compteModifiable ? (
                <PlanComptableAutocomplete value={draft.compte}
                  onChange={(v) => setDraft({ ...draft, compte: v, retablir: false })}
                  placeholder="Compte du plan (ex. 6056)" inputStyle={{ padding: '7px 10px', border: '1.5px solid var(--border)', borderRadius: 8, fontSize: 13, background: '#fafbfc' }} />
              ) : (
                <div className={`ctl-in mono ctl-lecture${l.compte ? '' : ' muet'}`}>{l.compte || 'manquant'}</div>
              )}
            </div>
            <div className="plein" style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {l.virement ? <>Virement interne : compte des virements, réglé dans la passerelle comptable.</> : (
                <>
                  Compte de la rubrique : <b className="mono" style={{ color: 'var(--text)' }}>{l.compte_rubrique || '—'}</b>
                  {l.compte_rubrique_etat === 'non_valide' && <span style={{ color: '#b45309' }}> (non validé dans la passerelle)</span>}
                  {l.compte_rubrique_etat === 'manquant' && <span style={{ color: '#b91c1c' }}> (aucun)</span>}
                  {l.compte_corrige && <div style={{ color: '#7c3aed' }}>✎ Corrigé en <b className="mono">{l.compte_corrige}</b>{l.compte_corrige_par ? ` par ${l.compte_corrige_par}` : ''}{l.compte_corrige_le ? ` le ${dateHeure(l.compte_corrige_le)}` : ''}</div>}
                  {compteModifiable && (l.compte_corrige || draft.compte !== l.compte) && !draft.retablir && (
                    <div><button type="button" className="rpc-lien" style={{ marginLeft: 0, padding: 0 }}
                      onClick={() => setDraft({ ...draft, compte: l.compte_rubrique || '', retablir: Boolean(l.compte_corrige) })}>↺ Revenir au compte de la rubrique</button></div>
                  )}
                </>
              )}
              <div>Contrepartie (trésorerie) : <b className="mono" style={{ color: l.compte_tresorerie ? 'var(--text)' : '#b91c1c' }}>{l.compte_tresorerie || 'manquante'}</b></div>
              {!peutCorriger && !l.virement && <div>La correction du code comptable est réservée au comptable.</div>}
            </div>
          </div>
        </div>

        <div className="ctl-sec">
          <div className="ctl-sec-titre">⚠ Anomalies constatées</div>
          <AnomaliesSaisies l={l} peutSaisir={peutSaisirBrut} onMaj={onMaj} />
        </div>

        <div className="ctl-sec">
          <div className="ctl-sec-titre">✍ Observation</div>
          <textarea className="ctl-in" rows={4} value={draft.observation} onChange={maj('observation')} style={{ resize: 'vertical' }}
            disabled={!peutSaisir} maxLength={2000} placeholder="Saisie manuelle : anomalie, correction, particularité comptable…" />
        </div>
        {peutAgir && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            <span style={{ color: modifie ? '#b45309' : undefined }}>{saving ? 'Enregistrement…' : modifie ? '● Modifications non enregistrées' : '✓ À jour'}</span>
            {peutSaisir && l.statut !== 'a_controler' && <button type="button" onClick={() => onEnregistrer('a_controler')} disabled={saving}
              style={{ border: 0, background: 'none', color: 'var(--text-muted)', textDecoration: 'underline', cursor: 'pointer', fontSize: 11, padding: 0 }}>Remettre « à contrôler »</button>}
          </div>
        )}
        <HistoriqueControle id={l.id} />
      </div>

      {peutAgir && (
        <div className="ctl-fiche-pied">
          <button type="button" className="ctl-btn" disabled={saving || !modifie} onClick={() => onEnregistrer(null)}
            title={modifie ? 'Enregistrer (Ctrl + Entrée)' : 'Aucune modification'}>💾 Enregistrer</button>
          {peutSaisir && <button type="button" className={`ctl-btn ${l.validable ? 'vert' : ''}`} disabled={saving} onClick={onValider} style={{ marginLeft: 'auto' }}
            title={l.validable ? 'Vérifier puis confirmer la validation' : `Validation bloquée : ${l.bloquants.join(' ; ')}`}>{l.validable ? '✅' : '⛔'} Confirmer la validation</button>}
        </div>
      )}
    </aside>
  );
}
