// NJ COMPTABILITÉ — Écritures (075, 076).
// Liste filtrable, saisie d'OD / à-nouveaux au brouillard, validation (jamais
// par l'auteur), extourne d'une écriture validée. Règles garanties en base (075).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { Champ, Tiroir, useDiffere } from '@/components/commercial/ui';
import { exporterExcel } from '@/lib/export';
import {
  BadgeStatut, ChampCompte, Erreur, Pagination, SansExercice, aujourdhui, centimes, fmtCompta, fmtDate, lireMontant, useExercices,
} from './commun';

const ligneVide = () => ({ cle: Math.random().toString(36).slice(2), compte: '', intitule: '', libelle: '', tiers_id: '', activite_id: '', debit: '', credit: '' });

export default function EcrituresPage() {
  const { can, user } = useApp();
  const toast = useToast();
  const { exercices, courant, erreur: errEx } = useExercices();
  const [exerciceId, setExerciceId] = useState('');
  const [filtres, setFiltres] = useState({ journal_id: '', statut: '', date_du: '', date_au: '', recherche: '' });
  const [page, setPage] = useState(1);
  const [donnees, setDonnees] = useState(null);
  const [erreur, setErreur] = useState('');
  const [ref, setRef] = useState(null);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(null);
  const [extourne, setExtourne] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const recherche = useDiffere(filtres.recherche, 300);
  const saisit = can('compta.ecritures.saisir');
  const valide = can('compta.ecritures.valider');

  useEffect(() => { if (!exerciceId && courant) setExerciceId(String(courant.id)); }, [courant, exerciceId]);
  useEffect(() => { (async () => { const r = await api.get('/comptabilite/referentiels'); if (!r?.error) setRef(r); })(); }, []);

  const charger = useCallback(async () => {
    if (!exerciceId) return;
    const q = new URLSearchParams({ exercice_id: exerciceId, page: String(page), taille: '50' });
    for (const [k, v] of Object.entries({ ...filtres, recherche })) if (v) q.set(k, v);
    const r = await api.get(`/comptabilite/ecritures?${q}`);
    if (r?.error) { setErreur(r.error); return; }
    setErreur(''); setDonnees(r);
  }, [exerciceId, page, filtres.journal_id, filtres.statut, filtres.date_du, filtres.date_au, recherche]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { charger(); }, [charger]);
  useEffect(() => { setPage(1); }, [exerciceId, filtres.journal_id, filtres.statut, filtres.date_du, filtres.date_au, recherche]);

  const ouvrir = async (id) => {
    const r = await api.get(`/comptabilite/ecritures/${id}`);
    if (r?.error) { toast(r.error, 'error'); return; }
    setDetail(r);
  };
  const nouveau = () => {
    const od = ref?.journaux?.find((j) => j.type === 'od') || ref?.journaux?.[0];
    setForm({ journal_id: od ? String(od.id) : '', date_ecriture: aujourdhui(), reference_piece: '', libelle: '', lignes: [ligneVide(), ligneVide()] });
  };
  const modifier = (e) => {
    setDetail(null);
    setForm({
      id: e.id, journal_id: String(e.journal_id), date_ecriture: String(e.date_ecriture).slice(0, 10), reference_piece: e.reference_piece, libelle: e.libelle,
      lignes: e.lignes.map((l) => ({ cle: String(l.id), compte: l.compte, intitule: l.compte_intitule || '', libelle: l.libelle, tiers_id: l.tiers_id ? String(l.tiers_id) : '',
        activite_id: l.activite_id ? String(l.activite_id) : '', debit: Number(l.debit) ? String(Number(l.debit)).replace('.', ',') : '', credit: Number(l.credit) ? String(Number(l.credit)).replace('.', ',') : '' })),
    });
  };
  const action = async (fn, succes) => {
    setEnCours(true);
    const r = await fn();
    setEnCours(false);
    if (r?.error) { toast(r.error, 'error'); return null; }
    toast(succes(r), 'success');
    charger();
    return r;
  };
  const valider = async (e) => {
    const r = await action(() => api.post(`/comptabilite/ecritures/${e.id}/valider`, {}), (x) => `Écriture validée sous le n° ${x.numero} du journal ${e.journal_code}.`);
    if (r) ouvrir(e.id);
  };
  const supprimer = async (e) => {
    if (!window.confirm('Supprimer définitivement ce brouillard ?')) return;
    const r = await action(() => api.delete(`/comptabilite/ecritures/${e.id}`), () => 'Brouillard supprimé.');
    if (r) setDetail(null);
  };
  const extourner = async () => {
    const r = await action(() => api.post(`/comptabilite/ecritures/${extourne.id}/extourner`, { date_ecriture: extourne.date, motif: extourne.motif }), () => 'Extourne passée et validée.');
    if (r) { setExtourne(null); ouvrir(r.id); }
  };

  const exporter = () => {
    if (!donnees?.ecritures?.length) return;
    exporterExcel(`Ecritures_${exercices.find((x) => String(x.id) === exerciceId)?.code || ''}`,
      ['Date', 'Journal', 'N°', 'Pièce', 'Libellé', 'Débit', 'Crédit', 'Statut'],
      donnees.ecritures.map((e) => [String(e.date_ecriture).slice(0, 10), e.journal_code, e.numero_affiche || '', e.reference_piece, e.libelle,
        Number(e.total_debit), Number(e.total_credit), e.extournee_par_id ? 'Extournée' : e.statut]));
  };

  if (errEx) return <div className="cm-page"><Erreur message={errEx} /></div>;
  if (!exercices) return <div className="loading-msg">Chargement…</div>;
  if (!exercices.length) return <div className="cm-page"><SansExercice peutParametrer={can('compta.parametrage')} /></div>;

  const set = (k) => (e) => setFiltres((f) => ({ ...f, [k]: e.target.value }));
  return (
    <div className="cm-page fin-page">
      <div className="cm-entete">
        <div>
          <h2>Écritures comptables</h2>
          <p>Partie double SYSCOHADA. Une écriture validée reçoit son numéro définitif et ne se modifie plus : elle se corrige par une extourne.</p>
        </div>
        <div className="cm-actions">
          <button type="button" className="cm-btn cm-secondaire" onClick={exporter} disabled={!donnees?.ecritures?.length}>Exporter</button>
          {saisit && <button type="button" className="cm-btn cm-primaire" onClick={nouveau} disabled={!ref?.journaux?.length}
            title={ref?.journaux?.length ? '' : 'Créez d\'abord les journaux comptables (Paramétrage)'}>+ Nouvelle écriture</button>}
        </div>
      </div>

      <div className="fin-filtres">
        <select aria-label="Exercice" value={exerciceId} onChange={(e) => setExerciceId(e.target.value)}>
          {exercices.map((x) => <option key={x.id} value={x.id}>Exercice {x.code}</option>)}
        </select>
        <select aria-label="Journal" value={filtres.journal_id} onChange={set('journal_id')}>
          <option value="">Tous les journaux</option>
          {(ref?.journaux || []).map((j) => <option key={j.id} value={j.id}>{j.code} — {j.intitule}</option>)}
        </select>
        <select aria-label="Statut" value={filtres.statut} onChange={set('statut')}>
          <option value="">Tous les statuts</option><option value="brouillard">Brouillard</option><option value="validee">Validées</option>
        </select>
        <input type="date" aria-label="Du" value={filtres.date_du} onChange={set('date_du')} />
        <input type="date" aria-label="Au" value={filtres.date_au} onChange={set('date_au')} />
        <input type="search" className="fin-recherche" placeholder="Libellé, pièce, compte…" value={filtres.recherche} onChange={set('recherche')} />
      </div>

      <Erreur message={erreur} />
      {donnees && (
        <>
          {donnees.nb_brouillard > 0 && !filtres.statut && (
            <div className="fin-bandeau">
              <b>{donnees.nb_brouillard}</b> écriture(s) au brouillard : elles n'entrent dans les états qu'une fois validées.
              <button type="button" className="fin-lien" onClick={() => setFiltres((f) => ({ ...f, statut: 'brouillard' }))}>Les afficher</button>
            </div>
          )}
          {donnees.ecritures.length === 0 ? (
            <div className="fin-vide">
              <div className="fin-vide-icone" aria-hidden="true">🧾</div>
              <h3>Aucune écriture</h3>
              <p>{saisit ? 'Saisissez une opération diverse ou les à-nouveaux d\'ouverture avec « Nouvelle écriture ».' : 'Aucune écriture ne correspond à ces critères.'}</p>
            </div>
          ) : (
            <div className="cm-table-wrap">
              <table className="cm-table fin-table">
                <thead>
                  <tr><th>Date</th><th>Journal</th><th>N°</th><th>Pièce</th><th>Libellé</th><th className="fin-num">Débit</th><th className="fin-num">Crédit</th><th>Statut</th></tr>
                </thead>
                <tbody>
                  {donnees.ecritures.map((e) => (
                    <tr key={e.id} className="cm-cliquable" tabIndex={0} onClick={() => ouvrir(e.id)} onKeyDown={(k) => { if (k.key === 'Enter') ouvrir(e.id); }}>
                      <td>{fmtDate(e.date_ecriture)}</td>
                      <td><span className="cm-code">{e.journal_code}</span></td>
                      <td className="fin-mono">{e.numero_affiche || <span className="cm-sous">—</span>}</td>
                      <td>{e.reference_piece || '—'}</td>
                      <td className="fin-libelle">{e.libelle}{!e.equilibree && e.statut === 'brouillard' && <span className="fin-alerte-inline" title="Débit et crédit différents">⚠ déséquilibrée</span>}</td>
                      <td className="fin-num">{fmtCompta(e.total_debit, { zero: '0' })}</td>
                      <td className="fin-num">{fmtCompta(e.total_credit, { zero: '0' })}</td>
                      <td><BadgeStatut statut={e.statut} extournee={Boolean(e.extournee_par_id)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={donnees.page} taille={donnees.taille} total={donnees.total} onPage={setPage} />
        </>
      )}

      {detail && (
        <Tiroir titre={detail.numero_affiche ? `Écriture ${detail.numero_affiche}` : 'Écriture au brouillard'}
          sousTitre={`${detail.journal_code} — ${detail.journal_intitule} · ${fmtDate(detail.date_ecriture)}`}
          onFermer={() => setDetail(null)}
          pied={<>
            {detail.statut === 'brouillard' && detail.origine_type === 'manuelle' && saisit && <>
              <button type="button" className="cm-btn cm-danger" disabled={enCours} onClick={() => supprimer(detail)}>Supprimer</button>
              <button type="button" className="cm-btn cm-secondaire" onClick={() => modifier(detail)}>Modifier</button>
            </>}
            {detail.statut === 'brouillard' && valide && (
              <button type="button" className="cm-btn cm-primaire" disabled={enCours || !detail.equilibree || String(detail.cree_par) === String(user?.id)}
                title={String(detail.cree_par) === String(user?.id) ? 'Personne ne valide sa propre écriture' : (!detail.equilibree ? 'Écriture déséquilibrée' : '')}
                onClick={() => valider(detail)}>Valider</button>
            )}
            {detail.statut === 'validee' && valide && !detail.extournee_par && detail.origine_type !== 'extourne' && (
              <button type="button" className="cm-btn cm-secondaire" onClick={() => setExtourne({ id: detail.id, date: aujourdhui(), motif: '' })}>Extourner</button>
            )}
          </>}>
          <div className="fin-detail-entete">
            <div><span>Statut</span><BadgeStatut statut={detail.statut} extournee={Boolean(detail.extournee_par)} /></div>
            <div><span>Pièce</span><b>{detail.reference_piece || '—'}</b></div>
            <div><span>Saisie</span><b>{detail.cree_par_nom || '—'}</b></div>
            <div><span>Validation</span><b>{detail.valide_par_nom ? `${detail.valide_par_nom} · ${fmtDate(detail.valide_le)}` : '—'}</b></div>
          </div>
          <p className="fin-detail-libelle">{detail.libelle}</p>
          {detail.extourne_de && <div className="fin-bandeau">Extourne de l'écriture <b>{detail.extourne_de.numero_affiche}</b>. Motif : {detail.motif_extourne}</div>}
          {detail.extournee_par && <div className="fin-bandeau fin-bandeau-gris">Écriture annulée par l'extourne <b>{detail.extournee_par.numero_affiche}</b> du {fmtDate(detail.extournee_par.date_ecriture)}.</div>}
          {detail.statut === 'brouillard' && String(detail.cree_par) === String(user?.id) && valide && (
            <div className="fin-bandeau fin-bandeau-gris">Vous avez saisi cette écriture : un autre utilisateur habilité doit la valider.</div>
          )}
          <div className="cm-table-wrap">
            <table className="cm-table fin-table fin-lignes">
              <thead><tr><th>Compte</th><th>Libellé</th><th>Tiers / activité</th><th className="fin-num">Débit</th><th className="fin-num">Crédit</th></tr></thead>
              <tbody>
                {detail.lignes.map((l) => (
                  <tr key={l.id}>
                    <td><b className="fin-mono">{l.compte}</b><div className="cm-sous">{l.compte_intitule}</div></td>
                    <td>{l.libelle || '—'}</td>
                    <td>{[l.tiers_nom, l.activite_nom].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="fin-num">{fmtCompta(l.debit)}</td>
                    <td className="fin-num">{fmtCompta(l.credit)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={3}>Totaux</td><td className="fin-num">{fmtCompta(detail.total_debit, { zero: '0' })}</td><td className="fin-num">{fmtCompta(detail.total_credit, { zero: '0' })}</td></tr></tfoot>
            </table>
          </div>
        </Tiroir>
      )}

      {form && <FormulaireEcriture form={form} setForm={setForm} ref_={ref} onFermer={() => setForm(null)}
        onEnregistre={(id) => { setForm(null); charger(); ouvrir(id); }} />}

      {extourne && (
        <Tiroir titre="Extourner l'écriture" sousTitre="Une écriture inverse, liée et validée, annule l'écriture d'origine" onFermer={() => setExtourne(null)}
          pied={<>
            <button type="button" className="cm-btn cm-secondaire" onClick={() => setExtourne(null)}>Annuler</button>
            <button type="button" className="cm-btn cm-primaire" disabled={enCours || extourne.motif.trim().length < 5} onClick={extourner}>Passer l'extourne</button>
          </>}>
          <div className="cm-grille">
            <Champ label="Date de l'extourne" requis id="x-date"><input id="x-date" type="date" value={extourne.date} onChange={(e) => setExtourne({ ...extourne, date: e.target.value })} /></Champ>
            <div />
            <Champ label="Motif" requis pleine id="x-motif" aide="Conservé avec l'écriture (5 caractères au moins)">
              <textarea id="x-motif" rows={3} maxLength={500} value={extourne.motif} onChange={(e) => setExtourne({ ...extourne, motif: e.target.value })} />
            </Champ>
          </div>
          <p className="cm-note">L'écriture d'origine reste visible, marquée « extournée ». Saisissez ensuite, si besoin, l'écriture correcte.</p>
        </Tiroir>
      )}
    </div>
  );
}

function FormulaireEcriture({ form, setForm, ref_, onFermer, onEnregistre }) {
  const toast = useToast();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setLigne = (i, patch) => setForm((f) => ({ ...f, lignes: f.lignes.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const totaux = useMemo(() => {
    let d = 0; let c = 0; let invalide = false;
    for (const l of form.lignes) {
      const ld = lireMontant(l.debit); const lc = lireMontant(l.credit);
      if (Number.isNaN(ld) || Number.isNaN(lc)) invalide = true; else { d += centimes(ld); c += centimes(lc); }
    }
    return { d, c, ecart: d - c, invalide };
  }, [form.lignes]);
  const journal = ref_?.journaux?.find((j) => String(j.id) === String(form.journal_id));

  const equilibrer = (i) => {
    const l = form.lignes[i];
    const sans = totaux.ecart + centimes(lireMontant(l.credit) || 0) - centimes(lireMontant(l.debit) || 0);
    if (sans > 0) setLigne(i, { credit: String(sans / 100).replace('.', ','), debit: '' });
    else if (sans < 0) setLigne(i, { debit: String(-sans / 100).replace('.', ','), credit: '' });
  };
  const enregistrer = async () => {
    setErreur('');
    const lignes = form.lignes.filter((l) => l.compte || l.debit || l.credit);
    const corps = {
      journal_id: form.journal_id, date_ecriture: form.date_ecriture, reference_piece: form.reference_piece, libelle: form.libelle,
      lignes: lignes.map((l) => ({ compte: l.compte, libelle: l.libelle, tiers_id: l.tiers_id || null, activite_id: l.activite_id || null,
        debit: lireMontant(l.debit) || 0, credit: lireMontant(l.credit) || 0 })),
    };
    setEnCours(true);
    const r = form.id ? await api.put(`/comptabilite/ecritures/${form.id}`, corps) : await api.post('/comptabilite/ecritures', corps);
    setEnCours(false);
    if (r?.error) { setErreur(r.error); return; }
    toast(totaux.ecart === 0 ? 'Écriture enregistrée au brouillard.' : 'Brouillard enregistré : il reste déséquilibré et ne pourra pas être validé en l\'état.', totaux.ecart === 0 ? 'success' : 'warning');
    onEnregistre(r.id || form.id);
  };
  const tiersExige = (c) => c.startsWith('40') || c.startsWith('41');

  return (
    <Tiroir titre={form.id ? 'Modifier le brouillard' : 'Nouvelle écriture'} sousTitre="Enregistrée au brouillard ; un autre utilisateur la valide" onFermer={onFermer}
      pied={<>
        <div className={'fin-equilibre' + (totaux.ecart === 0 && totaux.d > 0 ? ' ok' : '')}>
          Débit {fmtCompta(totaux.d / 100, { zero: '0' })} · Crédit {fmtCompta(totaux.c / 100, { zero: '0' })}
          {totaux.ecart !== 0 && <b> · Écart {fmtCompta(Math.abs(totaux.ecart) / 100)}</b>}
          {totaux.ecart === 0 && totaux.d > 0 && <b> · Équilibrée ✓</b>}
        </div>
        <button type="button" className="cm-btn cm-secondaire" onClick={onFermer}>Annuler</button>
        <button type="button" className="cm-btn cm-primaire" disabled={enCours || totaux.invalide} onClick={enregistrer}>Enregistrer</button>
      </>}>
      <div className="fin-form-entete">
        <Champ label="Journal" requis id="e-j">
          <select id="e-j" value={form.journal_id} onChange={set('journal_id')}>
            {(ref_?.journaux || []).map((j) => <option key={j.id} value={j.id}>{j.code} — {j.intitule}</option>)}
          </select>
        </Champ>
        <Champ label="Date" requis id="e-d"><input id="e-d" type="date" value={form.date_ecriture} onChange={set('date_ecriture')} /></Champ>
        <Champ label="N° de pièce" id="e-p"><input id="e-p" value={form.reference_piece} maxLength={60} onChange={set('reference_piece')} /></Champ>
        <Champ label="Libellé" requis pleine id="e-l"><input id="e-l" value={form.libelle} maxLength={300} onChange={set('libelle')} placeholder={journal?.type === 'an' ? 'À-nouveaux d\'ouverture' : 'Objet de l\'opération'} /></Champ>
      </div>
      <Erreur message={erreur} />
      <div className="fin-saisie">
        <div className="fin-saisie-tete"><span>Compte</span><span>Libellé de ligne</span><span>Tiers</span><span>Activité</span><span className="fin-num">Débit</span><span className="fin-num">Crédit</span><span /></div>
        {form.lignes.map((l, i) => (
          <div key={l.cle} className="fin-saisie-ligne">
            <div>
              <ChampCompte valeur={l.compte} onChange={(compte, c) => setLigne(i, { compte, intitule: c?.intitule || (compte === l.compte ? l.intitule : '') })} />
              {l.intitule && <div className="fin-intitule" title={l.intitule}>{l.intitule}</div>}
            </div>
            <input value={l.libelle} maxLength={300} placeholder={form.libelle || 'Libellé'} aria-label="Libellé de ligne" onChange={(e) => setLigne(i, { libelle: e.target.value })} />
            <select value={l.tiers_id} aria-label="Tiers" className={tiersExige(l.compte) && !l.tiers_id ? 'fin-requis' : ''} onChange={(e) => setLigne(i, { tiers_id: e.target.value })}>
              <option value="">{tiersExige(l.compte) ? 'Tiers obligatoire…' : '—'}</option>
              {(ref_?.tiers || []).map((t) => <option key={t.id} value={t.id}>{t.nom}</option>)}
            </select>
            <select value={l.activite_id} aria-label="Activité" onChange={(e) => setLigne(i, { activite_id: e.target.value })}>
              <option value="">—</option>
              {(ref_?.activites || []).map((a) => <option key={a.id} value={a.id}>{a.nom}</option>)}
            </select>
            <input className="fin-num" inputMode="decimal" value={l.debit} aria-label="Débit" onChange={(e) => setLigne(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} />
            <input className="fin-num" inputMode="decimal" value={l.credit} aria-label="Crédit" onChange={(e) => setLigne(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} />
            <div className="fin-saisie-outils">
              {totaux.ecart !== 0 && <button type="button" title="Équilibrer avec cette ligne" onClick={() => equilibrer(i)}>⚖</button>}
              <button type="button" title="Retirer la ligne" disabled={form.lignes.length <= 2}
                onClick={() => setForm((f) => ({ ...f, lignes: f.lignes.filter((_, j) => j !== i) }))}>✕</button>
            </div>
          </div>
        ))}
        <button type="button" className="fin-lien" onClick={() => setForm((f) => ({ ...f, lignes: [...f.lignes, ligneVide()] }))}>+ Ajouter une ligne</button>
      </div>
      <p className="cm-note">Comptes de détail uniquement. Les comptes 40 (fournisseurs) et 41 (clients) exigent un tiers. Un brouillard déséquilibré peut être enregistré, mais pas validé.</p>
    </Tiroir>
  );
}
