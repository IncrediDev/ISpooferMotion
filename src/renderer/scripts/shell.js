'use strict';

window.ISM = window.ISM || {};

(function registerShell() {
  const { $, $$, byId, setText } = window.ISM.dom;
  const api = window.electronAPI || {};

  function showView(viewName) {
    const target = viewName || 'spoofer';
    $$('[data-view-panel]').forEach((panel) => {
      panel.classList.toggle('is-active', panel.dataset.viewPanel === target);
    });
    $$('.side-link').forEach((button) => {
      const active = button.dataset.view === target;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }

  function initNavigation() {
    $$('.side-link').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.disabled || button.getAttribute('aria-disabled') === 'true') return;
        showView(button.dataset.view);
      });
    });
    byId('open-activity-btn')?.addEventListener('click', () => showView('queue'));
  }

  function initWindowButtons() {
    byId('sidebar-toggle')?.addEventListener('click', () =>
      byId('app-shell')?.classList.toggle('sidebar-collapsed'),
    );
    byId('minimize-btn')?.addEventListener('click', () => api.minimize?.());
    byId('close-btn')?.addEventListener('click', () => api.close?.());
    $$('[data-url]').forEach((button) => {
      button.addEventListener('click', () => api.openExternal?.(button.dataset.url));
    });
  }

  function initProfileMenu() {
    const picker = $('.profile-picker');
    const trigger = byId('profile-trigger');
    const label = byId('profile-trigger-label');
    const close = () => {
      picker?.classList.remove('open');
      trigger?.setAttribute('aria-expanded', 'false');
    };

    // Profiles are not active yet. Keep the top-bar profile visible for context,
    // but do not allow opening/changing profiles until the Profiles page is rebuilt.
    trigger?.setAttribute('disabled', '');
    trigger?.setAttribute('aria-disabled', 'true');
    trigger?.setAttribute('aria-expanded', 'false');
    trigger?.setAttribute('title', 'Profiles are not available yet');
    setText(label, label?.textContent?.trim() || 'Profile 1');
    close();
  }

  async function initBuildMeta() {
    setText(byId('build-version'), 'v1.3.10-hotfix.1');

    try {
      const source = await api.getReleaseSource?.();
      if (source) setText(byId('build-source'), source);
    } catch {}
  }

  function formatQuotaResult(result) {
    if (!result || typeof result !== 'object') return 'Quota data unavailable.';
    if (result.error) return `Could not fetch quota: ${result.error}`;

    let used = null;
    let capacity = null;

    if (Array.isArray(result.quotas)) {
      const monthlyQuota = result.quotas.find(
        (item) => String(item?.duration || '').toLowerCase() === 'month',
      );
      const quota = monthlyQuota || result.quotas[0];
      if (quota) {
        used = Number(quota.usage ?? quota.used ?? quota.consumed ?? 0);
        capacity = Number(quota.capacity ?? quota.limit ?? quota.total ?? 0);
      }
    } else if (result.usage && typeof result.usage === 'object') {
      used = Number(result.usage.used ?? result.usage.usage ?? 0);
      capacity = Number(result.usage.capacity ?? result.usage.total ?? result.usage.limit ?? 0);
    } else {
      used = Number(result.usage ?? result.used ?? 0);
      capacity = Number(result.capacity ?? result.total ?? result.limit ?? 0);
    }

    if (!Number.isFinite(used) || !Number.isFinite(capacity) || capacity <= 0) {
      return 'Quota data unavailable.';
    }

    const remaining = Math.max(0, capacity - used);
    return `Audio quota: ${used.toLocaleString()} / ${capacity.toLocaleString()} used (${remaining.toLocaleString()} remaining)`;
  }

  function isQuotaWarning(result) {
    if (!result || result.error) return false;

    let used = null;
    let capacity = null;
    if (Array.isArray(result.quotas)) {
      const quota =
        result.quotas.find((item) => String(item?.duration || '').toLowerCase() === 'month') ||
        result.quotas[0];
      used = Number(quota?.usage ?? quota?.used ?? quota?.consumed ?? 0);
      capacity = Number(quota?.capacity ?? quota?.limit ?? quota?.total ?? 0);
    } else if (result.usage && typeof result.usage === 'object') {
      used = Number(result.usage.used ?? result.usage.usage ?? 0);
      capacity = Number(result.usage.capacity ?? result.usage.total ?? result.usage.limit ?? 0);
    } else {
      used = Number(result.usage ?? result.used ?? 0);
      capacity = Number(result.capacity ?? result.total ?? result.limit ?? 0);
    }

    return (
      Number.isFinite(used) && Number.isFinite(capacity) && capacity > 0 && used / capacity >= 0.8
    );
  }

  function initQuotaPopup() {
    const button = byId('quota-info-btn');
    const popup = byId('quota-popup');
    const popupText = byId('quota-popup-text');
    let closeTimer = null;

    const close = () => {
      popup?.classList.remove('is-open', 'is-flashing');
      clearTimeout(closeTimer);
      closeTimer = null;
    };

    button?.addEventListener('click', async (event) => {
      event.stopPropagation();

      if (popup?.classList.contains('is-open')) {
        close();
        return;
      }

      popup?.classList.add('is-open');
      popup?.classList.remove('is-flashing');
      setText(popupText, 'Checking quota...');

      try {
        const cookie = byId('robloxCookie')?.value?.trim() || '';
        const autoDetect = Boolean(byId('autoDetectCookie')?.checked);
        const result = await api.getAudioQuota?.({ cookie, autoDetect });
        setText(popupText, formatQuotaResult(result));
        if (isQuotaWarning(result)) popup?.classList.add('is-flashing');
      } catch (error) {
        setText(popupText, `Could not fetch quota: ${error?.message || 'Unknown error'}`);
      }

      closeTimer = setTimeout(close, 8000);
    });

    popup?.addEventListener('click', (event) => event.stopPropagation());
    document.addEventListener('click', close);
  }

  function init() {
    initNavigation();
    initWindowButtons();
    initProfileMenu();
    initBuildMeta();
    initQuotaPopup();
  }

  window.ISM.shell = Object.freeze({ init, showView });
})();
