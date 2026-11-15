import { useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { lignesEntite } from '@/lib/print';
import PeriodiciteBudget from '@/components/config/PeriodiciteBudget';
import BasculePlanModal, { PastilleReferentiel } from '@/components/config/BasculePlanModal';

// Reprend loadTabEntite()/saveConfig()/changePassword() de legacy/js/app.js (l. 5166-5322).
const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: .4, color: 'var(--text-muted)', marginBottom: 5 };
const inputStyle = { width: '100%', padding: '9px 12px', border: '1.5px solid var(--border)', borderRadius: 7, fontSize: 13 };
const roStyle = { ...inputStyle, background: '#f8fafc', cursor: 'not-allowed' };
const cardStyle = { background: 'white', border: '1px solid var(--border)', borderRadius: 12, padding: 24, marginBottom: 16 };
const cardTitleStyle = { fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 16 };

// Le logo est redimensionné dans le navigateur (≤ 600 × 300 px) puis envoyé
// en data URL : léger en base, et affiché tel quel sur les documents imprimés.
const LOGO_MAX_W = 600;
const LOGO_MAX_H = 300;
const LOGO_MAX_CARACTERES = 380 * 1024;
function preparerLogo(fichier) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(fichier.type)) {
      reject(new Error('Choisissez une image PNG, JPEG ou WebP.'));
      return;
    }
    if (fichier.size > 8 * 1024 * 1024) { reject(new Error('Image trop lourde (8 Mo maximum).')); return; }
    const url = URL.createObjectURL(fichier);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let echelle = Math.min(1, LOGO_MAX_W / img.width, LOGO_MAX_H / img.height);
      const transparent = fichier.type !== 'image/jpeg';
      for (let essai = 0; essai < 5; essai += 1) {
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * echelle));
        c.height = Math.max(1, Math.round(img.height * echelle));
        const ctx = c.getContext('2d');
        if (!transparent) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const data = transparent ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9);
        if (data.length <= LOGO_MAX_CARACTERES) { resolve(data); return; }
        echelle *= 0.75;
      }
      reject(new Error("Logo trop détaillé : essayez une version plus simple ou en JPEG."));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Impossible de lire cette image.")); };
    img.src = url;
  });
}

