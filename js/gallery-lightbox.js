/**
 * Gallery Lightbox
 * Adds click-to-open modal functionality to .masonry-gallery images.
 * Supports keyboard navigation (← → Esc), swipe-friendly close, and prev/next.
 */
(function () {
  let currentIndex = 0;
  let items = [];
  let lightbox = null;

  function createLightbox() {
    lightbox = document.createElement('div');
    lightbox.className = 'lightbox-overlay';
    lightbox.setAttribute('role', 'dialog');
    lightbox.setAttribute('aria-modal', 'true');
    lightbox.setAttribute('aria-label', 'Visor de imagen');
    lightbox.innerHTML = `
      <button class="lightbox-close" aria-label="Cerrar">&times;</button>
      <button class="lightbox-prev" aria-label="Imagen anterior">&#8249;</button>
      <button class="lightbox-next" aria-label="Imagen siguiente">&#8250;</button>
      <div class="lightbox-content">
        <img class="lightbox-img" src="" alt="" />
        <div class="lightbox-caption">
          <h4></h4>
          <p></p>
        </div>
      </div>
    `;
    document.body.appendChild(lightbox);

    lightbox.querySelector('.lightbox-close').addEventListener('click', close);
    lightbox.querySelector('.lightbox-prev').addEventListener('click', prev);
    lightbox.querySelector('.lightbox-next').addEventListener('click', next);
    lightbox.addEventListener('click', function (e) {
      if (e.target === lightbox) close();
    });
  }

  function show(index) {
    currentIndex = index;
    const item = items[index];
    const img = item.querySelector('.masonry-image');
    const overlay = item.querySelector('.masonry-overlay');
    const title = overlay ? overlay.querySelector('h4')?.textContent || '' : '';
    const desc = overlay ? overlay.querySelector('p')?.textContent || '' : '';

    const lbImg = lightbox.querySelector('.lightbox-img');
    const caption = lightbox.querySelector('.lightbox-caption');

    lbImg.src = img.src;
    lbImg.alt = img.alt;
    caption.querySelector('h4').textContent = title;
    caption.querySelector('p').textContent = desc;

    lightbox.classList.add('lightbox-active');
    document.body.style.overflow = 'hidden';

    // Manage nav button visibility
    lightbox.querySelector('.lightbox-prev').style.display = items.length > 1 ? '' : 'none';
    lightbox.querySelector('.lightbox-next').style.display = items.length > 1 ? '' : 'none';
  }

  function close() {
    lightbox.classList.remove('lightbox-active');
    document.body.style.overflow = '';
  }

  function prev(e) {
    if (e) e.stopPropagation();
    currentIndex = (currentIndex - 1 + items.length) % items.length;
    show(currentIndex);
  }

  function next(e) {
    if (e) e.stopPropagation();
    currentIndex = (currentIndex + 1) % items.length;
    show(currentIndex);
  }

  function onKeyDown(e) {
    if (!lightbox || !lightbox.classList.contains('lightbox-active')) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') prev();
    if (e.key === 'ArrowRight') next();
  }

  function init() {
    const galleries = document.querySelectorAll('.masonry-gallery');
    if (!galleries.length) return;

    createLightbox();
    document.addEventListener('keydown', onKeyDown);

    galleries.forEach(function (gallery) {
      const galleryItems = Array.from(gallery.querySelectorAll('.masonry-item'));
      galleryItems.forEach(function (item, i) {
        item.addEventListener('click', function () {
          items = galleryItems;
          show(i);
        });
      });
    });
  }

  // Init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
