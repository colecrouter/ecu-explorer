import type {
	ROMDefinition,
	Table1DDefinition,
	Table2DDefinition,
	Table3DDefinition,
	TableDefinition,
} from "@ecu-explorer/core";

type TestTableKind = Extract<
	TableDefinition["kind"],
	"table1d" | "table2d" | "table3d"
>;

type CreateTestTableOptions = {
	name: string;
	category?: string;
	kind?: TestTableKind;
	rows?: number;
	cols?: number;
	depth?: number;
	address?: number;
};

type CreateTestDefinitionOptions = Partial<
	Pick<ROMDefinition, "uri" | "name" | "fingerprints" | "platform">
>;

export function createTestTable({
	name,
	category,
	kind = "table1d",
	rows = 10,
	cols = 10,
	depth = 2,
	address = 0x1000,
}: CreateTestTableOptions) {
	const z = {
		id: `${name}-z`,
		name: "z",
		address,
		dtype: "u8" as const,
	};

	if (kind === "table3d") {
		const table = {
			id: `${name}-table`,
			name,
			kind,
			rows,
			cols,
			depth,
			z,
			...(category ? { category } : {}),
		} satisfies Table3DDefinition;

		return table;
	}

	if (kind === "table2d") {
		const table = {
			id: `${name}-table`,
			name,
			kind,
			rows,
			cols,
			z,
			...(category ? { category } : {}),
		} satisfies Table2DDefinition;

		return table;
	}

	const table = {
		id: `${name}-table`,
		name,
		kind,
		rows,
		z,
		...(category ? { category } : {}),
	} satisfies Table1DDefinition;

	return table;
}

export function createTestDefinition(
	tables: readonly TableDefinition[],
	options: CreateTestDefinitionOptions = {},
) {
	const definition = {
		uri: options.uri ?? "file:///test/definition.xml",
		name: options.name ?? "Test Definition",
		fingerprints: options.fingerprints ?? [],
		platform: options.platform ?? {},
		tables: [...tables],
	} as const satisfies ROMDefinition;

	return definition;
}
