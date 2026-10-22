import { randomInt } from 'node:crypto';

// Exclude visually ambiguous characters (0, O, 1, I, l) so temporary
// passwords can be read aloud or copied without mistakes.
const ALPHABET =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function generateTemporaryPassword(length = 16): string {
    let result = '';
    for (let index = 0; index < length; index += 1) {
        result += ALPHABET[randomInt(ALPHABET.length)];
    }
    return result;
}
