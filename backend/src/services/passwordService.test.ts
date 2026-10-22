import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTemporaryPassword } from './passwordService.js';

test('generates a 16-character temporary password', () => {
    const password = generateTemporaryPassword();

    assert.equal(password.length, 16);
    assert.match(password, /^[A-HJ-NP-Za-km-z2-9]+$/);
});

test('generates different passwords on each call', () => {
    assert.notEqual(generateTemporaryPassword(), generateTemporaryPassword());
});
