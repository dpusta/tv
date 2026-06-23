import express from 'express';
import { Bonjour } from 'bonjour-service';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AndroidRemote, KEY_MAP, RemoteDirection } from './keys.js';
import { normalizePairingCode } from './pairing-code.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');
const credentialsFile = path.join(dataDir, 'remote.json');
const port = Number(process.env.PORT || 3000);

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
let bonjour = null;

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

function shouldForgetSavedPairing(error, hadSavedCredentials) {
  return Boolean(hadSavedCredentials && ['ECONNREFUSED', 'ECONNRESET', 'EPIPE'].includes(error?.code));
}

async function handleSavedPairingFailure(error, hadSavedCredentials) {
  if (!shouldForgetSavedPairing(error, hadSavedCredentials)) return false;
  await clearCredentials();
  state.phase = state.device ? 'found' : 'searching';
  state.error = 'The saved pairing no longer works. Pair this TV again.';
  return true;
}

function ipv4Address(service) {
  return service.addresses?.find((address) => /^\d{1,3}(\.\d{1,3}){3}$/.test(address));
}

function discover(service) {
  const host = ipv4Address(service);
  if (!host || connectingHost || state.phase === 'connected') return;

  state.device = {
    name: service.txt?.fn || service.name || 'Google TV',
    host,
  };
  state.phase = credentials ? 'connecting' : 'found';
  state.error = null;

  if (credentials) void connect(host, false);
}

async function connect(host, pairing) {
  if (!host) throw new Error('No Chromecast has been found yet.');
  if (connectingHost === host || state.phase === 'connected') return;

  connectingHost = host;
  state.phase = pairing ? 'pairing' : 'connecting';
  state.error = null;
  clearTimeout(connectTimer);
  const hadSavedCredentials = Boolean(credentials && !pairing);

  try {
    if (remote?.remoteManager) remote.stop();
    remote?.pairingManager?.client?.destroy();
    remote = new AndroidRemote(host, {
      pairing_port: 6467,
      remote_port: 6466,
      service_name: 'Pocket Remote',
      cert: pairing ? {} : credentials?.cert || {},
    });

    remote.on('secret', () => {
      state.phase = 'code';
    });
    remote.on('ready', async () => {
      state.phase = 'connected';
      state.error = null;
      connectingHost = null;
      clearTimeout(connectTimer);
      credentials = { cert: remote.getCertificate() };
      try {
        await saveCredentials();
      } catch (error) {
        state.error = `Connected, but credentials could not be saved: ${error.message}`;
      }
    });
    remote.on('powered', (powered) => { state.powered = powered; });
    remote.on('volume', (volume) => { state.volume = volume; });
    remote.on('unpaired', () => {
      void clearCredentials();
      state.phase = 'found';
      connectingHost = null;
    });
    remote.on('error', async (error) => {
      if (state.phase === 'connecting' && await handleSavedPairingFailure(error, hadSavedCredentials)) {
        clearTimeout(connectTimer);
        connectingHost = null;
        if (remote?.remoteManager) remote.stop();
        return;
      }
      state.error = error.message || 'Chromecast connection error.';
    });

    connectTimer = setTimeout(() => {
      if (state.phase === 'connecting' || state.phase === 'pairing') {
        state.phase = credentials ? 'found' : 'error';
        state.error = 'The Chromecast did not respond. Check that it is awake and on the same network.';
        connectingHost = null;
      }
    }, 15_000);

    void remote.start()
      .then((started) => {
        if (!started && state.phase !== 'connected' && state.phase !== 'code') {
          clearTimeout(connectTimer);
          connectingHost = null;
          state.phase = 'error';
          state.error ||= 'Pairing was not accepted by the TV. Start pairing again.';
        }
      })
      .catch((error) => {
        clearTimeout(connectTimer);
        connectingHost = null;
        void handleSavedPairingFailure(error, hadSavedCredentials).then((handled) => {
          if (handled) return;
          state.phase = 'error';
          state.error = error.message || 'Could not connect to the Chromecast.';
        });
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
app.use(express.static(path.join(root, 'public')));

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
  const key = request.body?.key;
  if (state.phase !== 'connected' || !remote) return response.status(409).json({ error: 'Chromecast is not connected.' });
  if (key !== 'power' && !(key in KEY_MAP)) return response.status(400).json({ error: 'Unknown remote key.' });
  try {
    if (key === 'power') remote.sendPower();
    else remote.sendKey(KEY_MAP[key], RemoteDirection.SHORT);
    response.status(204).end();
  } catch (error) {
    response.status(503).json({ error: error.message });
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

function shutdown() {
  bonjour?.destroy();
  if (remote?.remoteManager) remote.stop();
  server.close();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
