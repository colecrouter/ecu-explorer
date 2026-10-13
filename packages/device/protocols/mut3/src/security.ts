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

function affineByte(x: number): number {
	return (Math.imul(0x89, x) + 0xd2) & 0xff;
}

function carryByte(x: number, additiveConstant: number): number {
	return ((Math.imul(0x89, x) + additiveConstant) >>> 8) & 0xff;
}

/**
 * Computes the SecurityAccess key for the traced EVO X flash/programming
 * session (`0x27 0x05` / `0x27 0x06`).
 *
 * This 4-byte algorithm was derived from 157 unique observed seed/key pairs
 * captured from real MUT-III flash sessions. It matches the traced structure:
 *
 * - `key[1] = (0x89 * seed[1] + 0xD2) & 0xFF`
 * - `key[3] = (0x89 * seed[3] + 0xD2) & 0xFF`
 * - `key[0] = (0x89 * seed[0] + 0xD2 + 0x8F + hi(0x89 * seed[1] + 0xD0)) & 0xFF`
 * - `key[2] = (0x89 * seed[2] + 0xD2 + 0x8F + hi(0x89 * seed[3] + 0xD1)) & 0xFF`
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

	const [seed0, seed1, seed2, seed3] = seed;
	if (
		seed0 === undefined ||
		seed1 === undefined ||
		seed2 === undefined ||
		seed3 === undefined
	) {
		throw new RangeError("computeFlashSecurityKey: seed bytes missing");
	}

	return new Uint8Array([
		(affineByte(seed0) + 0x8f + carryByte(seed1, 0xd0)) & 0xff,
		affineByte(seed1),
		(affineByte(seed2) + 0x8f + carryByte(seed3, 0xd1)) & 0xff,
		affineByte(seed3),
	]);
}
