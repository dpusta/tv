import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteKeyCode, textKeySequence } from '../src/keys.js';

test('maps password text to Android key events', () => {
  assert.deepEqual(textKeySequence('aA1!@?'), [
    { key: RemoteKeyCode.KEYCODE_A, shifted: false },
    { key: RemoteKeyCode.KEYCODE_A, shifted: true },
    { key: RemoteKeyCode.KEYCODE_1, shifted: false },
    { key: RemoteKeyCode.KEYCODE_1, shifted: true },
    { key: RemoteKeyCode.KEYCODE_AT, shifted: false },
    { key: RemoteKeyCode.KEYCODE_SLASH, shifted: true },
  ]);
});

test('rejects characters unavailable as Android key events', () => {
  assert.throws(() => textKeySequence('café'), /Unsupported character/);
});
