// Initialisation guidée d'un espace (comptes de démonstration, migration 029).
// Affichée en plein écran à la 1re connexion après activation, tant que le
// directeur n'a pas défini ses caisses et leurs soldes d'ouverture (RAN).
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { fmt } from '@/lib/format';

const ICONES = { caisse: '💵', om: '🟠', momo: '🟡', banque: '🏦', carte_prepayee: '💳', autre: '📒' };
const AIDE = {
  caisse: 'Espèces : caisse principale, caisse d\'une boutique, d\'un site…',
  om: 'Compte(s) Orange Money de l\'entreprise',
  momo: 'Compte(s) MTN Mobile Money de l\'entreprise',
  banque: 'Comptes bancaires (solde selon le relevé)',
  carte_prepayee: 'Cartes prépayées utilisées pour les dépenses',
  autre: 'Tout autre moyen de paiement à suivre',
};
const NOM_DEFAUT = { caisse: 'Caisse', om: 'Orange Money', momo: 'MTN Mobile Money', banque: 'Banque', carte_prepayee: 'Carte prépayée', autre: 'Journal' };
const DEPART = { caisse: 1, om: 1, momo: 1, banque: 1, carte_prepayee: 0, autre: 0 };
const ETAPES = ['Vos caisses', 'Soldes d\'ouverture', 'Validation'];

// Noms proposés : on reprend ceux des caisses créées par défaut.
const nomPropose = (type, i, existants) => {
  const ex = existants.filter((j) => j.type === type)[i];
  if (ex) return ex.nom;
  if (type === 'caisse') return i === 0 ? 'Caisse Principale' : `Caisse ${i + 1}`;
  return i === 0 ? NOM_DEFAUT[type] : `${NOM_DEFAUT[type]} ${i + 1}`;
};

