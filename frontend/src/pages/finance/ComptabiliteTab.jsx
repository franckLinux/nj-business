// NJ FINANCE — Configuration → Comptabilité (lot F2) : exercices, périodes,
// journaux comptables. Les règles sont garanties côté serveur (migration 075).
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { Champ, Tiroir } from '@/components/commercial/ui';
import { BadgeStatut, Erreur, fmtDate } from './commun';

const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const libellePeriode = (p) => {
  const d = new Date(`${String(p.date_debut).slice(0, 10)}T00:00:00`);
  return `${MOIS_COURTS[d.getMonth()]} ${d.getFullYear()}`;
};
const STATUT_PERIODE = { ouverte: 'Ouverte', verrouillee: 'Verrouillée', cloturee: 'Clôturée' };
const TYPES = { an: 'À-nouveaux', od: 'Opérations diverses', achats: 'Achats', ventes: 'Ventes', tresorerie: 'Trésorerie', inventaire: 'Inventaire' };

export default function ComptabiliteTab() {
  const { can } = useApp();
  const toast = useToast();
  const gere = can('finance.config.comptabilite');
  const verrouille = can('finance.periodes.verrouiller');
  const [exercices, setExercices] = useState(null);
  const [journaux, setJournaux] = useState(null);
  const [erreur, setErreur] = useState('');
  const [ouvert, setOuvert] = useState(null);
  const [formEx, setFormEx] = useState(null);
  const [formJ, setFormJ] = useState(null);
  const [enCours, setEnCours] = useState(false);

  const charger = useCallback(async () => {
    const [e, j] = await Promise.all([api.get('/finance/exercices'), api.get('/finance/journaux-comptables')]);
    if (e?.error || j?.error) { setErreur(e?.error || j?.error); return; }
    setErreur(''); setExercices(e); setJournaux(j);
    setOuvert((o) => o ?? e[0]?.id ?? null);
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const nouvelExercice = async () => {
    const p = await api.get('/finance/exercices/proposition');
    if (p?.error) { toast(p.error, 'error'); return; }
    setFormEx(p);
  };
  const creerExercice = async () => {
    setEnCours(true);
    const r = await api.post('/finance/exercices', formEx);
    setEnCours(false);
    if (r?.error) { toast(r.error, 'error'); return; }
    toast(`Exercice ${formEx.code} créé (${r.nb_periodes} périodes).`, 'success');
    setFormEx(null); setOuvert(r.id); charger();
  };
  const changerPeriode = async (p, statut) => {
    if (statut === 'verrouillee' && p.nb_brouillard > 0
      && !window.confirm(`${p.nb_brouillard} écriture(s) au brouillard sur ${libellePeriode(p)} : elles ne pourront plus être ni modifiées ni validées tant que la période sera verrouillée. Verrouiller quand même ?`)) return;
    const r = await api.put(`/finance/periodes/${p.id}/statut`, { statut });
    if (r?.error) { toast(r.error, 'error'); return; }
    toast(`${libellePeriode(p)} : période ${statut === 'verrouillee' ? 'verrouillée' : 'rouverte'}.`, 'success');
    charger();
  };
  const initialiser = async () => {
    setEnCours(true);
    const r = await api.post('/finance/journaux-comptables/initialiser', {});
    setEnCours(false);
    if (r?.error) { toast(r.error, 'error'); return; }
    toast(r.crees.length ? `${r.crees.length} journal(aux) créé(s) : ${r.crees.map((x) => x.code).join(', ')}.` : 'Tous les journaux existent déjà.', 'success');
    charger();
  };
  const enregistrerJournal = async () => {
    setEnCours(true);
    const r = formJ.id
      ? await api.put(`/finance/journaux-comptables/${formJ.id}`, { intitule: formJ.intitule, actif: formJ.actif })
      : await api.post('/finance/journaux-comptables', formJ);
    setEnCours(false);
    if (r?.error) { toast(r.error, 'error'); return; }
    toast('Journal enregistré.', 'success');
    setFormJ(null); charger();
  };

  if (erreur) return <Erreur message={erreur} />;
  if (!exercices || !journaux) return <div className="loading-msg">Chargement…</div>;

  return (
    <div className="fin-config">
      <section className="fin-carte">
        <div className="fin-carte-tete">
          <div>
            <h3>Exercices comptables</h3>
            <p>Un exercice est découpé en périodes mensuelles. Une période verrouillée n'accepte plus aucune saisie ni validation ; elle peut être rouverte tant que l'exercice n'est pas clos.</p>
          </div>
          {gere && <button type="button" className="cm-btn cm-primaire" onClick={nouvelExercice}>+ Nouvel exercice</button>}
        </div>
        {exercices.length === 0 ? (
          <div className="fin-vide-court">Aucun exercice. {gere ? 'Créez le premier exercice pour commencer la comptabilité.' : ''}</div>
        ) : exercices.map((e) => (
          <div key={e.id} className={'fin-exercice' + (ouvert === e.id ? ' ouvert' : '')}>
            <button type="button" className="fin-exercice-tete" onClick={() => setOuvert(ouvert === e.id ? null : e.id)} aria-expanded={ouvert === e.id}>
              <span className="fin-exercice-code">{e.code}</span>
              <span>{fmtDate(e.date_debut)} → {fmtDate(e.date_fin)}</span>
              <span className={`fin-badge fin-badge-${e.statut === 'ouvert' ? 'validee' : 'extournee'}`}>{e.statut === 'ouvert' ? 'Ouvert' : 'Clos'}</span>
              <span className="fin-exercice-compteurs">{e.nb_ecritures} écriture(s){e.nb_brouillard ? ` · ${e.nb_brouillard} au brouillard` : ''}</span>
              <span className="fin-chevron" aria-hidden="true">▾</span>
            </button>
            {ouvert === e.id && (
              <div className="fin-periodes">
                {e.periodes.map((p) => (
                  <div key={p.id} className={`fin-periode fin-periode-${p.statut}`}>
                    <div className="fin-periode-nom">{libellePeriode(p)}</div>
                    <div className="fin-periode-etat">
                      <span className={`fin-point fin-point-${p.statut}`} aria-hidden="true" />{STATUT_PERIODE[p.statut]}
                    </div>
                    <div className="fin-periode-det">{p.nb_ecritures} écr.{p.nb_brouillard ? ` · ${p.nb_brouillard} brouill.` : ''}</div>
                    {verrouille && p.statut !== 'cloturee' && (
                      <button type="button" className="fin-lien" onClick={() => changerPeriode(p, p.statut === 'ouverte' ? 'verrouillee' : 'ouverte')}>
                        {p.statut === 'ouverte' ? '🔒 Verrouiller' : '🔓 Rouvrir'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </section>

      <section className="fin-carte">
        <div className="fin-carte-tete">
          <div>
            <h3>Journaux comptables</h3>
            <p>Les journaux de trésorerie sont reliés aux caisses et banques de NJ FINANCE. Un journal qui porte des écritures garde son code et son type.</p>
          </div>
          {gere && (
            <div className="cm-actions">
              <button type="button" className="cm-btn cm-secondaire" disabled={enCours} onClick={initialiser}>Créer les journaux standards</button>
              <button type="button" className="cm-btn cm-primaire" onClick={() => setFormJ({ code: '', intitule: '', type: 'od', actif: true })}>+ Journal</button>
            </div>
          )}
        </div>
        {journaux.length === 0 ? (
          <div className="fin-vide-court">Aucun journal comptable. {gere ? '« Créer les journaux standards » ajoute AN, OD, AC, VT, INV et un journal de trésorerie par caisse.' : ''}</div>
        ) : (
          <div className="cm-table-wrap">
            <table className="cm-table fin-table">
              <thead><tr><th>Code</th><th>Intitulé</th><th>Type</th><th>Caisse liée</th><th className="fin-num">Écritures</th><th>État</th>{gere && <th />}</tr></thead>
              <tbody>
                {journaux.map((j) => (
                  <tr key={j.id}>
                    <td><span className="cm-code">{j.code}</span></td>
                    <td>{j.intitule}</td>
                    <td>{TYPES[j.type] || j.type}</td>
                    <td>{j.caisse_code ? <>{j.caisse_code} — {j.caisse_nom}{j.compte_tresorerie ? <span className="cm-sous"> · compte {j.compte_tresorerie}</span> : ''}</> : '—'}</td>
                    <td className="fin-num">{j.nb_ecritures}</td>
                    <td>{j.actif ? <span className="fin-badge fin-badge-validee">Actif</span> : <span className="fin-badge fin-badge-brouillard">Inactif</span>}</td>
                    {gere && <td><button type="button" className="fin-lien" onClick={() => setFormJ({ ...j })}>Modifier</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {formEx && (
        <Tiroir titre="Nouvel exercice comptable" sousTitre="Les périodes mensuelles sont créées automatiquement" onFermer={() => setFormEx(null)}
          pied={<>
            <button type="button" className="cm-btn cm-secondaire" onClick={() => setFormEx(null)}>Annuler</button>
            <button type="button" className="cm-btn cm-primaire" disabled={enCours} onClick={creerExercice}>Créer l'exercice</button>
          </>}>
          <div className="cm-grille">
            <Champ label="Code" requis id="ex-code" aide="Ex. 2026"><input id="ex-code" value={formEx.code} maxLength={12} onChange={(e) => setFormEx({ ...formEx, code: e.target.value })} /></Champ>
            <div />
            <Champ label="Début" requis id="ex-debut"><input id="ex-debut" type="date" value={formEx.date_debut} onChange={(e) => setFormEx({ ...formEx, date_debut: e.target.value })} /></Champ>
            <Champ label="Fin" requis id="ex-fin"><input id="ex-fin" type="date" value={formEx.date_fin} onChange={(e) => setFormEx({ ...formEx, date_fin: e.target.value })} /></Champ>
          </div>
          <p className="cm-note">Selon l'OHADA, l'exercice dure normalement 12 mois et coïncide avec l'année civile. Les dates proposées reprennent celles de l'entité si elles sont renseignées.</p>
        </Tiroir>
      )}

      {formJ && (
        <Tiroir titre={formJ.id ? `Journal ${formJ.code}` : 'Nouveau journal comptable'} onFermer={() => setFormJ(null)}
          pied={<>
            <button type="button" className="cm-btn cm-secondaire" onClick={() => setFormJ(null)}>Annuler</button>
            <button type="button" className="cm-btn cm-primaire" disabled={enCours} onClick={enregistrerJournal}>Enregistrer</button>
          </>}>
          <div className="cm-grille">
            <Champ label="Code" requis id="j-code" aide="1 à 6 lettres ou chiffres">
              <input id="j-code" value={formJ.code} maxLength={6} disabled={Boolean(formJ.id)} onChange={(e) => setFormJ({ ...formJ, code: e.target.value.toUpperCase() })} />
            </Champ>
            <Champ label="Type" requis id="j-type">
              <select id="j-type" value={formJ.type} disabled={Boolean(formJ.id)} onChange={(e) => setFormJ({ ...formJ, type: e.target.value })}>
                {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Champ>
            <Champ label="Intitulé" requis pleine id="j-int"><input id="j-int" value={formJ.intitule} maxLength={80} onChange={(e) => setFormJ({ ...formJ, intitule: e.target.value })} /></Champ>
            {formJ.id && (
              <Champ label="État" id="j-actif">
                <select id="j-actif" value={formJ.actif ? '1' : '0'} onChange={(e) => setFormJ({ ...formJ, actif: e.target.value === '1' })}>
                  <option value="1">Actif</option><option value="0">Inactif (plus de nouvelle écriture)</option>
                </select>
              </Champ>
            )}
          </div>
        </Tiroir>
      )}
    </div>
  );
}

export { BadgeStatut };
