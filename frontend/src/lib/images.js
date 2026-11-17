// lib/images.js — préparation d'une image (logo, signature) dans le navigateur.
// L'image est redimensionnée puis renvoyée en data URL PNG / JPEG : légère en
// base et affichée telle quelle sur les documents imprimés, même hors ligne.
// Les images vectorielles (SVG) sont refusées : elles peuvent contenir du script.
export function preparerImage(fichier, { maxL = 600, maxH = 300, maxCaracteres = 380 * 1024 } = {}) {
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
      let echelle = Math.min(1, maxL / img.width, maxH / img.height);
      const transparent = fichier.type !== 'image/jpeg';
      for (let essai = 0; essai < 5; essai += 1) {
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * echelle));
        c.height = Math.max(1, Math.round(img.height * echelle));
        const ctx = c.getContext('2d');
        if (!transparent) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const data = transparent ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9);
        if (data.length <= maxCaracteres) { resolve(data); return; }
        echelle *= 0.75;
      }
      reject(new Error('Image trop détaillée : essayez une version plus simple ou en JPEG.'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Impossible de lire cette image.')); };
    img.src = url;
  });
}
