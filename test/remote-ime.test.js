import test from 'node:test';
import assert from 'node:assert/strict';
import { createImeStateDecoder, createImeTextMessage } from '../src/remote-ime.js';

test('encodes and decodes an IME batch edit with text and counters', () => {
  const updates = [];
  const decoder = createImeStateDecoder((state) => updates.push(state));
  const message = createImeTextMessage('Ab3! café', {
    imeCounter: 7,
    fieldCounter: 4,
    start: 2,
    end: 2,
  });

  decoder.push(message.subarray(0, 3));
  decoder.push(message.subarray(3));

  assert.deepEqual(updates, [{
    imeCounter: 7,
    fieldCounter: 4,
    insertedText: 'Ab3! café',
    insertMode: 0,
    insertionStart: 2,
    insertionEnd: 2,
  }]);
});
