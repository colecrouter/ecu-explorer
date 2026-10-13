/** Translate actual Sade dashed flags without silently weakening dry-run intent. */
export function deviceCommandOptions<T extends Record<string, unknown>>(
	options: T,
): T & { dryRun: boolean; resumeKernel: boolean };