export default function InitialisationCompte({ etat, devise = 'FCFA', onTermine, onLogout }) {
  const existants = etat.journaux || [];
  const [etape, setEtape] = useState(0);
  const [mois, setMois] = useState(etat.mois_defaut);
  const [annee, setAnnee] = useState(etat.annee_defaut);
  // Jour d'ouverture : aujourd'hui par défaut, ramené au dernier jour du mois choisi si besoin.
  const [jour, setJour] = useState(etat.jour_defaut || 1);
  const nbJours = new Date(annee, Math.max(0, (etat.mois || []).indexOf(mois)) + 1, 0).getDate();
  const jourEffectif = Math.min(jour, nbJours);
  const dateOuvertureTxt = `${jourEffectif === 1 ? '1er' : jourEffectif} ${String(mois || '').toLowerCase()} ${annee}`;
  const [caisses, setCaisses] = useState(() => (etat.types || []).flatMap(({ type }) =>
    Array.from({ length: DEPART[type] ?? 0 }, (_, i) => ({ k: `${type}-${i}-${Math.random()}`, type, nom: nomPropose(type, i, existants), ran: '' }))));
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [fini, setFini] = useState(null);

  const parType = (type) => caisses.filter((c) => c.type === type);
  const ajouter = (type) => setCaisses((cs) => {
    const n = cs.filter((c) => c.type === type).length;
    if (n >= 10) return cs;
    const dernier = cs.map((c) => c.type).lastIndexOf(type);
    const nouv = { k: `${type}-${n}-${Math.random()}`, type, nom: nomPropose(type, n, existants), ran: '' };
    const copie = [...cs];
    copie.splice(dernier >= 0 ? dernier + 1 : copie.length, 0, nouv);
    return copie;
  });
  const retirer = (type) => setCaisses((cs) => {
    const i = cs.map((c) => c.type).lastIndexOf(type);
    return i < 0 ? cs : cs.filter((_, j) => j !== i);
  });
  const maj = (k, champ, v) => setCaisses((cs) => cs.map((c) => (c.k === k ? { ...c, [champ]: v } : c)));

  const montant = (v) => Number(String(v).replace(/\s/g, '').replace(',', '.')) || 0;
  const total = useMemo(() => caisses.reduce((s, c) => s + montant(c.ran), 0), [caisses]);
  const annees = [etat.annee_defaut - 1, etat.annee_defaut, etat.annee_defaut + 1];

  const controleEtape = () => {
    if (etape === 0) {
      if (caisses.length === 0) return 'Ajoutez au moins une caisse.';
      if (caisses.some((c) => !c.nom.trim())) return 'Donnez un nom à chaque caisse.';
      const noms = caisses.map((c) => c.nom.trim().toLowerCase());
      if (new Set(noms).size !== noms.length) return 'Deux caisses portent le même nom.';
    }
    if (etape === 1) {
      const neg = caisses.find((c) => montant(c.ran) < 0 || Number.isNaN(Number(String(c.ran).replace(/\s/g, '').replace(',', '.'))));
      if (neg) return `« ${neg.nom} » : saisissez un montant positif (0 si la caisse est vide).`;
    }
    return '';
  };
  const suivant = () => {
    const e = controleEtape();
    setErreur(e);
    if (!e) setEtape((x) => x + 1);
  };

  const valider = async () => {
    setEnvoi(true); setErreur('');
    const res = await api.post('/initialisation', {
      mois, annee, jour: jourEffectif, caisses: caisses.map((c) => ({ type: c.type, nom: c.nom.trim(), ran: montant(c.ran) })),
    });
    setEnvoi(false);
    if (res.error) { setErreur(res.error); return; }
    setFini(res);
  };

  if (!etat.peut_initialiser) {
    return (
      <div className="init-wrap">
        <div className="init-card init-attente">
          <div className="init-logo">⏳</div>
          <h1>Compte en cours de préparation</h1>
          <p>Le directeur de l'espace <b>{etat.tenant_nom}</b> doit d'abord définir les caisses et leurs soldes d'ouverture.
            Vous pourrez travailler dès que ce sera fait.</p>
          <button className="init-btn ghost" onClick={onLogout}>Se déconnecter</button>
        </div>
      </div>
    );
  }

  if (fini) {
    return (
      <div className="init-wrap">
        <div className="init-card init-fini">
          <div className="init-check">✓</div>
          <h1>Votre compte est prêt</h1>
          <p>{fini.message}</p>
          <div className="init-recap">
            {fini.caisses.map((c) => (
              <div key={c.code}><span>{ICONES[c.type]} {c.nom} <i>{c.code}</i></span><b>{fmt(c.ran, devise)}</b></div>
            ))}
            <div className="tot"><span>Trésorerie d'ouverture</span><b>{fmt(fini.total_ran, devise)}</b></div>
          </div>
          <button className="init-btn" onClick={() => onTermine(fini)}>Continuer : configurer mon espace →</button>
        </div>
      </div>
    );
  }

  return (
    <div className="init-wrap">
      <div className="init-card">
        <header className="init-head">
          <div>
            <div className="init-kicker">Bienvenue sur NJ Caisse Pro</div>
            <h1>Initialisons votre compte</h1>
            <p>{etat.tenant_nom} — 3 étapes, 2 minutes. Ces informations sont modifiables ensuite dans la Configuration (caisses).</p>
          </div>
        </header>

        <ol className="init-steps">
          {ETAPES.map((t, i) => (
            <li key={t} className={i === etape ? 'on' : i < etape ? 'done' : ''}><span>{i < etape ? '✓' : i + 1}</span>{t}</li>
          ))}
        </ol>

        <div className="init-body">
          {etape === 0 && (
            <>
              <p className="init-lead">Combien de caisses de chaque type utilisez-vous ? Nommez-les comme vous les appelez au quotidien.</p>
              <div className="init-types">
                {(etat.types || []).map(({ type, label }) => {
                  const liste = parType(type);
                  return (
                    <div key={type} className={`init-type ${liste.length ? 'actif' : ''}`}>
                      <div className="init-type-head">
                        <div className="ico">{ICONES[type]}</div>
                        <div className="txt"><b>{label}</b><small>{AIDE[type]}</small></div>
                        <div className="init-count">
                          <button type="button" onClick={() => retirer(type)} disabled={!liste.length} aria-label={`Retirer ${label}`}>−</button>
                          <span>{liste.length}</span>
                          <button type="button" onClick={() => ajouter(type)} disabled={liste.length >= 10} aria-label={`Ajouter ${label}`}>+</button>
                        </div>
                      </div>
                      {liste.length > 0 && (
                        <div className="init-noms">
                          {liste.map((c, i) => (
                            <input key={c.k} value={c.nom} maxLength={80} placeholder={`Nom de la caisse ${i + 1}`}
                              onChange={(e) => maj(c.k, 'nom', e.target.value)} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {etape === 1 && (
            <>
              <p className="init-lead">Quel jour ouvrez-vous vos caisses dans l'application ? Indiquez ce que contient chaque caisse <b>ce jour-là</b>, avant toute opération.</p>
              <div className="init-periode">
                <label>Jour d'ouverture
                  <select value={jourEffectif} onChange={(e) => setJour(Number(e.target.value))}>
                    {Array.from({ length: nbJours }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d === 1 ? '1er' : d}</option>)}
                  </select>
                </label>
                <label>Mois
                  <select value={mois} onChange={(e) => setMois(e.target.value)}>{(etat.mois || []).map((m) => <option key={m}>{m}</option>)}</select>
                </label>
                <label>Année
                  <select value={annee} onChange={(e) => setAnnee(Number(e.target.value))}>{annees.map((a) => <option key={a}>{a}</option>)}</select>
                </label>
              </div>
              <div className="init-rans">
                {caisses.map((c) => (
                  <div key={c.k} className="init-ran">
                    <span className="ico">{ICONES[c.type]}</span>
                    <span className="nom">{c.nom}</span>
                    <div className="champ">
                      <input inputMode="decimal" placeholder="0" value={c.ran}
                        onChange={(e) => maj(c.k, 'ran', e.target.value.replace(/[^\d\s,.]/g, ''))} />
                      <em>{devise}</em>
                    </div>
                  </div>
                ))}
              </div>
              <div className="init-total"><span>Trésorerie d'ouverture au {dateOuvertureTxt}</span><b>{fmt(total, devise)}</b></div>
              <p className="init-note">Aucune opération ne pourra être datée avant le {dateOuvertureTxt}. Le solde d'ouverture (RAN) ne se saisit qu'une fois : les mois suivants, il reprend automatiquement le solde final du mois précédent.</p>
            </>
          )}

          {etape === 2 && (
            <>
              <p className="init-lead">Vérifiez avant de valider. Ouverture des caisses le <b>{dateOuvertureTxt}</b>.</p>
              <div className="init-recap">
                {caisses.map((c) => (
                  <div key={c.k}><span>{ICONES[c.type]} {c.nom}</span><b>{fmt(montant(c.ran), devise)}</b></div>
                ))}
                <div className="tot"><span>Trésorerie d'ouverture</span><b>{fmt(total, devise)}</b></div>
              </div>
              {existants.some((j) => !caisses.some((c) => c.type === j.type)) && (
                <p className="init-note">Les caisses proposées par défaut que vous n'avez pas retenues seront désactivées (elles pourront être réactivées dans la Configuration).</p>
              )}
            </>
          )}

          {erreur && <div className="init-err">⚠ {erreur}</div>}
        </div>

        <footer className="init-foot">
          <button className="init-btn ghost" onClick={etape === 0 ? onLogout : () => { setErreur(''); setEtape((x) => x - 1); }}>
            {etape === 0 ? 'Se déconnecter' : '← Retour'}
          </button>
          {etape < 2
            ? <button className="init-btn" onClick={suivant}>Continuer →</button>
            : <button className="init-btn" onClick={valider} disabled={envoi}>{envoi ? 'Initialisation…' : '✓ Valider et démarrer'}</button>}
        </footer>
      </div>
    </div>
  );
}
