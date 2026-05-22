let popupId = '';

const fallbackButtons = [{ id: 'ok', label: 'OK', kind: 'primary' }];
const actionAliases = new Map([
  ['Escape', 'ok'],
  ['Enter', 'ok'],
]);

function normalizeType(type) {
  if (
    type === 'error' ||
    type === 'warn' ||
    type === 'warning' ||
    type === 'success' ||
    type === 'updating'
  ) {
    return type === 'warning' ? 'warn' : type;
  }
  return 'info';
}

function sendAction(action) {
  window.launcherPopupAPI.sendAction(popupId, action || 'ok');
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value || '';
}

function setHidden(id, hidden) {
  const node = document.getElementById(id);
  if (node) node.hidden = hidden;
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '0 MB';
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function makeButton(button) {
  const el = document.createElement('button');
  const id = button.id || 'ok';
  const kind = button.kind || 'secondary';
  el.type = 'button';
  el.textContent = button.label || 'OK';
  el.className = ['action-button', 'ui-button', kind === 'primary' ? 'ui-button-primary' : '', kind]
    .filter(Boolean)
    .join(' ');
  el.dataset.action = id;
  el.addEventListener('click', () => sendAction(id));
  return el;
}

function renderButtons(buttons) {
  const actions = document.getElementById('actions');
  actions.replaceChildren();
  const source = (buttons && buttons.length ? buttons : fallbackButtons).filter(
    (button) => (button.id || 'ok') !== 'dismiss',
  );
  const byId = new Map(source.map((button) => [button.id || 'ok', button]));
  const leftAction = byId.get('try-fork') || byId.get('use-fork');
  const rightOrder = ['continue-official', 'ok', 'retry', 'copy'];
  const rightButtons = rightOrder.map((id) => byId.get(id)).filter(Boolean);
  const shown = new Set(['try-fork', 'use-fork', ...rightOrder]);
  const extras = source.filter((button) => !shown.has(button.id || 'ok'));

  if (leftAction) actions.appendChild(makeButton(leftAction));
  const spacer = document.createElement('span');
  spacer.className = 'action-spacer';
  actions.appendChild(spacer);

  const right = document.createElement('div');
  right.className = 'right-actions ui-action-row';
  for (const button of [...rightButtons, ...extras]) right.appendChild(makeButton(button));
  actions.appendChild(right);
}

window.launcherPopupAPI.onInit((payload = {}) => {
  popupId = payload.id || '';
  const type = normalizeType(payload.type);
  const card = document.getElementById('card');
  card.className = `popup-card ui-panel ${type}`;
  document.body.dataset.type = type;

  setText('title', payload.title || 'ISpooferLauncher');
  setText('message', payload.message || 'ISpooferMotion');
  setText('detail', payload.detail || '');
  setText(
    'state-label',
    type === 'error'
      ? 'Needs attention'
      : type === 'warn'
        ? 'Warning'
        : type === 'success'
          ? 'Ready'
          : type === 'updating'
            ? 'Updating...'
            : 'Launcher popup',
  );

  if (type === 'updating') {
    // Show spinner and indeterminate progress bar; hide buttons
    setHidden('spinner-wrap', false);
    setHidden('progress-wrap', false);
    setHidden('close-popup', true);
    document.getElementById('actions').hidden = true;
    // Start indeterminate animation until real progress arrives
    document.getElementById('progress-bar').classList.add('indeterminate');
  } else {
    renderButtons(payload.buttons);
  }
});

window.launcherPopupAPI.ready(new URLSearchParams(window.location.search).get('id') || '');

// Handle live progress updates (sent from main process during download)
window.launcherPopupAPI.onProgress((payload = {}) => {
  if (payload.message) setText('message', payload.message);

  const downloaded = Number(payload.downloaded || 0);
  const total = Number(payload.total || 0);

  if (total > 0 && downloaded >= 0) {
    const pct = Math.min(100, Math.round((downloaded / total) * 100));
    const bar = document.getElementById('progress-bar');
    bar.classList.remove('indeterminate');
    bar.style.width = `${pct}%`;

    const label = document.getElementById('progress-label');
    label.textContent = `${formatBytes(downloaded)} / ${formatBytes(total)}`;
    label.hidden = false;
  }
});

// Handle auto-close (main process tells us to wrap up)
window.launcherPopupAPI.onAutoClose((payload = {}) => {
  if (payload.message) setText('message', payload.message);
  // Fill bar to 100% and fade out
  const bar = document.getElementById('progress-bar');
  bar.classList.remove('indeterminate');
  bar.style.width = '100%';

  const delay = Number(payload.delay) > 0 ? Number(payload.delay) : 1200;
  const card = document.getElementById('card');
  setTimeout(() => {
    card.style.transition = 'opacity 300ms ease';
    card.style.opacity = '0';
    setTimeout(() => sendAction('dismiss'), 320);
  }, delay - 320);
});

document.getElementById('close-popup').addEventListener('click', () => sendAction('dismiss'));

window.addEventListener('keydown', (event) => {
  const action = actionAliases.get(event.key);
  if (action) sendAction(action);
});
