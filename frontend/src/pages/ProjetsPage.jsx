import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { statutProjet } from '@/lib/projets';
import ProjetsNav from '@/components/projets/ProjetsNav';

// Projets des ONG / associations (069, lot P2) — tableau de bord et liste.
// Le serveur ne renvoie que les projets du périmètre de l'utilisateur
// (direction et comptable : tous ; chef de projet : les siens ; responsable
// d'activité : ses activités, sans les financements).

export const fcfa = (v) => (v === null || v === undefined ? '—' : `${Math.round(Number(v) || 0).toLocaleString('fr-FR')}`);
export const dateFr = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
export const pct = (a, b) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);

export function Modale({ titre, onFermer, enCours, pied, largeur = 560, children }) {
  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget && !enCours) onFermer(); }}>
      <div className="modal-box" style={{ maxWidth: largeur }} role="dialog" aria-label={titre}>
        <div className="modal-head">
          <h3>{titre}</h3>
          <button type="button" className="modal-close" onClick={onFermer} disabled={enCours} aria-label="Fermer">✕</button>
        </div>
        <div className="modal-body pj-modal-corps">{children}</div>
        {pied && <div className="modal-foot">{pied}</div>}
      </div>
    </div>
  );
}

/** Création / modification d'un projet (direction : projets.gerer). */
export function ProjetModal({ projet, onFermer, onEnregistre }) {
  const toast = useToast();
  const [utilisateurs, setUtilisateurs] = useState([]);
  const [f, setF] = useState({
    nom: projet?.nom || '', code: projet?.code || '', description: projet?.description || '',
    date_debut: projet?.date_debut ? String(projet.date_debut).slice(0, 10) : '',
    date_fin: projet?.date_fin ? String(projet.date_fin).slice(0, 10) : '',
    chef_projet_id: projet?.chef_projet_id || '',
    actif: projet ? projet.actif : true,
  });
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  useEffect(() => { api.get('/projets/utilisateurs').then((r) => { if (Array.isArray(r)) setUtilisateurs(r); }); }, []);
  const maj = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); setErreur(''); };

  const enregistrer = async () => {
    if (!f.nom.trim()) { setErreur('Le nom du projet est obligatoire.'); return; }
    if (f.date_debut && f.date_fin && f.date_fin < f.date_debut) { setErreur('La date de fin précède la date de début.'); return; }
    setEnCours(true);
    const corps = { ...f, chef_projet_id: f.chef_projet_id || null, date_debut: f.date_debut || null, date_fin: f.date_fin || null };
    const r = projet ? await api.put(`/projets/${projet.id}`, corps) : await api.post('/projets', corps);
    setEnCours(false);
    if (r.error) { setErreur(r.error); return; }
    toast(projet ? 'Projet mis à jour.' : 'Projet créé.', 'success');
    onEnregistre(r.id || projet?.id);
  };

  return (
    <Modale
      titre={projet ? 'Modifier le projet' : 'Nouveau projet'} onFermer={onFermer} enCours={enCours}
      pied={<>
        <button type="button" className="btn-ghost" onClick={onFermer} disabled={enCours}>Annuler</button>
        <button type="button" className="btn-primary" onClick={enregistrer} disabled={enCours}>{enCours ? 'Enregistrement…' : '💾 Enregistrer'}</button>
      </>}
    >
      {erreur && <div className="alert-err">{erreur}</div>}
      <div className="pj-section">Identification</div>
      <div className="pj-grille-2">
        <div className="pj-col-2">
          <label>Nom du projet <span className="req">*</span></label>
          <input type="text" maxLength={120} value={f.nom} onChange={maj('nom')} placeholder="Ex. : Eau potable Bokito" autoFocus />
        </div>
        <div>
          <label>Code <span className="field-hint pj-inline">(facultatif)</span></label>
          <input type="text" maxLength={20} value={f.code} onChange={maj('code')} placeholder="PEP" style={{ textTransform: 'uppercase' }} />
        </div>
        <div>
          <label>Chef de projet</label>
          <select value={f.chef_projet_id} onChange={maj('chef_projet_id')}>
            <option value="">— À désigner —</option>
            {utilisateurs.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
          </select>
        </div>
        <div className="pj-col-2">
          <label>Description <span className="field-hint pj-inline">(facultatif)</span></label>
          <textarea rows={2} maxLength={500} value={f.description} onChange={maj('description')} placeholder="Bailleur, zone, objet du financement…" />
        </div>
      </div>
      <div className="pj-section">Période</div>
      <div className="pj-grille-2">
        <div><label>Début</label><input type="date" value={f.date_debut} onChange={maj('date_debut')} /></div>
        <div><label>Fin</label><input type="date" value={f.date_fin} onChange={maj('date_fin')} /></div>
      </div>
      {projet && (
        <label className="pj-case">
          <input type="checkbox" checked={!f.actif} onChange={(e) => setF((x) => ({ ...x, actif: !e.target.checked }))} />
          Projet clôturé (il n'est plus proposé à la saisie ; tout l'historique reste consultable)
        </label>
      )}
      <div className="field-hint">Le chef de projet désigné prépare le budget et gère les activités de ce projet ; le directeur valide le budget.</div>
    </Modale>
  );
}

