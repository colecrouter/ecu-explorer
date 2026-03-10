/**
 * Shared query/selector helpers for MCP tools.
 *
 * These utilities let agents reference exposed field names directly in
 * expressions, even when names contain spaces or punctuation.
 */

/**
 * Normalize a query expression from JS-style boolean operators to the
 * filtrex-compatible forms we compile internally.
 */
export function normalizeExpression(expr: string): string {
	return expr
		.replace(/&&/g, " and ")
		.replace(/\|\|/g, " or ")
		.replace(/!(?!=)/g, " not ");
}

/**
 * Escape a string for regex usage.
 */
export function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a stable alias map for exposed fields.
 */
export function buildFieldAliasMap(
	fields: string[],
	prefix: string = "__field_",
): {
	fieldToAlias: Map<string, string>;
} {
	const fieldToAlias = new Map<string, string>();
	const seen = new Set<string>();

	for (const field of fields) {
		if (seen.has(field)) continue;
		seen.add(field);
		fieldToAlias.set(field, `${prefix}${fieldToAlias.size}`);
	}

	return { fieldToAlias };
}

/**
 * Rewrite exposed field names in an expression to safe internal aliases.
 */
export function rewriteExpressionWithAliases(
	expr: string,
	fieldToAlias: Map<string, string>,
): string {
	let result = expr;
	const entries = [...fieldToAlias.entries()].sort((a, b) => b[0].length - a[0].length);

	for (const [field, alias] of entries) {
		if (field.length === 0) continue;
		const escaped = escapeRegex(field);
		const re = new RegExp(
			`(^|[^A-Za-z0-9_])${escaped}(?=[^A-Za-z0-9_]|$)`,
			"g",
		);

		result = result.replace(re, (_match, prefix) => `${prefix}${alias}`);
	}

	return result;
}

/**
 * Build an alias-backed object for expression evaluation.
 */
export function buildAliasedObject(
	row: Record<string, number>,
	fieldToAlias: Map<string, string>,
): Record<string, number> {
	const aliasValues: Record<string, number> = {};

	for (const [field, alias] of fieldToAlias.entries()) {
		const value = row[field];
		if (value !== undefined) {
			aliasValues[alias] = value;
		}
	}

	return aliasValues;
}

/**
 * Return the exposed fields referenced in an expression.
 */
export function extractReferencedFields(
	expr: string,
	fields: string[],
): string[] {
	const normalized = normalizeExpression(expr);
	const matches = new Set<string>();
	const sorted = [...fields].sort((a, b) => b.length - a.length);

	for (const field of sorted) {
		const escaped = escapeRegex(field);
		const pattern = new RegExp(
			`(^|[^A-Za-z0-9_])${escaped}(?=[^A-Za-z0-9_]|$)`,
			"i",
		);

		if (pattern.test(normalized)) {
			matches.add(field);
		}
	}

	return Array.from(matches);
}
