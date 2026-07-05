import androidTvRemote from 'androidtv-remote';

export const { AndroidRemote, RemoteKeyCode, RemoteDirection } = androidTvRemote;

export const KEY_MAP = Object.freeze({
  up: RemoteKeyCode.KEYCODE_DPAD_UP,
  down: RemoteKeyCode.KEYCODE_DPAD_DOWN,
  left: RemoteKeyCode.KEYCODE_DPAD_LEFT,
  right: RemoteKeyCode.KEYCODE_DPAD_RIGHT,
  enter: RemoteKeyCode.KEYCODE_DPAD_CENTER,
  home: RemoteKeyCode.KEYCODE_HOME,
  volume_up: RemoteKeyCode.KEYCODE_VOLUME_UP,
  volume_down: RemoteKeyCode.KEYCODE_VOLUME_DOWN,
});

const DIRECT_CHAR_KEYS = Object.freeze({
  ' ': 'SPACE',
  ',': 'COMMA',
  '.': 'PERIOD',
  '`': 'GRAVE',
  '-': 'MINUS',
  '=': 'EQUALS',
  '[': 'LEFT_BRACKET',
  ']': 'RIGHT_BRACKET',
  '\\': 'BACKSLASH',
  ';': 'SEMICOLON',
  "'": 'APOSTROPHE',
  '/': 'SLASH',
  '@': 'AT',
  '+': 'PLUS',
});

const SHIFTED_CHAR_KEYS = Object.freeze({
  '!': '1',
  '"': 'APOSTROPHE',
  '#': '3',
  '$': '4',
  '%': '5',
  '^': '6',
  '&': '7',
  '*': '8',
  '(': '9',
  ')': '0',
  '_': 'MINUS',
  '{': 'LEFT_BRACKET',
  '}': 'RIGHT_BRACKET',
  '|': 'BACKSLASH',
  ':': 'SEMICOLON',
  '<': 'COMMA',
  '>': 'PERIOD',
  '?': 'SLASH',
  '~': 'GRAVE',
});

function keyCode(name) {
  return RemoteKeyCode[`KEYCODE_${name}`];
}

export function textKeySequence(text) {
  return [...text].map((character) => {
    if (/^[a-z]$/.test(character)) return { key: keyCode(character.toUpperCase()), shifted: false };
    if (/^[A-Z]$/.test(character)) return { key: keyCode(character), shifted: true };
    if (/^[0-9]$/.test(character)) return { key: keyCode(character), shifted: false };

    const direct = DIRECT_CHAR_KEYS[character];
    if (direct) return { key: keyCode(direct), shifted: false };

    const shifted = SHIFTED_CHAR_KEYS[character];
    if (shifted) return { key: keyCode(shifted), shifted: true };

    throw new Error(`Unsupported character: ${character}`);
  });
}
