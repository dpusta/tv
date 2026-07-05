import express from 'express';
import { Bonjour } from 'bonjour-service';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AndroidRemote, KEY_MAP, RemoteDirection } from './keys.js';
import { normalizePairingCode } from './pairing-code.js';
import { createImeStateDecoder, createImeTextMessage } from './remote-ime.js';
import { patchRemoteFeatureNegotiation } from './remote-protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');
const credentialsFile = path.join(dataDir, 'remote.json');
const port = Number(process.env.PORT || 3000);

const libraryDebug = console.debug.bind(console);
console.debug = (...args) => {
  if (process.env.DEBUG_REMOTE !== '1') return;
  libraryDebug(...args.map((argument) => (
    typeof argument === 'string'
      ? argument.replace(/("value"\s*:\s*")[^"]*/g, '$1[redacted]')
      : argument
  )));
};

patchRemoteFeatureNegotiation();

const state = {
  phase: 'searching',
  device: null,
  powered: null,
  volume: null,
  error: null,
};

let credentials = null;
let remote = null;
let connectingHost = null;
let connectTimer = null;
let reconnectTimer = null;
let bonjour = null;
let lastRemoteActivity = 0;
let lastConnectAttempt = 0;
let observedClient = null;
let textSending = false;
let imeState = {};
let imeDecoder = null;
let lastImeTextAt = 0;

const CONNECTION_TIMEOUT_MS = 15_000;
const STALE_CONNECTION_MS = 25_000;
const RETRY_INTERVAL_MS = 15_000;

function publicState() {
  return {
    ...state,
    paired: Boolean(credentials?.cert?.key && credentials?.cert?.cert),
  };
}

async function loadCredentials() {
  try {
    credentials = JSON.parse(await readFile(credentialsFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Could not read saved credentials:', error);
  }
}

async function saveCredentials() {
  await mkdir(dataDir, { recursive: true });
  await writeFile(credentialsFile, JSON.stringify(credentials, null, 2), { mode: 0o600 });
}

async function clearCredentials() {
  credentials = null;
  try {
    await unlink(credentialsFile);
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Could not remove saved credentials:', error);
  }
}

function ipv4Address(service) {
  return service.addresses?.find((address) => /^\d{1,3}(\.\d{1,3}){3}$/.test(address));
}

function discover(service) {
  const host = ipv4Address(service);
  if (!host) return;

  if (state.device?.host === host && (connectingHost || state.phase === 'connected')) return;

  state.device = {
    name: service.txt?.fn || service.name || 'Google TV',
    host,
  };

  if (state.phase === 'connected') {
    scheduleReconnect('Chromecast network address changed.', 250);
    return;
  }

  if (connectingHost) return;
  state.phase = credentials ? 'connecting' : 'found';
  state.error = null;

  if (credentials) void connect(host, false);
}

function teardownRemote() {
  const oldRemote = remote;
  remote = null;
  observedClient = null;
  lastRemoteActivity = 0;
  imeState = {};
  imeDecoder = null;

  if (!oldRemote) return;

  const manager = oldRemote.remoteManager;
  if (manager) {
    // Disable the package's recursive reconnect loop; this server owns retries.
    manager.start = async () => false;
    manager.removeAllListeners();
    if (manager.client) {
      manager.client.removeAllListeners('close');
      manager.client.destroy();
    }
  }

  const pairingClient = oldRemote.pairingManager?.client;
  if (pairingClient) {
    pairingClient.removeAllListeners('close');
    pairingClient.destroy();
  }
  oldRemote.removeAllListeners();
}

function scheduleReconnect(reason, delay = 1_000) {
  if (!credentials || !state.device || reconnectTimer) return;

  console.info(`Scheduling Chromecast reconnect: ${reason}`);
  state.phase = 'connecting';
  state.error = null;
  connectingHost = null;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect(state.device.host, false, true);
  }, delay);
}

function observeRemoteClient(currentRemote) {
  const client = currentRemote.remoteManager?.client;
  if (!client || client === observedClient) return;

  observedClient = client;
  lastRemoteActivity = Date.now();
  imeDecoder = createImeStateDecoder((update) => {
    if (remote === currentRemote) imeState = { ...imeState, ...update };
  });

  client.on('data', (data) => {
    if (remote !== currentRemote) return;
    lastRemoteActivity = Date.now();
    imeDecoder?.push(data);
  });
  client.once('close', () => {
    if (remote !== currentRemote) return;
    // Prevent the library's delayed close handler from opening a competing socket.
    if (currentRemote.remoteManager) currentRemote.remoteManager.start = async () => false;
    scheduleReconnect('remote socket closed');
  });
}

