/* Portal APH — instalação e atualização PWA (apenas lado cliente). */
(() => {
  'use strict';
  let deferredPrompt = null;
  let workerWaiting = null;
  let reloadingAfterUpdate = false;
  const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const byId = id => document.getElementById(id);
  const installButtons = () => Array.from(document.querySelectorAll('[data-pwa-install]'));
  const updateInstallUI = () => installButtons().forEach(el => { el.hidden = isInstalled(); });

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    updateInstallUI();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    updateInstallUI();
  });

  async function installApp() {
    if (isInstalled()) return;
    if (deferredPrompt) {
      const prompt = deferredPrompt;
      deferredPrompt = null;
      try { await prompt.prompt(); await prompt.userChoice; } catch (error) {
        console.warn('Instalação não disponível:', error);
      }
      return;
    }
    const message = isIOS()
      ? 'Para instalar no iPhone ou iPad, abra este endereço no Safari, toque em Compartilhar e escolha “Adicionar à Tela de Início”.'
      : 'Para instalar o Portal APH, abra o menu do navegador (⋮) e escolha “Instalar aplicativo” ou “Adicionar à tela inicial”. Se a opção ainda não aparecer, recarregue a página com internet.';
    alert(message);
  }

  function updateConnectivityBanner() {
    const banner = byId('pwaOfflineBanner');
    if (banner) banner.hidden = navigator.onLine;
  }
  function offerUpdate(waiting) {
    if (!waiting || !navigator.serviceWorker.controller) return;
    workerWaiting = waiting;
    const banner = byId('pwaUpdateNotice');
    if (banner) banner.hidden = false;
  }

  async function initServiceWorker() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/', updateViaCache: 'none'
      });
      if (registration.waiting) offerUpdate(registration.waiting);
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(installing);
        });
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloadingAfterUpdate) window.location.reload();
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && navigator.onLine) {
          registration.update().catch(() => {});
        }
      });
    } catch (error) {
      console.warn('PWA indisponível, portal continua funcionando online:', error);
    }
  }

  function init() {
    installButtons().forEach(btn => btn.addEventListener('click', () => {
      const closeDrawer = byId('drawerClose');
      if (closeDrawer && document.body.classList.contains('drawer-open')) closeDrawer.click();
      installApp();
    }));
    updateInstallUI();
    updateConnectivityBanner();
    window.addEventListener('online', updateConnectivityBanner);
    window.addEventListener('offline', updateConnectivityBanner);
    byId('pwaUpdateApply')?.addEventListener('click', () => {
      if (!workerWaiting) return;
      reloadingAfterUpdate = true;
      workerWaiting.postMessage({type: 'APH_ACTIVATE_UPDATE'});
    });
    byId('pwaUpdateDismiss')?.addEventListener('click', () => {
      const banner = byId('pwaUpdateNotice');
      if (banner) banner.hidden = true;
    });
    initServiceWorker();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true});
  else init();
})();
