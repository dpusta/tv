import test from 'node:test';
import assert from 'node:assert/strict';
import { KEY_MAP } from '../src/keys.js';

test('all supported remote keys map to Android key codes', () => {
  assert.deepEqual(Object.keys(KEY_MAP).sort(), [
    'down', 'enter', 'home', 'keyboard_enter', 'left', 'right', 'up', 'volume_down', 'volume_up',
  ]);
  for (const code of Object.values(KEY_MAP)) assert.equal(typeof code, 'number');
});
