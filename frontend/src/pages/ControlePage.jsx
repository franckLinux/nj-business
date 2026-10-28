import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { MOIS } from '@/lib/format';
import { exporterExcel } from '@/lib/export';
import { printRapportControle } from '@/lib/print';
import PanneauControle, { editionDe, brouillonModifie, corpsDe } from '@/components/PanneauControle';
import { STATUTS } from '@/components/LigneControle';
import RapportControle from '@/components/RapportControle';
import RegulariteFormelle from '@/components/RegulariteFormelle';
import { ModaleValidation, ModaleReouverture, ModaleAnomalies } from '@/components/ControleRegularite';

// Contrôle comptable (migrations 042-044) — menu Contrôle comptable →
// « Rapport ». Le rapport est le SEUL point d'accès au contrôle : un clic sur
// une opération ouvre sa fiche (tiroir à droite) où le comptable corrige le
// code comptable et saisit son observation. Le contrôle est enregistré à
// part : l'écriture de caisse n'est jamais modifiée et la passerelle n'est
// jamais déclenchée par la consultation.
// 045 : sous-onglet « Contrôle de régularité formelle » (pièces par journal,
// colonne « Contrôle », « Confirmer la validation »).
// 25/10/2026 : une seule entrée de menu, « Contrôle de régularité formelle »
// (/controle/regularite). Le rapport (/controle/pieces) s'ouvre par le bouton
// « Rapport » de la page ; un second clic revient au contrôle.
const ROUTES = { rapport: '/controle/pieces', regularite: '/controle/regularite' };
const dateFr = (d) => (d ? d.split('-').reverse().join('/') : '');
const bornesMois = (mois, annee) => {
  const i = Math.max(0, MOIS.indexOf(mois));
  const fin = new Date(Date.UTC(annee, i + 1, 0)).getUTCDate();
  return { du: `${annee}-${String(i + 1).padStart(2, '0')}-01`, au: `${annee}-${String(i + 1).padStart(2, '0')}-${fin}` };
};
const estChamp = (el) => el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);