function Kpi({ titre, valeur, sous, couleur, devise }) {
  return (
    <div className="pj-kpi" style={{ borderTopColor: couleur }}>
      <div className="pj-kpi-t">{titre}</div>
      <div className="pj-kpi-v" style={{ color: couleur }}>{valeur}{valeur !== '—' && <small> {devise}</small>}</div>
      {sous && <div className="pj-kpi-s">{sous}</div>}
    </div>
  );
}

export default function ProjetsPage() {
  const { devise } = useApp();
  const navigate = useNavigate();
  const [donnees, setDonnees] = useState(null);
  const [erreur, setErreur] = useState('');
  const [recherche, setRecherche] = useState('');
  const [filtre, setFiltre] = useState('tous');
  const [nouveau, setNouveau] = useState(false);

  const charger = useCallback(async () => {
    const r = await api.get('/projets');
    if (r.error) { setErreur(r.error); return; }
    setErreur('');
    setDonnees(r);
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const projets = donnees?.projets || [];
  const droits = donnees?.droits || {};
  const voitFinancements = projets.some((p) => p.acces.voir_tout);
  const totaux = useMemo(() => {
    const actifs = projets.filter((p) => p.actif);
    const s = (k) => actifs.reduce((t, p) => t + (Number(p[k]) || 0), 0);
    return {
      budget: s('montant_budget'), recu: s('recu'), alloue: s('alloue'), enAttente: s('en_attente'), justifie: s('justifie'),
      nbAttente: actifs.reduce((t, p) => t + (p.nb_activites_en_attente || 0), 0),
      disponible: s('recu') - s('alloue'), resteRecevoir: s('reste_a_recevoir'), nb: actifs.length,
    };
  }, [projets]);

  const filtres = [
    ['tous', 'Tous'], ['valide', 'Budget validé'], ['a_valider', 'Budget à valider'], ['sans_budget', 'Sans budget validé'], ['cloture', 'Clôturés'],
  ];
  const visibles = projets.filter((p) => {
    const st = statutProjet(p).cle;
    if (filtre !== 'tous' && st !== filtre) return false;
    if (filtre === 'tous' && st === 'cloture') return false;
    const t = recherche.trim().toLowerCase();
    return !t || [p.nom, p.code, p.chef_nom, p.description].some((x) => String(x || '').toLowerCase().includes(t));
  });
  const maxBarre = Math.max(1, ...visibles.map((p) => Math.max(p.montant_budget || 0, p.recu || 0, p.alloue || 0)));

  if (erreur) {
    return (
      <div className="page-content pj-page">
        <div className="pj-vide"><div className="pj-vide-ic">🔒</div><h3>Projets indisponibles</h3><p>{erreur}</p></div>
      </div>
    );
  }
  if (!donnees) return <div className="page-content pj-page"><div className="loading-msg">Chargement des projets…</div></div>;

  return (
    <div className="page-content pj-page">
      <div className="pj-tete">
        <div>
          <h2>Projets</h2>
          <p>Suivi de la caisse des projets : financements reçus dans les journaux, budget validé par le directeur, fonds remis aux responsables d'activité.</p>
        </div>
        <div className="pj-tete-actions">
          {droits.gerer && <button type="button" className="btn-primary btn-auto" onClick={() => setNouveau(true)}>＋ Nouveau projet</button>}
        </div>
      </div>

      <ProjetsNav />

      <div className={`pj-kpis ${voitFinancements ? '' : 'pj-kpis-3'}`}>
        <Kpi titre="Budget validé" valeur={fcfa(totaux.budget)} devise={devise} couleur="var(--projet-budget)" sous={`${totaux.nb} projet(s) actif(s)`} />
        {voitFinancements && <Kpi titre="Financement reçu" valeur={fcfa(totaux.recu)} devise={devise} couleur="var(--projet-recu)" sous={`${pct(totaux.recu, totaux.budget)} % du budget validé`} />}
        <Kpi titre="Alloué aux responsables" valeur={fcfa(totaux.alloue)} devise={devise} couleur="var(--projet-alloue)" sous={`${pct(totaux.alloue, totaux.budget)} % du budget validé`} />
        {voitFinancements && <Kpi titre="Disponible" valeur={fcfa(totaux.disponible)} devise={devise} couleur="#0f766e" sous="Reçu − alloué (solde comptable des projets)" />}
        <Kpi titre="En attente de justification" valeur={fcfa(totaux.enAttente)} devise={devise} couleur="var(--projet-attente)"
          sous={`${totaux.nbAttente} activité(s) · justifié ${fcfa(totaux.justifie)}`} />
      </div>

      {donnees.a_valider.length > 0 && (
        <div className="pj-carte pj-avalider">
          <div className="pj-carte-t">⏳ Budgets à valider <span className="pj-pastille">{donnees.a_valider.length}</span></div>
          {donnees.a_valider.map((b) => (
            <button type="button" key={b.id} className="pj-avalider-l" onClick={() => navigate(`/projets/${b.projet_id}?onglet=budget`)}>
              <span className="pj-avalider-nom">{b.projet_nom} <small>· version {b.version}</small></span>
              <span className="pj-muted">soumis par {b.soumis_par_nom || '—'} le {dateFr(b.soumis_le)}</span>
              <span className="pj-montant" style={{ color: 'var(--projet-budget)' }}>{fcfa(b.montant)} {devise}</span>
              <span className="pj-lien">Examiner ›</span>
            </button>
          ))}
        </div>
      )}

      <div className="pj-carte">
        <div className="pj-barre-outils">
          <input type="search" className="pj-recherche" placeholder="Rechercher un projet, un code, un chef de projet…" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
          <div className="pj-filtres" role="tablist">
            {filtres.map(([k, lib]) => (
              <button type="button" key={k} className={`pj-filtre${filtre === k ? ' on' : ''}`} onClick={() => setFiltre(k)}>
                {lib} <span>{k === 'tous' ? projets.filter((p) => p.actif).length : projets.filter((p) => statutProjet(p).cle === k).length}</span>
              </button>
            ))}
          </div>
        </div>

        {visibles.length === 0 ? (
          <div className="pj-vide">
            <div className="pj-vide-ic">📁</div>
            {projets.length === 0 ? (
              <>
                <h3>Aucun projet pour l'instant</h3>
                <p>{droits.gerer ? 'Créez un projet, désignez son chef de projet : il préparera le budget à soumettre au directeur.' : 'Vous n\'êtes désigné(e) sur aucun projet.'}</p>
                {droits.gerer && <button type="button" className="btn-primary btn-auto" onClick={() => setNouveau(true)}>＋ Créer le premier projet</button>}
              </>
            ) : <><h3>Aucun projet ne correspond</h3><p>Modifiez la recherche ou le filtre.</p></>}
          </div>
        ) : (
          <div className="pj-liste">
            {visibles.map((p) => {
              const st = statutProjet(p);
              return (
                <button type="button" key={p.id} className="pj-ligne" onClick={() => navigate(`/projets/${p.id}`)}>
                  <div className="pj-ligne-id">
                    <div className="pj-ligne-nom">
                      {p.code && <span className="pj-code">{p.code}</span>}
                      <strong>{p.nom}</strong>
                      <span className={`pj-badge ${st.cls}`}>{st.lib}</span>
                      {p.acces.chef && <span className="pj-badge pj-b-bleu">Mon projet</span>}
                      {p.acces.responsable && <span className="pj-badge pj-b-bleu">Mes activités</span>}
                    </div>
                    <div className="pj-muted">
                      Chef de projet : {p.chef_nom || <em>à désigner</em>} · {p.nb_activites} activité(s)
                      {p.date_debut && <> · {dateFr(p.date_debut)} → {dateFr(p.date_fin) || '…'}</>}
                    </div>
                  </div>
                  <div className="pj-ligne-barres" aria-hidden="true">
                    <div className="pj-mini"><span style={{ width: `${(p.montant_budget / maxBarre) * 100}%`, background: 'var(--projet-budget)' }} /></div>
                    {p.recu !== null && <div className="pj-mini"><span style={{ width: `${(p.recu / maxBarre) * 100}%`, background: 'var(--projet-recu)' }} /></div>}
                    <div className="pj-mini"><span style={{ width: `${(p.alloue / maxBarre) * 100}%`, background: 'var(--projet-alloue)' }} /></div>
                  </div>
                  <div className="pj-ligne-chiffres">
                    <span><i style={{ background: 'var(--projet-budget)' }} />Budget <b>{fcfa(p.montant_budget)}</b></span>
                    {p.recu !== null && <span><i style={{ background: 'var(--projet-recu)' }} />Reçu <b>{fcfa(p.recu)}</b></span>}
                    <span><i style={{ background: 'var(--projet-alloue)' }} />Alloué <b>{fcfa(p.alloue)}</b></span>
                  </div>
                  <span className="pj-chevron">›</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {nouveau && (
        <ProjetModal
          onFermer={() => setNouveau(false)}
          onEnregistre={(id) => { setNouveau(false); if (id) navigate(`/projets/${id}`); else charger(); }}
        />
      )}
    </div>
  );
}
