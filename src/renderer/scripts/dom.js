'use strict';

window.ISM = window.ISM || {};

window.ISM.dom = Object.freeze({
  $: (selector, root = document) => root.querySelector(selector),
  $$: (selector, root = document) => Array.from(root.querySelectorAll(selector)),
  byId: (id) => document.getElementById(id),
  isInput: (element) =>
    element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement,
  setText(element, value) {
    if (element) element.textContent = value == null ? '' : String(value);
  },
  setHidden(element, hidden) {
    if (element) element.hidden = Boolean(hidden);
  },
  copyText(text) {
    const value = String(text || '');
    if (!value) return Promise.resolve(false);
    if (navigator.clipboard?.writeText)
      return navigator.clipboard.writeText(value).then(() => true);

    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return Promise.resolve(ok);
  },
});
