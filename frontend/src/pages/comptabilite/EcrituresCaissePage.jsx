// NJ COMPTABILITÉ — Écritures de caisse (lot F3 de NJ FINANCE, migration 077).
// État de la comptabilisation des mouvements de caisse : écritures produites,
// mouvements en anomalie, contrôle trésorerie (caisse = compte comptable) et
// ouverture (report de la caisse = à-nouveaux).
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { Erreur, fmtCompta, fmtDate } from './commun';

function Carte({ libelle, valeur, ton = '', aide }) {
  return (
    <div className={`fin-kpi ${ton}`}>
      <span>{libelle}</span>
      <b>{valeur}</b>
      {aide && <small>{aide}</small>}
    </div>
  );
}

export default function EcrituresCaissePage() {
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  const charger = useCallback(async () => {
    setEnCours(true);
    const r = await api.get('/comptabilite/caisse/etat');
    setEnCours(false);
    if (r?.error) { setErreur(r.error); return; }
    setErreur(''); setD(r);
  }, []);
  useEffect(() => { charger(); }, [charger]);

  if (!d && !erreur) return <div className="loading-msg">Comptabilisation des mouvements de caisse…</div>;
  const s = d?.synchronisation || {};
  const ecarts = (d?.tresorerie || []).filter((t) => !t.concorde);
  return (
    <div className="cm-page fin-page">
      <div className="cm-entete">
        <div>
          <h2>Écritures de caisse</h2>
          <p>Chaque mouvement de NJ FINANCE produit son écriture : au brouillard tant que l'arrêté de la caisse du mois n'est pas validé, puis validée. Un mouvement corrigé après validation est extourné et remplacé.</p>
        </div>
        <div className="cm-actions">
          <button type="button" className="cm-btn cm-secondaire" disabled={enCours} onClick={charger}>{enCours ? 'Mise à jour…' : 'Mettre à jour maintenant'}</button>
        </div>
      </div>
      <Erreur message={erreur} />
      {d && <>
        {(s.exercices_crees?.length > 0 || s.journaux_crees?.length > 0) && (
          <div className="fin-bandeau">
            Mise en place automatique :{s.exercices_crees?.length > 0 && <> exercice {s.exercices_crees.join(', ')} créé ;</>}
            {s.journaux_crees?.length > 0 && <> journaux {s.journaux_crees.join(', ')} créés.</>}
          </div>
        )}
        {!d.perimetre.debut ? (
          <div className="fin-vide"><div className="fin-vide-icone" aria-hidden="true">💵</div><h3>Aucun mouvement de caisse</h3><p>Les écritures apparaîtront dès les premières saisies dans NJ FINANCE.</p></div>
        ) : <>
          <div className="fin-kpis">
            <Carte libelle="Mouvements comptabilisables" valeur={d.perimetre.mouvements.toLocaleString('fr-FR')}
              aide={`Du ${fmtDate(d.perimetre.debut)} au ${fmtDate(d.perimetre.fin)}`} />
            <Carte libelle="Écritures au brouillard" valeur={d.ecritures.brouillard.toLocaleString('fr-FR')} aide="Caisses non arrêtées ou arrêtés non validés" />
            <Carte libelle="Écritures validées" valeur={d.ecritures.validees.toLocaleString('fr-FR')} ton="ok" aide="Arrêtés validés par le directeur" />
            <Carte libelle="Mouvements en anomalie" valeur={d.anomalies.length.toLocaleString('fr-FR')} ton={d.anomalies.length ? 'alerte' : 'ok'}
              aide={d.anomalies.length ? 'Pas encore comptabilisés' : 'Tout est comptabilisé'} />
          </div>
          {d.perimetre.anterieurs_non_repris > 0 && (
            <div className="fin-bandeau fin-bandeau-gris">
              {d.perimetre.anterieurs_non_repris.toLocaleString('fr-FR')} mouvement(s) antérieur(s) au {fmtDate(d.perimetre.debut)} ne sont pas repris : les soldes d'ouverture se saisissent en à-nouveaux (voir plus bas).
            </div>
          )}

          <section className="fin-carte">
            <div className="fin-carte-tete"><div>
              <h3>Mouvements à compléter</h3>
              <p>Ils restent dans la caisse mais n'ont pas encore d'écriture. Le compte d'une rubrique se valide dans NJ FINANCE → Contrôles comptables → Contrôle de régularité formelle ; le tiers se renseigne sur le mouvement. Ils seront repris automatiquement.</p>
            </div></div>
            {d.anomalies.length === 0 ? <div className="fin-vide-court">✓ Aucun mouvement en attente de comptabilisation.</div> : (
              <div className="cm-table-wrap">
                <table className="cm-table fin-table">
                  <thead><tr><th>Pièce</th><th>Date</th><th>Libellé</th><th className="fin-num">Montant</th><th>À faire</th></tr></thead>
                  <tbody>
                    {d.anomalies.map((a, i) => (
                      <tr key={i}>
                        <td className="fin-mono">{a.reference}</td><td>{fmtDate(a.date)}</td><td className="fin-libelle">{a.libelle}</td>
                        <td className="fin-num">{a.montant !== null ? fmtCompta(a.montant) : '—'}</td>
                        <td className="fin-motif">{a.motif}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="fin-carte">
            <div className="fin-carte-tete"><div>
              <h3>Contrôle de la trésorerie</h3>
              <p>Pour chaque compte de trésorerie et chaque mois, le mouvement des caisses (entrées − sorties) doit égaler le mouvement du compte dans les écritures de caisse. Un écart vient des mouvements à compléter.</p>
            </div>
            {ecarts.length === 0 ? <span className="fin-badge fin-badge-validee">Concordant</span> : <span className="fin-badge fin-badge-extournee">{ecarts.length} écart(s)</span>}
            </div>
            <div className="cm-table-wrap">
              <table className="cm-table fin-table">
                <thead><tr><th>Compte</th><th>Mois</th><th>Caisses</th><th className="fin-num">Caisse</th><th className="fin-num">Comptabilité</th><th className="fin-num">Écart</th><th /></tr></thead>
                <tbody>
                  {d.tresorerie.map((t) => (
                    <tr key={`${t.compte}-${t.mois}`} className={t.concorde ? '' : 'fin-ligne-ecart'}>
                      <td className="fin-mono"><b>{t.compte}</b></td><td style={{ textTransform: 'capitalize' }}>{t.libelle_mois}</td><td>{t.caisses || '—'}</td>
                      <td className="fin-num">{fmtCompta(t.caisse, { zero: '0' })}</td><td className="fin-num">{fmtCompta(t.compta, { zero: '0' })}</td>
                      <td className="fin-num fin-fort">{fmtCompta(t.ecart, { zero: '0' })}</td>
                      <td>{t.concorde ? '✓' : '⚠'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="fin-carte">
            <div className="fin-carte-tete"><div>
              <h3>Ouverture de l'exercice</h3>
              <p>Le report des caisses au {fmtDate(d.perimetre.debut)} doit être repris en à-nouveaux (journal AN) sur le compte de trésorerie : saisissez-les dans <Link to="/comptabilite/ecritures">Écritures</Link>, avec leurs contreparties.</p>
            </div></div>
            {d.ouvertures.length === 0 ? <div className="fin-vide-court">Aucune caisse n'a de compte de trésorerie.</div> : (
              <div className="cm-table-wrap">
                <table className="cm-table fin-table">
                  <thead><tr><th>Compte</th><th>Caisses</th><th className="fin-num">Report des caisses</th><th className="fin-num">À-nouveaux passés</th><th /></tr></thead>
                  <tbody>
                    {d.ouvertures.map((o) => (
                      <tr key={o.compte} className={o.concorde ? '' : 'fin-ligne-ecart'}>
                        <td className="fin-mono"><b>{o.compte}</b></td><td>{o.caisses}</td>
                        <td className="fin-num">{fmtCompta(o.ran, { zero: '0' })}</td><td className="fin-num">{fmtCompta(o.a_nouveaux, { zero: '0' })}</td>
                        <td>{o.concorde ? '✓' : 'À saisir'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>}
      </>}
    </div>
  );
}
