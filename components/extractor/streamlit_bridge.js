/* Nested extractor → parent clinic interface. Deliberately does not speak to Streamlit. */
'use strict';
const StreamlitBridge = (() => {
  const RENDER_EVENT = 'streamlit:render';
  const events = new EventTarget();
  const targetOrigin = window.location.origin;
  let lastHeight = null;
  function post(type, details = {}) {
    window.parent.postMessage({type: `nkpi:extractor:${type}`, session:lastStreamlitResetToken, ...details}, targetOrigin);
  }
  function onMessage(event) {
    if (event.source !== window.parent || event.origin !== targetOrigin) return;
    if (event.data?.type !== 'nkpi:extractor:init') return;
    const data = event.data;
    events.dispatchEvent(new CustomEvent(RENDER_EVENT, {detail: {args: {reset_token: data.reset_token ?? 0}}}));
    window.publishSourceReportMaps?.();
    if (['baseline','longitudinal'].includes(data.mode)) {
      const radio = document.querySelector(`input[name="mode"][value="${data.mode}"]`);
      if (radio && !radio.checked) {radio.checked = true; radio.dispatchEvent(new Event('change', {bubbles:true}));}
    }
    if (Number.isFinite(data.age)) {
      const age = document.getElementById('age');
      if (age && age.value !== String(data.age)) {age.value = String(data.age); age.dispatchEvent(new Event('input', {bubbles:true}));}
    }
  }
  function setComponentReady() {
    window.addEventListener('message', onMessage);
    post('ready');
  }
  function setComponentValue(message) {
    if (message.action === 'submit') {
      const payload = window.NKPIImport.sanitize(message.payload);
      post('submit', {payload, nonce: message.nonce});
    } else if (message.action === 'clear') post('clear', {nonce: message.nonce});
    else if (message.action === 'dirty') post('dirty');
  }
  function measureContentHeight() {
    if (!document.body) return 150;
    const top = document.body.getBoundingClientRect().top;
    let bottom = top;
    for (const child of document.body.children) {
      const style = getComputedStyle(child);
      if (style.display === 'none' || style.visibility === 'hidden' || child.classList.contains('hidden-canvas')) continue;
      bottom = Math.max(bottom, child.getBoundingClientRect().bottom);
    }
    return Math.max(150, Math.ceil(bottom - top + 8));
  }
  function setFrameHeight(height) {
    const next = Number.isFinite(height) ? Math.max(150, Math.ceil(height)) : measureContentHeight();
    if (next === lastHeight) return;
    lastHeight = next;
    post('height', {height:next});
  }
  return {API_VERSION:1, RENDER_EVENT, events, setComponentReady, setComponentValue, measureContentHeight, setFrameHeight};
})();
window.StreamlitBridge = StreamlitBridge;
