import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { ACTIVE_REMOTE_FEATURES, patchRemoteFeatureNegotiation } from '../src/remote-protocol.js';

const require = createRequire(import.meta.url);
const { remoteMessageManager } = require('androidtv-remote/dist/remote/RemoteMessageManager.js');

test('negotiates the maintained Android TV remote feature mask', () => {
  patchRemoteFeatureNegotiation();

  const configure = remoteMessageManager.parse(
    remoteMessageManager.createRemoteConfigure(),
  );
  const active = remoteMessageManager.parse(
    remoteMessageManager.createRemoteSetActive(),
  );

  assert.equal(ACTIVE_REMOTE_FEATURES, 615);
  assert.equal(configure.remoteConfigure.code1, ACTIVE_REMOTE_FEATURES);
  assert.equal(active.remoteSetActive.active, ACTIVE_REMOTE_FEATURES);
});
