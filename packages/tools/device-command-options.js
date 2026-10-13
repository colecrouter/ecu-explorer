/**
 * Translate Sade's dashed keys at the CLI boundary. Reject ambiguous flag values
 * so a requested dry run can never silently fall back to real flashing.
 * @template {Record<string, unknown>} T
 * @param {T} options
 * @returns {T & { dryRun: boolean; resumeKernel: boolean }}
 */
export function deviceCommandOptions(options) {
	const flag = (/** @type {string} */ name) => {
		const value = options[name];
		if (value !== undefined && typeof value !== "boolean")
			throw new Error(`--${name} must be a boolean flag`);
		return value === true;
	};
	return {
		...options,
		dryRun: flag("dry-run"),
		resumeKernel: flag("resume-kernel"),
	};
}
