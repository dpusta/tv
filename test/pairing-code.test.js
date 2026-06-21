import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePairingCode } from '../src/pairing-code.js';

test('accepts six-character hexadecimal TV pairing codes', () => {
  assert.equal(normalizePairingCode('a1b2c3'), 'A1B2C3');
  assert.equal(normalizePairingCode('A1 B2 C3'), 'A1B2C3');
  assert.equal(normalizePairingCode('12-34-56'), '123456');
});

test('rejects incomplete and non-hexadecimal pairing codes', () => {
  assert.equal(normalizePairingCode('1234'), null);
  assert.equal(normalizePairingCode('G12345'), null);
  assert.equal(normalizePairingCode(''), null);
});
