const statusEl = document.querySelector('#status');
const statusText = document.querySelector('#statusText');
const scrim = document.querySelector('#scrim');
const sheetTitle = document.querySelector('#sheetTitle');
const sheetBody = document.querySelector('#sheetBody');
const actionButton = document.querySelector('#actionButton');
const codeForm = document.querySelector('#codeForm');
const pairCode = document.querySelector('#pairCode');
const toast = document.querySelector('#toast');
const keys = [...document.querySelectorAll('[data-key]')];

let currentState = null;
let toastTimer;

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (response.status === 204) return null;
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Request failed.');
  return body;
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
}

function render(state) {
  currentState = state;
  const connected = state.phase === 'connected';
  statusEl.classList.toggle('connected', connected);
  statusText.textContent = connected ? (state.device?.name || 'Connected') : {
    searching: 'Looking for TV',
    found: state.device?.name || 'TV found',
    pairing: 'Starting pairing',
    code: 'Pairing',
    connecting: 'Connecting',
    error: 'Connection issue',
  }[state.phase] || 'Offline';
  keys.forEach((key) => { key.disabled = !connected; });

  scrim.hidden = connected;
  actionButton.hidden = true;
  codeForm.hidden = true;

  if (state.phase === 'searching') {
    sheetTitle.textContent = 'Finding your TV';
    sheetBody.textContent = 'Keep this phone and the server on the same network as your Chromecast.';
  } else if (state.phase === 'found') {
    sheetTitle.textContent = state.paired ? 'Reconnect to your TV' : `Pair with ${state.device?.name || 'your TV'}`;
    sheetBody.textContent = state.paired ? 'The saved connection needs to be started again.' : 'A pairing code will appear on your TV. You only need to do this once.';
    actionButton.textContent = state.paired ? 'Reconnect' : 'Pair this TV';
    actionButton.hidden = false;
  } else if (state.phase === 'pairing' || state.phase === 'connecting') {
    sheetTitle.textContent = state.phase === 'pairing' ? 'Starting pairing' : 'Connecting';
    sheetBody.textContent = 'This should only take a moment.';
  } else if (state.phase === 'code') {
    sheetTitle.textContent = 'Enter the TV code';
    sheetBody.textContent = `Type the code shown on ${state.device?.name || 'your TV'}.`;
    codeForm.hidden = false;
    setTimeout(() => pairCode.focus(), 80);
  } else if (state.phase === 'error') {
    sheetTitle.textContent = 'Could not connect';
    sheetBody.textContent = state.error || 'Check the Chromecast and try again.';
    actionButton.textContent = 'Try again';
    actionButton.hidden = false;
  }
}

async function refresh() {
  try {
    render(await api('/api/status'));
  } catch {
    statusEl.classList.remove('connected');
    statusText.textContent = 'Server offline';
  }
}

actionButton.addEventListener('click', async () => {
  actionButton.disabled = true;
  try {
    const endpoint = currentState?.paired ? '/api/reconnect' : '/api/pair';
    render(await api(endpoint, { method: 'POST', body: '{}' }));
  } catch (error) {
    showToast(error.message);
  } finally {
    actionButton.disabled = false;
  }
});

codeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    render(await api('/api/pair/code', { method: 'POST', body: JSON.stringify({ code: pairCode.value }) }));
    pairCode.value = '';
  } catch (error) {
    showToast(error.message);
    void refresh();
  }
});

keys.forEach((button) => {
  button.addEventListener('click', async () => {
    if (navigator.vibrate) navigator.vibrate(10);
    try {
      await api('/api/key', { method: 'POST', body: JSON.stringify({ key: button.dataset.key }) });
    } catch (error) {
      showToast(error.message);
      void refresh();
    }
  });
});

void refresh();
setInterval(refresh, 1500);
