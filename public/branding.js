// Use text nodes and local asset paths for all owner-editable branding.
export function applySalonBrand(shop) {
  if (!shop) return;
  const pageTitle = document.body.dataset.pageTitle;
  if (pageTitle) document.title = shop.name + ' · ' + pageTitle;

  document.querySelectorAll('[data-shop-name]').forEach(node => { node.textContent = shop.name; });
  document.querySelectorAll('[data-shop-location]').forEach(node => { node.textContent = shop.location; });
  document.querySelectorAll('[data-shop-description]').forEach(node => {
    node.textContent = shop.description;
    node.hidden = !shop.description;
  });

  for (const [selector, path] of [['[data-shop-logo]', shop.logoPath], ['[data-shop-image]', shop.imagePath]]) {
    if (!path || !path.startsWith('/') || new URL(path, location.href).origin !== location.origin) continue;
    for (const node of document.querySelectorAll(selector)) {
      if (node.hasAttribute('data-shop-image')) node.alt = shop.imageAlt || '';
      node.setAttribute(node.tagName === 'LINK' ? 'href' : 'src', path);
    }
  }
}
