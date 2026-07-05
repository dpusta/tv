import androidTvRemote from 'androidtv-remote';

export const { AndroidRemote, RemoteKeyCode, RemoteDirection } = androidTvRemote;

export const KEY_MAP = Object.freeze({
  up: RemoteKeyCode.KEYCODE_DPAD_UP,
  down: RemoteKeyCode.KEYCODE_DPAD_DOWN,
  left: RemoteKeyCode.KEYCODE_DPAD_LEFT,
  right: RemoteKeyCode.KEYCODE_DPAD_RIGHT,
  enter: RemoteKeyCode.KEYCODE_DPAD_CENTER,
  keyboard_enter: RemoteKeyCode.KEYCODE_ENTER,
  back: RemoteKeyCode.KEYCODE_BACK,
  mute: RemoteKeyCode.KEYCODE_VOLUME_MUTE,
  home: RemoteKeyCode.KEYCODE_HOME,
  volume_up: RemoteKeyCode.KEYCODE_VOLUME_UP,
  volume_down: RemoteKeyCode.KEYCODE_VOLUME_DOWN,
});
