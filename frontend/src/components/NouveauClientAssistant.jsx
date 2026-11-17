// NJ BUSINESS — Assistant « Nouveau client » (super_admin).
//
// Trois étapes courtes, puis un écran de fin qui enchaîne sur la suite :
//   1. Entreprise   : raison sociale, identifiant (proposé automatiquement),
//                     forme juridique, devise et premières coordonnées ;
//   2. Modules      : zéro, un ou plusieurs modules à activer (aucun n'est imposé) ;
//   3. Vérification : récapitulatif et ce que chaque module va préparer.
// Tout est contrôlé ici pour guider la saisie, puis à nouveau par le serveur.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import { api } from '@/lib/api';
import NjMarque from '@/components/NjMarque';
import '@/styles/nouveau-client.css';

const ETAPES = ['Entreprise', 'Modules', 'Vérification'];
const DEVISES = [['FCFA', 'FCFA — Franc CFA'], ['EUR', 'EUR — Euro'], ['USD', 'USD — Dollar américain']];
const FORMES_EBNL = ['ASSOC', 'ONG'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INITIALES = { caisse: 'CP', commercial: 'CM', comptabilite: 'CT', cg: 'CG', dsf: 'DSF', revis: 'RV', rh: 'RH' };
// Ce que chaque module prépare à son activation (affiché à la vérification).
const PREPARE = {
  caisse: (forme) => [
    '5 journaux de départ (caisse, Orange Money, MTN MoMo, banque, carte prépayée)',
    'Rubriques de recettes et de dépenses par défaut',
    `Plan comptable ${FORMES_EBNL.includes(forme) ? 'SYCEBNL (suggéré par la forme juridique)' : 'SYSCOHADA révisé'}, modifiable ensuite dans la caisse`,
  ],
  commercial: () => [
    '8 profils métier prêts à attribuer (achats, stock, ventes, comptable)',
    'Paramétrage à compléter : agences, magasins, articles, tiers',
  ],
};

const versSlug = (v) => v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

function Champ({ id, label, requis, aide, erreur, children }) {
  return (
    <div className={'ncl-champ' + (erreur ? ' en-erreur' : '')}>
      <label htmlFor={id}>{label}{requis && <span className="ncl-requis" aria-hidden="true"> *</span>}</label>
      {children}
      {erreur ? <span className="ncl-erreur" id={`${id}-err`} role="alert">{erreur}</span> : aide && <span className="ncl-aide" id={`${id}-aide`}>{aide}</span>}
    </div>
  );
}

export default function NouveauClientAssistant({ slugsExistants = [], onFermer, onCree }) {
  const { selectTenant } = useApp();
  const navigate = useNavigate();
  const [etape, setEtape] = useState(0);
  const [f, setF] = useState({ nom: '', slug: '', forme_juridique: '', sigle: '', activite: '', devise: 'FCFA', pays: 'Cameroun', ville: '', telephone: '', email: '' });
  const [slugManuel, setSlugManuel] = useState(false);
  const [editionSlug, setEditionSlug] = useState(false);
  const [touche, setTouche] = useState({});
  const [formes, setFormes] = useState([]);
  const [catalogue, setCatalogue] = useState(null);
  const [choisis, setChoisis] = useState(['caisse']);
  const [envoi, setEnvoi] = useState(false);
  const [erreurServeur, setErreurServeur] = useState('');
  const [cree, setCree] = useState(null);     // client créé (écran de fin)
  const corps = useRef(null);

  useEffect(() => {
    api.get('/config/referentiel').then((r) => setFormes(r?.formes_juridiques || []));
    api.get('/plateforme/modules').then((r) => setCatalogue(r?.error ? [] : (r.modules || []).filter((m) => m.statut !== 'retire')));
  }, []);

  // Focus sur le premier champ de chaque étape ; le corps revient en haut.
  useEffect(() => {
    corps.current?.scrollTo?.(0, 0);
    const premier = corps.current?.querySelector('input:not([type=checkbox]), select, button.ncl-module:not(:disabled)');
    premier?.focus();
  }, [etape, cree]);

  const pris = useMemo(() => new Set(slugsExistants.map((s) => String(s).toLowerCase())), [slugsExistants]);
  const erreurs = {
    nom: !f.nom.trim() ? 'La raison sociale est obligatoire.' : '',
    slug: !f.slug ? 'L\'identifiant est obligatoire.'
      : !/^[a-z0-9-]+$/.test(f.slug) ? 'Minuscules, chiffres et tirets uniquement.'
        : pris.has(f.slug) ? 'Cet identifiant est déjà utilisé par un autre client.' : '',
    email: f.email && !EMAIL_RE.test(f.email.trim()) ? 'Adresse e-mail invalide.' : '',
  };
  const etapeValide = etape !== 0 || (!erreurs.nom && !erreurs.slug && !erreurs.email);
  const modifie = Boolean(f.nom || f.ville || f.telephone || f.email || f.activite);

  const set = (k) => (e) => {
    const v = e.target.value;
    setF((x) => {
      const n = { ...x, [k]: v };
      if (k === 'nom' && !slugManuel) n.slug = versSlug(v);
      return n;
    });
  };
  const toucher = (k) => () => setTouche((t) => ({ ...t, [k]: true }));
  const err = (k) => (touche[k] || etape > 0 ? erreurs[k] : '');

  const fermer = () => {
    if (!cree && modifie && !window.confirm('Abandonner la création de ce client ? Les informations saisies seront perdues.')) return;
    onFermer();
  };
  useEffect(() => {
    const echap = (e) => { if (e.key === 'Escape' && !envoi) fermer(); };
    window.addEventListener('keydown', echap);
    return () => window.removeEventListener('keydown', echap);
  });

  const suivant = (e) => {
    e?.preventDefault();
    if (etape === 0) {
      setTouche({ nom: true, slug: true, email: true });
      if (!etapeValide) {
        // Le premier champ en erreur reçoit le focus ; l'identifiant s'ouvre en saisie.
        if (erreurs.nom) document.getElementById('ncl-nom')?.focus();
        else if (erreurs.slug) setEditionSlug(true);
        else if (erreurs.email) document.getElementById('ncl-email')?.focus();
        return;
      }
    }
    if (etape < 2) setEtape(etape + 1);
    else creer();
  };

  const creer = async () => {
    setEnvoi(true);
    setErreurServeur('');
    const identite = Object.fromEntries(['forme_juridique', 'sigle', 'activite', 'pays', 'ville', 'telephone', 'email']
      .map((k) => [k, f[k].trim()]).filter(([, v]) => v));
    const r = await api.post('/tenants', { nom: f.nom.trim(), slug: f.slug, devise: f.devise, modules: choisis, identite });
    setEnvoi(false);
    if (r?.error) {
      setErreurServeur(r.error);
      if (/slug|identifiant/i.test(r.error)) { setEtape(0); setTouche({ slug: true }); }
      return;
    }
    setCree(r);
    onCree?.(r);
  };

  const ouvrir = (chemin) => {
    selectTenant(cree.id, cree.nom, cree.devise);
    onFermer();
    if (chemin) navigate(chemin);
  };

  const recommencer = () => {
    setCree(null); setEtape(0); setTouche({}); setSlugManuel(false); setEditionSlug(false); setChoisis(['caisse']); setErreurServeur('');
    setF({ nom: '', slug: '', forme_juridique: '', sigle: '', activite: '', devise: 'FCFA', pays: 'Cameroun', ville: '', telephone: '', email: '' });
  };

  const basculer = (code) => setChoisis((x) => (x.includes(code) ? x.filter((c) => c !== code) : [...x, code]));
  const forme = formes.find((x) => x.code === f.forme_juridique);
  const modulesChoisis = (catalogue || []).filter((m) => choisis.includes(m.code));

  return (
    <div className="modal-overlay ncl-voile" style={{ display: 'flex' }} onMouseDown={(e) => { if (e.target === e.currentTarget && !envoi) fermer(); }}>
      <div className="ncl" role="dialog" aria-modal="true" aria-labelledby="ncl-titre">
        <header className="ncl-tete">
          <NjMarque taille={36} fond="#243655" titre="NJ BUSINESS" />
          <div className="ncl-tete-txt">
            <h2 id="ncl-titre">{cree ? 'Client créé' : 'Nouveau client'}</h2>
            <p>{cree ? cree.nom : 'Créez l\'espace d\'une entreprise cliente en trois étapes.'}</p>
          </div>
          <button type="button" className="ncl-fermer" onClick={fermer} aria-label="Fermer" disabled={envoi}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>

        {!cree && (
          <ol className="ncl-etapes" aria-label="Étapes">
            {ETAPES.map((nom, i) => (
              <li key={nom} className={i === etape ? 'en-cours' : i < etape ? 'faite' : ''} aria-current={i === etape ? 'step' : undefined}>
                <button type="button" disabled={i > etape || envoi} onClick={() => setEtape(i)}>
                  <span className="ncl-pastille" aria-hidden="true">{i < etape ? '✓' : i + 1}</span>
                  <span className="ncl-etape-nom">{nom}</span>
                </button>
              </li>
            ))}
          </ol>
        )}

        <form className="ncl-corps" ref={corps} onSubmit={suivant} noValidate>
          {erreurServeur && <div className="ncl-alerte" role="alert">{erreurServeur}</div>}

          {!cree && etape === 0 && (
            <>
              <section className="ncl-bloc">
                <h3>Identité</h3>
                <Champ id="ncl-nom" label="Raison sociale" requis erreur={err('nom')}>
                  <input id="ncl-nom" value={f.nom} onChange={set('nom')} onBlur={toucher('nom')} maxLength={200}
                    placeholder="Ex : Boulangerie du Centre SARL" aria-invalid={Boolean(err('nom'))} autoComplete="organization" />
                </Champ>
                <div className="ncl-identifiant">
                  {editionSlug ? (
                    <Champ id="ncl-slug" label="Identifiant du client" requis erreur={err('slug')} aide="Minuscules, chiffres et tirets. Il ne pourra plus être modifié.">
                      <input id="ncl-slug" value={f.slug} maxLength={60} className="ncl-mono" onBlur={toucher('slug')} aria-invalid={Boolean(err('slug'))}
                        onChange={(e) => { setSlugManuel(true); setF((x) => ({ ...x, slug: e.target.value.toLowerCase() })); }} />
                    </Champ>
                  ) : (
                    <div className={'ncl-slug-ligne' + (err('slug') ? ' en-erreur' : '')}>
                      <span className="ncl-slug-lib">Identifiant</span>
                      <code>{f.slug || 'proposé à partir de la raison sociale'}</code>
                      <button type="button" className="ncl-lien" onClick={() => setEditionSlug(true)}>Modifier</button>
                      {err('slug') && f.slug && <span className="ncl-erreur" role="alert">{err('slug')}</span>}
                    </div>
                  )}
                </div>
                <div className="ncl-grille">
                  <Champ id="ncl-forme" label="Forme juridique" aide={FORMES_EBNL.includes(f.forme_juridique) ? 'Plan comptable suggéré : SYCEBNL.' : 'Facultatif.'}>
                    <select id="ncl-forme" value={f.forme_juridique} onChange={set('forme_juridique')}>
                      <option value="">— Choisir —</option>
                      {formes.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
                    </select>
                  </Champ>
                  <Champ id="ncl-sigle" label="Sigle">
                    <input id="ncl-sigle" value={f.sigle} onChange={set('sigle')} maxLength={30} className="ncl-maj" placeholder="Ex : BDC" />
                  </Champ>
                  <Champ id="ncl-activite" label="Secteur d'activité">
                    <input id="ncl-activite" value={f.activite} onChange={set('activite')} maxLength={200} placeholder="Ex : Boulangerie, pâtisserie" />
                  </Champ>
                  <Champ id="ncl-devise" label="Devise principale">
                    <select id="ncl-devise" value={f.devise} onChange={set('devise')}>
                      {DEVISES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
                    </select>
                  </Champ>
                </div>
              </section>
              <section className="ncl-bloc">
                <h3>Coordonnées <span className="ncl-facultatif">facultatives</span></h3>
                <div className="ncl-grille">
                  <Champ id="ncl-pays" label="Pays"><input id="ncl-pays" value={f.pays} onChange={set('pays')} maxLength={100} autoComplete="country-name" /></Champ>
                  <Champ id="ncl-ville" label="Ville"><input id="ncl-ville" value={f.ville} onChange={set('ville')} maxLength={100} placeholder="Ex : Yaoundé" autoComplete="address-level2" /></Champ>
                  <Champ id="ncl-tel" label="Téléphone"><input id="ncl-tel" type="tel" value={f.telephone} onChange={set('telephone')} maxLength={60} placeholder="+237 6 99 00 00 00" autoComplete="tel" /></Champ>
                  <Champ id="ncl-email" label="E-mail" erreur={err('email')}>
                    <input id="ncl-email" type="email" value={f.email} onChange={set('email')} onBlur={toucher('email')} maxLength={150} placeholder="contact@entreprise.cm" autoComplete="email" aria-invalid={Boolean(err('email'))} />
                  </Champ>
                </div>
                <p className="ncl-note">Le logo, les références légales et le représentant légal se complètent ensuite dans la configuration de l'entreprise.</p>
              </section>
            </>
          )}

          {!cree && etape === 1 && (
            <section className="ncl-bloc">
              <h3>Modules à activer</h3>
              <p className="ncl-note ncl-note-haut">Aucun module n'est obligatoire : l'entreprise peut être créée et configurée maintenant, ses modules activés plus tard.</p>
              {catalogue === null ? <div className="loading-msg">Chargement…</div> : (
                <div className="ncl-modules" role="group" aria-label="Modules">
                  {catalogue.map((m) => {
                    const dispo = m.statut === 'operationnel';
                    const coche = choisis.includes(m.code);
                    return (
                      <button key={m.code} type="button" className={'ncl-module' + (coche ? ' coche' : '')} disabled={!dispo}
                        role="checkbox" aria-checked={coche} onClick={() => basculer(m.code)}>
                        <span className="ncl-module-ico" aria-hidden="true">{coche ? <NjMarque taille={34} module titre="" /> : (INITIALES[m.code] || m.code.slice(0, 2).toUpperCase())}</span>
                        <span className="ncl-module-txt">
                          <b>{m.nom}</b>
                          <span>{m.description}</span>
                        </span>
                        <span className="ncl-module-etat" aria-hidden="true">{dispo ? (coche ? '✓' : '') : 'Bientôt'}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              <p className="ncl-compte" aria-live="polite">
                {choisis.length === 0 ? 'Aucun module sélectionné : le client sera créé sans module.' : `${choisis.length} module${choisis.length > 1 ? 's' : ''} sélectionné${choisis.length > 1 ? 's' : ''}.`}
              </p>
            </section>
          )}

          {!cree && etape === 2 && (
            <>
              <section className="ncl-bloc">
                <div className="ncl-titre-ligne"><h3>Entreprise</h3><button type="button" className="ncl-lien" onClick={() => setEtape(0)}>Modifier</button></div>
                <dl className="ncl-recap">
                  <div><dt>Raison sociale</dt><dd>{f.nom}{f.sigle && <span className="ncl-gris"> ({f.sigle.toUpperCase()})</span>}</dd></div>
                  <div><dt>Identifiant</dt><dd><code>{f.slug}</code></dd></div>
                  <div><dt>Forme juridique</dt><dd>{forme?.label || <span className="ncl-gris">non renseignée</span>}</dd></div>
                  <div><dt>Devise</dt><dd>{f.devise}</dd></div>
                  <div><dt>Coordonnées</dt><dd>{[f.ville, f.pays, f.telephone, f.email].filter(Boolean).join(' · ') || <span className="ncl-gris">à compléter</span>}</dd></div>
                </dl>
              </section>
              <section className="ncl-bloc">
                <div className="ncl-titre-ligne"><h3>Modules</h3><button type="button" className="ncl-lien" onClick={() => setEtape(1)}>Modifier</button></div>
                {modulesChoisis.length === 0 ? (
                  <div className="ncl-info">Aucun module : le client sera créé et sa configuration d'entreprise accessible. Activez ses modules plus tard depuis l'administration de la plateforme.</div>
                ) : (
                  <ul className="ncl-prepare">
                    {modulesChoisis.map((m) => (
                      <li key={m.code}>
                        <b>{m.nom}</b>
                        <ul>{(PREPARE[m.code]?.(f.forme_juridique) || ['Module activé']).map((x) => <li key={x}>{x}</li>)}</ul>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}

          {cree && (
            <div className="ncl-fin">
              <div className="ncl-fin-ico" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              </div>
              <h3>L'espace de « {cree.nom} » est prêt</h3>
              <p>{(cree.modules || []).length
                ? `Modules activés : ${(catalogue || []).filter((m) => cree.modules.includes(m.code)).map((m) => m.nom).join(', ')}.`
                : 'Aucun module activé pour l\'instant.'}</p>
              <div className="ncl-suite">
                <button type="button" className="ncl-suite-carte" onClick={() => ouvrir('/entreprise')}>
                  <b>Compléter la configuration de l'entreprise</b>
                  <span>Logo, références légales, représentant légal</span>
                </button>
                <button type="button" className="ncl-suite-carte" onClick={() => ouvrir(null)}>
                  <b>Travailler sur ce client</b>
                  <span>Le sélectionner comme client en cours</span>
                </button>
              </div>
            </div>
          )}
        </form>

        <footer className="ncl-pied">
          {cree ? (
            <>
              <button type="button" className="ncl-btn ncl-secondaire" onClick={recommencer}>Créer un autre client</button>
              <span className="ncl-espace" />
              <button type="button" className="ncl-btn ncl-primaire" onClick={onFermer}>Terminer</button>
            </>
          ) : (
            <>
              <button type="button" className="ncl-btn ncl-secondaire" onClick={etape === 0 ? fermer : () => setEtape(etape - 1)} disabled={envoi}>
                {etape === 0 ? 'Annuler' : 'Retour'}
              </button>
              <span className="ncl-progression">Étape {etape + 1} sur 3</span>
              <button type="button" className="ncl-btn ncl-primaire" onClick={suivant} disabled={envoi}>
                {envoi ? <><span className="ncl-spin" aria-hidden="true" /> Création…</> : etape < 2 ? 'Continuer' : 'Créer le client'}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