async function verifyImeText(expected, previousCounterField, timeout = 3_000) {
  const deadline = Date.now() + timeout;
  let latest = '';

  while (Date.now() < deadline) {
    if (
      imeState.counterField !== previousCounterField
      && typeof imeState.value === 'string'
    ) {
      latest = imeState.value;
      if (latest.length >= expected.length) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  if (latest === expected) return;

  const mismatch = [...expected].findIndex((character, index) => [...latest][index] !== character);
  if (mismatch >= 0 && latest.length >= expected.length) {
    throw new Error(`The TV altered the character at position ${mismatch + 1}. Nothing was submitted.`);
  }
  throw new Error(`The TV accepted ${[...latest].length} of ${[...expected].length} characters. Nothing was submitted.`);
}

async function connect(host, pairing, force = false) {
  if (!host) throw new Error('No Chromecast has been found yet.');
  if (!force && (connectingHost === host || state.phase === 'connected')) return;

  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  teardownRemote();
  connectingHost = host;
  lastConnectAttempt = Date.now();
  state.phase = pairing ? 'pairing' : 'connecting';
  state.error = null;
  clearTimeout(connectTimer);

  try {
    const currentRemote = new AndroidRemote(host, {
      pairing_port: 6467,
      remote_port: 6466,
      service_name: 'Pocket Remote',
      cert: pairing ? {} : credentials?.cert || {},
    });
    remote = currentRemote;

    currentRemote.on('secret', () => {
      if (remote !== currentRemote) return;
      state.phase = 'code';
    });
    currentRemote.on('ready', async () => {
      if (remote !== currentRemote) return;
      state.phase = 'connected';
      state.error = null;
      connectingHost = null;
      clearTimeout(connectTimer);
      observeRemoteClient(currentRemote);
      credentials = { cert: currentRemote.getCertificate() };
      try {
        await saveCredentials();
      } catch (error) {
        state.error = `Connected, but credentials could not be saved: ${error.message}`;
      }
    });
    currentRemote.on('powered', (powered) => {
      if (remote === currentRemote) state.powered = powered;
    });
    currentRemote.on('volume', (volume) => {
      if (remote === currentRemote) state.volume = volume;
    });
    currentRemote.on('unpaired', () => {
      if (remote !== currentRemote) return;
      void clearCredentials();
      state.phase = 'found';
      state.error = 'The saved pairing no longer works. Pair this TV again.';
      connectingHost = null;
      teardownRemote();
    });
    currentRemote.on('error', (error) => {
      if (remote !== currentRemote) return;
      state.error = error.message || 'Chromecast connection error.';
    });

    connectTimer = setTimeout(() => {
      if (
        remote === currentRemote
        && (state.phase === 'connecting' || state.phase === 'pairing')
      ) {
        state.phase = credentials ? 'found' : 'error';
        state.error = 'The Chromecast did not respond. Check that it is awake and on the same network.';
        connectingHost = null;
        teardownRemote();
      }
    }, CONNECTION_TIMEOUT_MS);

    void currentRemote.start()
      .then((started) => {
        if (remote !== currentRemote) return;
        observeRemoteClient(currentRemote);
        if (!started && state.phase !== 'connected' && state.phase !== 'code') {
          clearTimeout(connectTimer);
          connectingHost = null;
          state.phase = 'error';
          state.error ||= 'Pairing was not accepted by the TV. Start pairing again.';
          teardownRemote();
        }
      })
      .catch((error) => {
        if (remote !== currentRemote) return;
        clearTimeout(connectTimer);
        connectingHost = null;
        state.phase = 'error';
        state.error = error.message || 'Could not connect to the Chromecast.';
        teardownRemote();
      });
  } catch (error) {
    connectingHost = null;
    state.phase = 'error';
    state.error = error.message;
    throw error;
  }
}

const app = express();
app.use(express.json({ limit: '2kb' }));
app.use(express.static(path.join(root, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders(response) {
    response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  },
}));

app.get('/api/status', (_request, response) => response.json(publicState()));

app.post('/api/pair', async (_request, response) => {
  if (!state.device) return response.status(409).json({ error: 'No Chromecast found.' });
  try {
    await connect(state.device.host, true);
    response.status(202).json(publicState());
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.post('/api/pair/code', (request, response) => {
  const code = normalizePairingCode(request.body?.code);
  if (state.phase !== 'code' || !remote) return response.status(409).json({ error: 'The TV is not waiting for a pairing code.' });
  if (!code) return response.status(400).json({ error: 'Enter all 6 letters and numbers shown on the TV.' });
  try {
    state.phase = 'connecting';
    clearTimeout(connectTimer);
    connectTimer = setTimeout(() => {
      if (state.phase === 'connecting') {
        state.phase = 'error';
        state.error = 'Pairing did not complete. Check the code and try again.';
        connectingHost = null;
        teardownRemote();
      }
    }, 15_000);
    const accepted = remote.sendCode(code);
    if (!accepted) {
      clearTimeout(connectTimer);
      connectingHost = null;
      state.phase = 'error';
      state.error = 'That code was rejected. Start pairing again and enter the new 6-character code.';
      return response.status(400).json({ error: state.error });
    }
    response.status(202).json(publicState());
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.post('/api/key', (request, response) => {
  const requestedKey = request.body?.key;
  if (textSending && (requestedKey === 'enter' || requestedKey === 'keyboard_enter')) {
    return response.status(409).json({ error: 'Wait for the password to finish transferring.' });
  }
  const key = requestedKey === 'enter' && Date.now() - lastImeTextAt < 3_000
    ? 'keyboard_enter'
    : requestedKey;
  if (state.phase !== 'connected' || !remote) return response.status(409).json({ error: 'Chromecast is not connected.' });
  if (key !== 'power' && !(key in KEY_MAP)) return response.status(400).json({ error: 'Unknown remote key.' });
  const client = remote.remoteManager?.client;
  if (!client || client.destroyed || !client.writable) {
    scheduleReconnect('key pressed while socket was unavailable', 250);
    return response.status(503).json({ error: 'Chromecast is reconnecting. Try again in a moment.' });
  }
  try {
    if (key === 'power') remote.sendPower();
    else remote.sendKey(KEY_MAP[key], RemoteDirection.SHORT);
    response.status(204).end();
  } catch (error) {
    response.status(503).json({ error: error.message });
  }
});

app.post('/api/text', async (request, response) => {
  const text = typeof request.body?.text === 'string' ? request.body.text : '';
  if (state.phase !== 'connected' || !remote) return response.status(409).json({ error: 'Chromecast is not connected.' });
  if (!text || text.length > 256) return response.status(400).json({ error: 'Text must contain between 1 and 256 characters.' });
  if (textSending) return response.status(409).json({ error: 'Text is already being sent.' });

  const client = remote.remoteManager?.client;
  if (!client || client.destroyed || !client.writable) {
    scheduleReconnect('text entered while socket was unavailable', 250);
    return response.status(503).json({ error: 'Chromecast is reconnecting. Try again in a moment.' });
  }

  textSending = true;
  try {
    console.info(`Sending IME text (${[...text].length} characters)`);
    // Android TV Remote Service rejects IME batches while its virtual keyboard
    // is visible. BACK hides it while preserving the focused text field.
    remote.sendKey(KEY_MAP.back, RemoteDirection.SHORT);
    await new Promise((resolve) => setTimeout(resolve, 350));
    const previousCounterField = imeState.counterField;
    client.write(createImeTextMessage(text, imeState));
    lastImeTextAt = Date.now();
    await verifyImeText(text, previousCounterField);
    console.info(`IME text verified (${[...text].length} characters)`);
    response.status(204).end();
  } catch (error) {
    response.status(503).json({ error: error.message });
  } finally {
    textSending = false;
  }
});

app.post('/api/reconnect', async (_request, response) => {
  if (!state.device) return response.status(409).json({ error: 'No Chromecast found.' });
  connectingHost = null;
  try {
    await connect(state.device.host, !credentials);
    response.status(202).json(publicState());
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

await loadCredentials();

if (process.env.CHROMECAST_HOST) {
  discover({
    name: process.env.CHROMECAST_NAME || 'Google TV',
    addresses: [process.env.CHROMECAST_HOST],
  });
} else {
  bonjour = new Bonjour();
  bonjour.server.mdns.on('error', (error) => {
    console.error('mDNS discovery error:', error.message);
    if (!state.device) {
      state.phase = 'error';
      state.error = 'Network discovery is unavailable. Run the server with access to mDNS/UDP 5353.';
    }
  });
  for (const type of ['androidtvremote2', 'googlecast']) {
    bonjour.find({ type }, discover);
  }
}

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Pocket Remote listening on http://0.0.0.0:${port}`);
});

const watchdog = setInterval(() => {
  if (!credentials || !state.device) return;

  if (state.phase === 'connected' && remote) {
    observeRemoteClient(remote);
    const client = remote.remoteManager?.client;
    const stale = lastRemoteActivity > 0 && Date.now() - lastRemoteActivity > STALE_CONNECTION_MS;
    if (!client || client.destroyed || !client.writable || stale) {
      scheduleReconnect(stale ? 'remote stopped sending keepalive messages' : 'remote socket unavailable');
    }
    return;
  }

  if (
    !reconnectTimer
    && state.phase !== 'code'
    && state.phase !== 'pairing'
    && Date.now() - lastConnectAttempt >= RETRY_INTERVAL_MS
  ) {
    scheduleReconnect('periodic retry');
  }
}, 5_000);

function shutdown() {
  clearInterval(watchdog);
  clearTimeout(connectTimer);
  clearTimeout(reconnectTimer);
  bonjour?.destroy();
  teardownRemote();
  server.close();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
