/** Captured EcuFlash M32186 V1.09 format-01 bootstrap wire bytes.
 * Origin: captured-bootstrap-wire.bin, documented in specs/EVO_X_KERNEL_RESEARCH.md.
 * SHA-256: 8d53b034b6ec0a88311e6c55dd037475933c4572b1406b88ae815e9b1db09fc9.
 * This is the original captured loader, not a source-built replacement.
 */
const BOOTSTRAP_HEX =
	"ccfb54d46ad05557d7d4d56ba5d2f8d5d3d0a7d420d6d7d6d56b54d426d01eb4d3d03c9720d6fbd5d3d08fd64cd254d4d3d05535d55257575252ffb426d05535d7d4d52026d05557d7cdd527d3d0a78bf738d55126d0a787185403eb6ad055a1d7d4d56b9ed2f816d3d0a75519d654d4d31556d41fd0a775d51ad7d41fd0a795d51ad7d0d56bfb8bd5a321ff1fd03c976c1ed4e9d56bd51ed6ffd51af6ff54d45271ff2b26d03c97202554d4d3d052d427d603d3d3d052d44cd254d4cc7ff8c9ffffffffffffffffff26d4d4d4d4d4d4";

/** Return an independent copy so callers cannot mutate the bundled bootstrap. */
export function getEvoXBootstrap(): Uint8Array {
	return Uint8Array.from(BOOTSTRAP_HEX.match(/../g) ?? [], (byte) =>
		Number.parseInt(byte, 16),
	);
}
