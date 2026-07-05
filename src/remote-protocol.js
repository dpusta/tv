import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { remoteMessageManager } = require('androidtv-remote/dist/remote/RemoteMessageManager.js');

// PING | KEY | IME | POWER | VOLUME | APP_LINK
export const ACTIVE_REMOTE_FEATURES = 615;

export function patchRemoteFeatureNegotiation() {
  remoteMessageManager.createRemoteConfigure = function createRemoteConfigure() {
    return this.create({
      remoteConfigure: {
        code1: ACTIVE_REMOTE_FEATURES,
        deviceInfo: {
          model: this.model,
          vendor: this.manufacturer,
          unknown1: 1,
          unknown2: '1',
          packageName: 'pocket-remote',
          appVersion: '1.0.0',
        },
      },
    });
  };

  remoteMessageManager.createRemoteSetActive = function createRemoteSetActive() {
    return this.create({
      remoteSetActive: {
        active: ACTIVE_REMOTE_FEATURES,
      },
    });
  };
}