export default function ControlePage() {
  const { mois, annee, can, devise, journauxGrouped, entite, user } = useApp();
  const toast = useToast();
  const peutSaisir = can('controle.saisir');
  const peutCorriger = can('controle.compte');
  const peutExporter = can('rapport.export');
  const peutRouvrir = can('controle.reouvrir');
  const location = useLocation();
  const navigate = useNavigate();
  const onglet = location.pathname.startsWith(ROUTES.regularite) ? 'regularite' : 'rapport';
  const changerOnglet = (o) => { if (o !== onglet) navigate(ROUTES[o]); };
  const [jSel, setJSel] = useState('');          // journal du sous-onglet régularité formelle
  const [modale, setModale] = useState(null);    // { type: 'valider' | 'rouvrir' | 'anomalies', id }
  const journaux = useMemo(() => Object.values(journauxGrouped || {}).flat().sort((a, b) => String(a.code).localeCompare(String(b.code))), [journauxGrouped]);

  const [f, setF] = useState(() => ({ ...bornesMois(mois, annee), journal_id: '', statut: '', anomalies: '', tiers: '', q: '', ref: '' }));
  const [data, setData] = useState(null);
  const [erreur, setErreur] = useState('');
  const [tiers, setTiers] = useState([]);
  const [selId, setSelId] = useState(null);
  const [ordre, setOrdre] = useState([]);       // opérations visibles dans le détail, dans l'ordre
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  // Le mois choisi en haut de l'écran redéfinit la période.
  useEffect(() => { setF((x) => ({ ...x, ...bornesMois(mois, annee) })); }, [mois, annee]);

  const charger = useCallback(async () => {
    // Régularité formelle : toutes les pièces de la période, séparées ensuite par journal.
    const qs = new URLSearchParams(Object.entries(f).filter(([k, v]) => v !== '' && !(onglet === 'regularite' && k === 'journal_id')));
    const r = await api.get(`/controle/pieces?${qs}`);
    if (r.error) { setErreur(r.error); setData(null); return; }
    setErreur(''); setData(r);
  }, [f, onglet]);
  useEffect(() => { const t = setTimeout(charger, 250); return () => clearTimeout(t); }, [charger]);
  const chargerTiers = useCallback(() => { api.get('/controle/tiers').then((r) => { if (Array.isArray(r)) setTiers(r); }); }, []);
  useEffect(() => { chargerTiers(); }, [chargerTiers]);

  const lignes = data?.lignes || [];
  const sel = lignes.find((x) => x.id === selId) || null;
  const idx = sel ? ordre.indexOf(sel.id) : -1;
  const modifie = (peutSaisir || peutCorriger) && brouillonModifie(sel, draft);

  // Opération sortie de la liste après un filtre : la fiche se ferme.
  useEffect(() => { if (selId && data && !sel) { setSelId(null); setDraft(null); } }, [data]);   // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  // Opération enregistrée : mise à jour sur place (liste + compteurs).
  const majLigne = (piece) => setData((d) => {
    if (!d) return d;
    const ls = d.lignes.map((x) => (x.id === piece.id ? piece : x));
    const resume = { ...d.resume, par_statut: {}, par_anomalie: {}, avec_anomalies: 0 };
    Object.keys(STATUTS).forEach((k) => { resume.par_statut[k] = 0; });
    ls.forEach((x) => {
      resume.par_statut[x.statut] += 1;
      if (x.anomalies.length) resume.avec_anomalies += 1;
      x.anomalies.forEach((a) => { resume.par_anomalie[a] = (resume.par_anomalie[a] || 0) + 1; });
    });
    return { ...d, lignes: ls, resume };
  });

  // statut null = enregistrement simple : « Contrôlé » repasse « En cours »
  // (l'opération a changé), « Anomalie » reste « Anomalie ».
  const enregistrer = async (statut, { suivante = false, silencieux = false } = {}) => {
    if (!sel || !draft || saving) return false;
    if (statut === 'anomalie' && !String(draft.observation || '').trim()) {
      toast('Décrivez l\'anomalie dans « Observation » avant de la signaler.', 'warning', 6000);
      document.querySelector('.ctl-fiche textarea')?.focus();
      return false;
    }
    const corps = corpsDe(sel, draft);
    if (!peutCorriger) delete corps.compte_corrige;
    const s = statut || (sel.statut === 'anomalie' ? 'anomalie' : 'en_cours');
    setSaving(true);
    const r = await api.put(`/controle/pieces/${sel.id}`, { ...corps, statut: s });
    setSaving(false);
    if (r.error) { toast(r.error, 'error', 9000); return false; }
    majLigne(r.piece);
    if (draft.ajouter_registre) chargerTiers();
    if (r.avertissement) toast(`Enregistré, avec un avertissement : ${r.avertissement}`, 'warning', 9000);
    else if (!silencieux) toast(r.message || 'Contrôle enregistré ✓', 'success', 2500);
    if (suivante) {
      const ids = ordre.length ? ordre : lignes.map((x) => x.id);
      const pos = ids.indexOf(sel.id);
      const apres = [...ids.slice(pos + 1), ...ids.slice(0, Math.max(0, pos))]
        .map((id) => lignes.find((x) => x.id === id)).find((x) => x && x.statut !== 'controle' && x.id !== sel.id);
      if (apres) { setSelId(apres.id); setDraft(editionDe(apres)); return true; }
      toast('Toutes les opérations de la vue sont contrôlées ✓', 'success', 4000);
    }
    setDraft(editionDe(r.piece));
    return true;
  };

  // Ouvrir une opération : les modifications en cours sont enregistrées d'abord.
  const ouvrir = async (id, ids) => {
    if (ids) setOrdre(ids);
    if (id === selId) return;
    if (modifie && !(await enregistrer(null, { silencieux: true }))) return;
    const p = lignes.find((x) => x.id === id);
    setSelId(id); setDraft(p ? editionDe(p) : null);
  };
  // Pièce mise à jour par une action de régularité formelle (anomalie, validation, réouverture).
  const appliquer = (piece) => {
    majLigne(piece);
    if (sel && piece.id === sel.id && !modifie) setDraft(editionDe(piece));
  };
  const ligneModale = modale ? lignes.find((x) => x.id === modale.id) : null;

  const fermer = async () => {
    if (modifie && !(await enregistrer(null, { silencieux: true }))) return;
    setSelId(null); setDraft(null);
  };
  const deplacer = (pas) => { if (idx >= 0 && ordre[idx + pas]) ouvrir(ordre[idx + pas]); };

  // Clavier (fiche ouverte) : ↑ / ↓ hors des champs, Ctrl + Entrée pour enregistrer, Échap pour fermer.
  useEffect(() => {
    if (!sel || modale) return undefined;
    const h = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); enregistrer(null); return; }
      if (e.key === 'Escape') { e.preventDefault(); if (modale) setModale(null); else fermer(); return; }
      if (estChamp(document.activeElement)) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); deplacer(1); }
      if (e.key === 'ArrowUp') { e.preventDefault(); deplacer(-1); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const libFiltres = () => {
    const j = journaux.find((x) => String(x.id) === String(f.journal_id));
    return [
      `période du ${dateFr(f.du)} au ${dateFr(f.au)}`,
      j ? `journal ${j.code} – ${j.nom}` : 'tous les journaux',
      f.statut ? `statut « ${STATUTS[f.statut].lib} »` : null,
      f.anomalies === '1' ? 'opérations avec anomalies' : f.anomalies === '0' ? 'opérations sans anomalie' : null,
      f.tiers ? `tiers « ${f.tiers} »` : null,
      f.q ? `recherche « ${f.q} »` : null,
      f.ref ? `référence « ${f.ref} »` : null,
    ].filter(Boolean).join(' · ');
  };
  const exporter = () => exporterExcel(`Rapport_controle_${f.du}_${f.au}`,
    ['Date', 'N° pièce', 'Journal', 'Code comptable', 'État du code', 'Compte de la rubrique', 'Contrepartie (trésorerie)', 'NUI', 'Tiers', 'Compte tiers',
      'Au registre', 'Libellé', 'Débit', 'Crédit', 'Observation', 'Anomalies', 'Statut', 'Validée par', 'Validée le', 'Anomalies constatées (saisies)'],
    data.lignes.map((l) => [dateFr(l.date), l.reference, l.journal_code, l.compte,
      { valide: 'validé', non_valide: 'non validé', manquant: 'manquant', corrige: 'corrigé au contrôle' }[l.compte_etat],
      l.compte_rubrique, l.compte_tresorerie, l.tiers_nui, l.tiers_nom,
      l.compte_tiers ? `${l.compte_tiers}${l.compte_tiers_source === 'collectif' ? ' (collectif)' : ''}` : '',
      l.registre ? (l.registre.verifie ? 'oui, vérifié' : 'oui') : 'non', l.libelle, l.debit, l.credit,
      l.observation, l.anomalies_libelles.join(' ; '), l.statut_libelle,
      l.statut === 'controle' ? (l.controle_par || '') : '', l.statut === 'controle' && l.controle_le ? new Date(l.controle_le).toLocaleDateString('fr-FR') : '',
      (l.anomalies_saisies || []).map((a) => `${a.statut === 'levee' ? '[levée] ' : a.bloquante ? '[bloquante] ' : ''}${a.libelle}`).join(' ; ')]),
    [entite?.nom || '', 'Rapport de contrôle comptable', libFiltres()]);

  const r = data?.resume;
  return (
    <div>
      <datalist id="ctl-tiers-nui">{tiers.filter((t) => t.nui).map((t) => <option key={`${t.source}|${t.nui}|${t.nom}`} value={t.nui}>{t.nom}{t.source === 'registre' ? ' — registre' : ''}</option>)}</datalist>
      <datalist id="ctl-tiers-nom">{[...new Set(tiers.map((t) => t.nom))].map((n) => <option key={n} value={n} />)}</datalist>

      {/* Filtres du rapport (le titre est déjà dans la barre du haut). */}
      {/* 25/10/2026 : la page s'ouvre sur le contrôle de régularité formelle ;
          seul le bouton « Rapport » reste (il affiche / masque la synthèse). */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <button type="button" aria-pressed={onglet === 'rapport'} className={`ctl-btn${onglet === 'rapport' ? ' on' : ''}`}
          onClick={() => changerOnglet(onglet === 'rapport' ? 'regularite' : 'rapport')}
          title={onglet === 'rapport' ? 'Revenir au contrôle de substance' : 'Afficher le rapport de contrôle'}>
          📄 Rapport
        </button>
      </div>
      <div className="ctl-barre">
        {onglet === 'rapport' && <div className="ctl-f" style={{ flex: '1 1 160px' }}><label htmlFor="ctl-j">Journal</label>
          <select id="ctl-j" className="ctl-in" value={f.journal_id} onChange={set('journal_id')}>
            <option value="">Tous les journaux</option>
            {journaux.map((j) => <option key={j.id} value={j.id}>{j.code} – {j.nom}</option>)}
          </select></div>}
        <div className="ctl-f" style={{ flex: '0 1 145px' }}><label htmlFor="ctl-du">Du</label><input id="ctl-du" type="date" className="ctl-in" value={f.du} onChange={set('du')} /></div>
        <div className="ctl-f" style={{ flex: '0 1 145px' }}><label htmlFor="ctl-au">Au</label><input id="ctl-au" type="date" className="ctl-in" value={f.au} onChange={set('au')} /></div>
        <div className="ctl-f" style={{ flex: '0 1 150px' }}><label htmlFor="ctl-s">Statut</label>
          <select id="ctl-s" className="ctl-in" value={f.statut} onChange={set('statut')}>
            <option value="">Tous</option>
            {Object.entries(STATUTS).map(([k, v]) => <option key={k} value={k}>{v.lib}{r ? ` (${r.par_statut[k]})` : ''}</option>)}
          </select></div>
        <div className="ctl-f" style={{ flex: '0 1 130px' }}><label htmlFor="ctl-r">Référence</label><input id="ctl-r" className="ctl-in" value={f.ref} onChange={set('ref')} placeholder="Ex. CS1-12" /></div>
        <div className="ctl-f" style={{ flex: '1 1 150px' }}><label htmlFor="ctl-t">Fournisseur / client</label><input id="ctl-t" className="ctl-in" value={f.tiers} onChange={set('tiers')} placeholder="Nom ou NUI" /></div>
        <div className="ctl-f" style={{ flex: '1 1 150px' }}><label htmlFor="ctl-q">Recherche</label><input id="ctl-q" className="ctl-in" value={f.q} onChange={set('q')} placeholder="N° pièce, libellé, compte…" /></div>
        <Link to="/controle/registre" className="ctl-btn" style={{ textDecoration: 'none', marginLeft: 'auto' }} title="Registre bénéficiaires Payés/Encaissés">📒 Registre des bénéficiaires</Link>
      </div>

      {erreur && <div className="alert-err" style={{ marginBottom: 12 }}>{erreur}</div>}
      {!data && !erreur && <div className="loading-msg">Chargement…</div>}

      {data && (
        <>
          {data.tronque && <div className="alert-err" style={{ marginBottom: 10 }}>Plus de {data.max_lignes} opérations : réduisez la période ou filtrez par journal.</div>}
          {onglet === 'rapport' ? (
            <RapportControle data={data} devise={devise} libFiltres={libFiltres()} entite={entite} peutExporter={peutExporter} onExcel={exporter}
              selId={selId} onOuvrir={ouvrir}
              onImprimer={() => { if (!printRapportControle({ data, filtres: libFiltres(), entite, tenantNom: user?.tenantNom, devise })) toast('Autorisez les fenêtres surgissantes pour imprimer.', 'error'); }} />
          ) : (
            <RegulariteFormelle lignes={lignes} journaux={journaux} jSel={jSel} setJSel={setJSel} devise={devise}
              peutSaisir={peutSaisir} peutRouvrir={peutRouvrir} selId={selId} onOuvrir={ouvrir}
              onAnomalies={(id) => setModale({ type: 'anomalies', id })}
              onValider={(id) => setModale({ type: 'valider', id })}
              onRouvrir={(id) => setModale({ type: 'rouvrir', id })} />
          )}
          {sel && draft && (
            <>
              <div className="ctl-voile on" onClick={fermer} />
              <PanneauControle key={sel.id} l={sel} draft={draft} setDraft={setDraft} tiers={tiers} devise={devise}
                peutSaisir={peutSaisir} peutCorriger={peutCorriger} peutRouvrir={peutRouvrir} saving={saving} modifie={modifie}
                onMaj={appliquer}
                onValider={async () => { if (modifie && !(await enregistrer(null, { silencieux: true }))) return; setModale({ type: 'valider', id: sel.id }); }}
                onRouvrir={() => setModale({ type: 'rouvrir', id: sel.id })}
                onEnregistrer={enregistrer} onPrecedent={() => deplacer(-1)} onSuivant={() => deplacer(1)}
                position={idx >= 0 ? `${idx + 1} / ${ordre.length}` : ''} ouverte onFermer={fermer} />
            </>
          )}
          {ligneModale && modale.type === 'valider' && (
            <ModaleValidation l={ligneModale} devise={devise} onFermer={() => setModale(null)}
              onValidee={(p) => { appliquer(p); setModale(null); }} />
          )}
          {ligneModale && modale.type === 'rouvrir' && (
            <ModaleReouverture l={ligneModale} onFermer={() => setModale(null)} onRouverte={(p) => { appliquer(p); setModale(null); }} />
          )}
          {ligneModale && modale.type === 'anomalies' && (
            <ModaleAnomalies l={ligneModale} peutSaisir={peutSaisir} onFermer={() => setModale(null)} onMaj={appliquer} />
          )}
        </>
      )}
    </div>
  );
}
