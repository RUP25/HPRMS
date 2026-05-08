import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { animate, motion } from 'framer-motion';

function HeroAmbient() {
  return (
    <motion.div
      className="hero-motion-ambient"
      aria-hidden
      initial={{ opacity: 0 }}
      animate={{ opacity: [0.18, 0.36, 0.18] }}
      transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut' }}
    />
  );
}

function mountHeroMotion() {
  const stage = document.querySelector('.hero-stage');
  if (!stage || stage.querySelector('.hero-motion-root')) return;

  const mount = document.createElement('div');
  mount.className = 'hero-motion-root';
  stage.insertBefore(mount, stage.firstChild);

  createRoot(mount).render(
    <StrictMode>
      <HeroAmbient />
    </StrictMode>,
  );
}

function setupCartFabPop() {
  const fab = document.getElementById('cartFab');
  if (!fab) return;

  const pulse = () => {
    if (fab.hidden) return;
    animate(fab, { scale: [0.94, 1] }, { duration: 0.32, ease: 'easeOut' });
  };

  const mo = new MutationObserver(() => pulse());
  mo.observe(fab, { attributes: true, attributeFilter: ['hidden'] });
}

function init() {
  mountHeroMotion();
  setupCartFabPop();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
