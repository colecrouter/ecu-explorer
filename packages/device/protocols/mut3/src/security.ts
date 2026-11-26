/**
 * Computes the SecurityAccess key from a seed for Mitsubishi diagnostic/read
 * sessions (service `0x27`, subfunctions `0x01`/`0x02`).
 *
 * This 2-byte algorithm is used for ROM readback and diagnostic access, not
 * for the traced EVO X flash/programming flow.
 *
 * @param seed - 2-byte seed from `0x67 0x01`
 * @returns 2-byte key for `0x27 0x02`
 * @throws {RangeError} if seed is not exactly 2 bytes
 */
export function computeSecurityKey(seed: Uint8Array): Uint8Array {
	if (seed.length !== 2) {
		throw new RangeError(
			`computeSecurityKey: expected 2-byte seed, got ${seed.length} bytes`,
		);
	}

	const seedHigh = seed[0];
	const seedLow = seed[1];
	if (seedHigh === undefined || seedLow === undefined) {
		throw new RangeError("computeSecurityKey: seed bytes missing");
	}

	const seed16 = ((seedHigh << 8) | seedLow) & 0xffff;
	const key16 = (Math.imul(seed16, 0x4081) + 0x1234) & 0xffff;
	return new Uint8Array([(key16 >> 8) & 0xff, key16 & 0xff]);
}

/**
 * Computes the SecurityAccess key for the traced EVO X flash/programming
 * session (`0x27 0x05` / `0x27 0x06`).
 *
 * The seed is two big-endian 16-bit words; each key word is
 * `(seedWord * 0x89 + 0x61D2) & 0xFFFF`. This is the check the ECU's
 * resident boot code runs (on a 4B11T 1 MiB M32186 image the instructions
 * are `LDI R1,#0x89; MUL; ADD3 #0x61D2; STH` at ROM `0x524C`). It matches all
 * 157 distinct seed/key pairs captured from real MUT-III flash sessions.
 *
 * @param seed - 4-byte seed from `0x67 0x05`
 * @returns 4-byte key for `0x27 0x06`
 * @throws {RangeError} if seed is not exactly 4 bytes
 */
export function computeFlashSecurityKey(seed: Uint8Array): Uint8Array {
	if (seed.length !== 4) {
		throw new RangeError(
			`computeFlashSecurityKey: expected 4-byte seed, got ${seed.length} bytes`,
		);
	}

	const key = new Uint8Array(4);
	for (let i = 0; i < 4; i += 2) {
		const word = ((seed[i] ?? 0) << 8) | (seed[i + 1] ?? 0);
		const keyWord = (Math.imul(word, 0x89) + 0x61d2) & 0xffff;
		key[i] = keyWord >> 8;
		key[i + 1] = keyWord & 0xff;
	}
	return key;
}