export default function EntiteTab() {
  const { can, setDevise, rechargerEntite } = useApp();
  const toast = useToast();
  const canEdit = can('config.edit');
  // Props communs à injecter sur chaque champ éditable de ce formulaire.
  const field = { style: canEdit ? inputStyle : roStyle, ...(canEdit ? {} : { readOnly: true, disabled: true }) };

  const [formes, setFormes] = useState([]);
  const [erreur, setErreur] = useState('');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  // 060 : référentiel du plan comptable (SYSCOHADA / SYCEBNL) piloté par la forme juridique.
  const [planRef, setPlanRef] = useState({ actuel: 'SYSCOHADA', referentiels: {} });
  const [bascule, setBascule] = useState(null);   // { de, vers, versInfo, apercu, contexte }
  const [basculeEnCours, setBasculeEnCours] = useState(false);
  const [apercuForme, setApercuForme] = useState(null);   // aperçu de la bascule pour la forme choisie

  useEffect(() => {
    let annule = false;
    Promise.all([
      api.get('/config'),
      api.get('/config/referentiel').catch(() => ({ formes_juridiques: [] })),
    ]).then(([d, ref]) => {
      if (annule) return;
      if (d.error) { setErreur(d.error); return; }
      setForm({
        nom: d.nom || '', sigle: d.sigle || '', forme_juridique: d.forme_juridique || '',
        activite: d.activite || '', dirigeant_nom: d.dirigeant_nom || '',
        adresse: d.adresse || '', boite_postale: d.boite_postale || '',
        registre_commerce: d.registre_commerce || '', nui: d.nui || '', devise: d.devise || 'FCFA',
        telephone: d.telephone || '', email: d.email || '', site_web: d.site_web || '',
        logo_url: d.logo_url || '',
      });
      setFormes(ref.formes_juridiques || []);
      setPlanRef({ actuel: d.plan_referentiel || 'SYSCOHADA', attendu: d.plan_referentiel_attendu || 'SYSCOHADA', referentiels: ref.referentiels || {} });
    });
    return () => { annule = true; };
  }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const onLogo = async (e) => {
    const fichier = e.target.files?.[0];
    e.target.value = '';
    if (!fichier) return;
    try {
      const data = await preparerLogo(fichier);
      setForm((f) => ({ ...f, logo_url: data }));
      toast('Logo prêt — pensez à enregistrer la configuration.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const appliquerReponse = (res) => {
    setDevise(res.config?.devise || 'FCFA');
    if (res.config) setPlanRef((p) => ({ ...p, actuel: res.config.plan_referentiel || p.actuel, attendu: res.config.plan_referentiel_attendu || p.attendu }));
    rechargerEntite?.();
    toast(res.bascule_plan ? res.message : 'Configuration enregistrée ✓', 'success', res.bascule_plan ? 7000 : 3000);
  };

  // 060 : enregistrer une forme Association / ONG charge le plan SYCEBNL
  // (autre forme : SYSCOHADA). L'aperçu est affiché sous la forme juridique.
  const onSave = async () => {
    if (!form.nom.trim()) { toast("Le nom de l'entité est obligatoire.", 'error'); return; }
    setSaving(true);
    const res = await api.put('/config', form);
    setSaving(false);
    if (res.error) { toast(res.error, 'error', 8000); return; }
    setApercuForme(null);
    appliquerReponse(res);
  };

  const confirmerBascule = async () => {
    setBasculeEnCours(true);
    const res = await api.post('/config/plan-referentiel/bascule', { confirmer: true });
    if (res.error) toast(res.error, 'error', 8000);
    else {
      setBascule(null);
      setPlanRef((p) => ({ ...p, actuel: res.etat?.actuel || p.actuel, attendu: res.etat?.attendu || p.attendu }));
      toast(res.message, 'success', 7000);
    }
    setBasculeEnCours(false);
  };

  const ouvrirAlignement = async () => {
    const r = await api.get('/config/plan-referentiel');
    if (r.error) { toast(r.error, 'error'); return; }
    if (!r.change) { toast('Le plan comptable est déjà aligné sur la forme juridique.', 'success'); return; }
    setBascule({ de: r.actuel, vers: r.cible, versInfo: r.cible_info, apercu: r.apercu, contexte: 'alignement' });
  };

  // Référentiel qu'implique la forme sélectionnée (avant enregistrement).
  const refChoisi = formes.find((f) => f.code === form?.forme_juridique)?.plan_referentiel || 'SYSCOHADA';
  const refInfo = planRef.referentiels?.[refChoisi];
  const formeDejaEnregistreeDesalignee = planRef.attendu && planRef.attendu !== planRef.actuel;
  const basculeAVenir = Boolean(form) && refChoisi !== planRef.actuel;

  useEffect(() => {
    if (!basculeAVenir) { setApercuForme(null); return undefined; }
    let annule = false;
    api.get(`/config/plan-referentiel?forme=${encodeURIComponent(form?.forme_juridique || '')}`)
      .then((r) => { if (!annule) setApercuForme(r.error ? null : r.apercu); });
    return () => { annule = true; };
  }, [basculeAVenir, form?.forme_juridique]);

  if (erreur) return <div className="alert-err">{erreur}</div>;
  if (!form) return <div className="loading-msg">Chargement…</div>;

  return (
    <div style={{ maxWidth: 760 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 20 }}>Informations de l'entité</h3>

      <div style={cardStyle}>
        <h4 style={cardTitleStyle}>🖼️ Logo</h4>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
          <div style={{ width: 200, height: 100, border: '1.5px dashed var(--border)', borderRadius: 10, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
            {form.logo_url
              ? <img src={form.logo_url} alt="Logo de l'entité" style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain' }} />
              : <span style={{ fontSize: 12, color: 'var(--text-light)', textAlign: 'center', padding: 8 }}>Aucun logo</span>}
          </div>
          <div style={{ flex: '1 1 220px', fontSize: 13, color: 'var(--text-muted)' }}>
            <p style={{ marginBottom: 10 }}>Le logo apparaît en tête des bons de caisse, journaux, états récapitulatifs, demandes de fonds et comptes d'emploi.</p>
            <p style={{ marginBottom: 12, fontSize: 12 }}>PNG (fond transparent conseillé), JPEG ou WebP. Il est redimensionné automatiquement.</p>
            {canEdit && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <label className="btn-ghost" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  📁 {form.logo_url ? 'Changer le logo' : 'Choisir un logo'}
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onLogo} style={{ display: 'none' }} />
                </label>
                {form.logo_url && (
                  <button type="button" className="btn-ghost" style={{ color: 'var(--accent-red)' }} onClick={() => setForm((f) => ({ ...f, logo_url: '' }))}>Retirer</button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <h4 style={cardTitleStyle}>📛 Identité</h4>
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Nom de l'entité *</label>
          <input type="text" value={form.nom} onChange={set('nom')} {...field} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>Sigle</label>
            <input type="text" maxLength={20} value={form.sigle} onChange={set('sigle')} {...field} />
          </div>
          <div>
            <label style={labelStyle}>Forme juridique</label>
            <select value={form.forme_juridique} onChange={set('forme_juridique')} {...field}>
              <option value="">— Sélectionner —</option>
              {formes.map((f) => <option key={f.code} value={f.code}>{f.label}{f.plan_referentiel === 'SYCEBNL' ? '  · plan SYCEBNL' : ''}</option>)}
            </select>
          </div>
        </div>
        {/* 060 : la forme juridique décide du plan comptable chargé. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '-2px 0 14px', padding: '9px 12px', borderRadius: 9,
          background: refChoisi === 'SYCEBNL' ? '#ecfdf5' : '#f8fafc', border: `1px solid ${refChoisi === 'SYCEBNL' ? '#a7f3d0' : 'var(--border)'}` }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Plan comptable</span>
          <PastilleReferentiel code={refChoisi} />
          <span style={{ fontSize: 12, color: 'var(--text-muted)', flex: '1 1 220px' }}>
            {refInfo?.description || (refChoisi === 'SYCEBNL' ? 'Entités à but non lucratif' : 'Entités à but lucratif')}
            {refChoisi !== planRef.actuel && <b style={{ color: '#b45309' }}> — sera appliqué à l'enregistrement</b>}
          </span>
        </div>
        {basculeAVenir && (
          <div style={{ margin: '-6px 0 14px', padding: '12px 14px', borderRadius: 10, background: refChoisi === 'SYCEBNL' ? '#f0fdf4' : '#eff6ff', border: `1px dashed ${refChoisi === 'SYCEBNL' ? '#86efac' : '#93c5fd'}` }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
              📚 À l'enregistrement, le plan comptable passera au {refChoisi === 'SYCEBNL' ? 'SYCEBNL' : 'SYSCOHADA révisé'} :
            </div>
            {!apercuForme ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Calcul de l'aperçu…</div> : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 8 }}>
                  {[[apercuForme.ajoutes, 'comptes ajoutés', '#059669'], [apercuForme.renommes, 'libellés repris', '#2563eb'],
                    [apercuForme.archives, 'comptes archivés', '#64748b'], [apercuForme.reactives, 'comptes réactivés', '#7c3aed']].map(([v, l, c]) => (
                    <div key={l} style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: c }}>{v ?? 0}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{l}</div>
                    </div>
                  ))}
                </div>
                {(apercuForme.renommes_utilises || []).length > 0 && (
                  <div style={{ fontSize: 12, color: '#92400e', marginTop: 8 }}>
                    ⚠️ Comptes utilisés par vos rubriques qui changent de libellé : {apercuForme.renommes_utilises.map((r) => `${r.compte} (${r.apres})`).join(' · ')}
                  </div>
                )}
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 8 }}>
                  Rien n'est supprimé : les comptes sortants sont archivés, les comptes utilisés et vos comptes additifs sont conservés. Revenir à l'ancienne forme restaure l'ancien plan.
                </div>
              </>
            )}
          </div>
        )}
        {!basculeAVenir && formeDejaEnregistreeDesalignee && refChoisi === planRef.attendu && (
          <div className="ctl-alerte" style={{ background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
            <span style={{ flex: '1 1 260px' }}>La forme juridique enregistrée relève du <b>{planRef.attendu === 'SYCEBNL' ? 'SYCEBNL' : 'SYSCOHADA révisé'}</b>, mais le plan comptable applique encore le <b>{planRef.actuel === 'SYCEBNL' ? 'SYCEBNL' : 'SYSCOHADA révisé'}</b>.</span>
            {canEdit && <button type="button" className="btn-ghost" style={{ background: 'white' }} onClick={ouvrirAlignement}>Aligner le plan comptable…</button>}
          </div>
        )}
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Activité principale</label>
          <input type="text" placeholder="Ex : Commerce général de produits divers" value={form.activite} onChange={set('activite')} {...field} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Nom du dirigeant</label>
          <input type="text" value={form.dirigeant_nom} onChange={set('dirigeant_nom')} {...field} />
        </div>
      </div>

      <div style={cardStyle}>
        <h4 style={cardTitleStyle}>📍 Coordonnées</h4>
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Adresse</label>
          <input type="text" placeholder="Ex : Avenue Kennedy, Yaoundé" value={form.adresse} onChange={set('adresse')} {...field} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>Boîte postale</label>
            <input type="text" placeholder="Ex : BP 1234" value={form.boite_postale} onChange={set('boite_postale')} {...field} />
          </div>
          <div>
            <label style={labelStyle}>Téléphone</label>
            <input type="tel" maxLength={60} placeholder="Ex : +237 6 99 00 00 00" value={form.telephone} onChange={set('telephone')} {...field} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>E-mail</label>
            <input type="email" placeholder="Ex : contact@entreprise.cm" value={form.email} onChange={set('email')} {...field} />
          </div>
          <div>
            <label style={labelStyle}>Site web</label>
            <input type="text" maxLength={120} placeholder="Ex : www.entreprise.cm" value={form.site_web} onChange={set('site_web')} {...field} />
          </div>
        </div>
      </div>

      <div style={{ ...cardStyle, background: '#f8fafc' }}>
        <h4 style={cardTitleStyle}>📄 Aperçu de l'en-tête des documents</h4>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
          {form.logo_url && <img src={form.logo_url} alt="" style={{ maxHeight: 46, maxWidth: 120, objectFit: 'contain' }} />}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#1e293b' }}>{form.nom || 'Nom de l\'entité'}{form.sigle && <small style={{ fontWeight: 600, color: '#64748b' }}> ({form.sigle.toUpperCase()})</small>}</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>{lignesEntite(form).coord.join(' · ') || 'Adresse · BP · Téléphone · E-mail'}</div>
            {lignesEntite(form).legal.length > 0 && <div style={{ fontSize: 11, color: '#64748b' }}>{lignesEntite(form).legal.join(' · ')}</div>}
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <h4 style={cardTitleStyle}>🏛️ Identifiants légaux</h4>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>Registre de commerce (RCCM)</label>
            <input type="text" placeholder="Ex : RC/YDE/2024/B/123" value={form.registre_commerce} onChange={set('registre_commerce')} {...field} />
          </div>
          <div>
            <label style={labelStyle}>NUI (Numéro Identifiant Unique)</label>
            <input type="text" maxLength={20} placeholder="Ex : M050000123456P" value={form.nui} onChange={set('nui')} {...field} />
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <h4 style={cardTitleStyle}>💰 Paramètres</h4>
        <label style={labelStyle}>Devise</label>
        <select value={form.devise} onChange={set('devise')} {...field}>
          <option value="FCFA">FCFA (XAF)</option>
          <option value="EUR">Euro (€)</option>
          <option value="USD">Dollar ($)</option>
        </select>
        {canEdit && (
          <div style={{ marginTop: 18 }}>
            <button className="btn-add" onClick={onSave} disabled={saving}>{saving ? 'Enregistrement…' : basculeAVenir ? `💾 Enregistrer et charger le plan ${refChoisi === 'SYCEBNL' ? 'SYCEBNL' : 'SYSCOHADA'}` : '💾 Enregistrer la configuration'}</button>
          </div>
        )}
      </div>

      <PeriodiciteBudget />

      {bascule && (
        <BasculePlanModal {...bascule} enCours={basculeEnCours}
          onConfirmer={confirmerBascule} onAnnuler={() => { if (!basculeEnCours) setBascule(null); }} />
      )}

      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>🔑 Pour changer votre mot de passe : cliquez sur votre nom, en bas du menu latéral (« Mon compte »).</p>
    </div>
  );
}
