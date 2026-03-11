import type { TableDefinition } from "@ecu-explorer/core";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { RomDocument } from "../src/rom/document.js";
import type { RomEditorProvider } from "../src/rom/editor-provider.js";
import { RomExplorerTreeProvider } from "../src/tree/rom-tree-provider.js";
import { WorkspaceState } from "../src/workspace-state.js";
import { createTestDefinition, createTestTable } from "./mocks/rom-fixtures.js";

type MockEditorProvider = Pick<RomEditorProvider, "onDidChangeCustomDocument">;
type MockMemento = Pick<vscode.Memento, "get" | "update" | "keys">;
function createMockMemento(): MockMemento {
	return {
		get: vi.fn(() => undefined),
		update: vi.fn(async () => {}),
		keys: vi.fn(() => []),
	};
}

function setTreeRefreshSpy(
	provider: RomExplorerTreeProvider,
	refreshSpy: Mock,
): void {
	const fire: (data: unknown) => void = (data) => {
		refreshSpy(data);
	};

	Reflect.set(provider, "_onDidChangeTreeData", {
		fire,
	} satisfies Pick<vscode.EventEmitter<unknown>, "fire">);
}

describe("RomExplorerTreeProvider", () => {
	let treeProvider: RomExplorerTreeProvider;
	let mockEditorProvider: RomEditorProvider;
	let mockWorkspaceState: WorkspaceState;

	beforeEach(() => {
		// Create mock editor provider
		mockEditorProvider = {
			onDidChangeCustomDocument: vi.fn(() => ({ dispose: vi.fn() })),
		} as MockEditorProvider as RomEditorProvider;

		// Create mock workspace state
		const mockMemento = createMockMemento();
		mockWorkspaceState = new WorkspaceState(mockMemento);

		// Create tree provider
		treeProvider = new RomExplorerTreeProvider(
			mockEditorProvider,
			mockWorkspaceState,
		);
	});

	it("should create tree provider instance", () => {
		expect(treeProvider).toBeDefined();
		expect(treeProvider.getTreeItem).toBeDefined();
		expect(treeProvider.getChildren).toBeDefined();
	});

	it("should return empty array when no documents are added", async () => {
		const children = await treeProvider.getChildren();
		expect(children).toEqual([]);
	});

	it("should add a ROM document to the tree", async () => {
		const mockUri = vscode.Uri.file("/test/rom.hex");
		const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);
		const document = new RomDocument(mockUri, mockBytes);

		treeProvider.addDocument(document);

		const children = await treeProvider.getChildren();
		expect(children).toHaveLength(1);
		expect(children[0]?.data.type).toBe("rom");
		expect(children[0]?.data.label).toBe("rom.hex");
	});

	it("should remove a ROM document from the tree", async () => {
		const mockUri = vscode.Uri.file("/test/rom.hex");
		const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);
		const document = new RomDocument(mockUri, mockBytes);

		treeProvider.addDocument(document);
		let children = await treeProvider.getChildren();
		expect(children).toHaveLength(1);

		treeProvider.removeDocument(mockUri);
		children = await treeProvider.getChildren();
		expect(children).toHaveLength(0);
	});

	it("should return tree item for a given element", () => {
		const mockUri = vscode.Uri.file("/test/rom.hex");
		const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);
		const document = new RomDocument(mockUri, mockBytes);

		treeProvider.addDocument(document);

		// Get children to get a tree item
		treeProvider.getChildren().then((children) => {
			if (children[0]) {
				const treeItem = treeProvider.getTreeItem(children[0]);
				expect(treeItem).toBeDefined();
				expect(treeItem.label).toBe("rom.hex");
			}
		});
	});

	it("should refresh tree when refresh() is called", () => {
		const refreshSpy = vi.fn();
		setTreeRefreshSpy(treeProvider, refreshSpy);

		treeProvider.refresh();

		expect(refreshSpy).toHaveBeenCalledWith(undefined);
	});

	it("should track multiple ROM documents", async () => {
		const mockUri1 = vscode.Uri.file("/test/rom1.hex");
		const mockUri2 = vscode.Uri.file("/test/rom2.hex");
		const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

		const document1 = new RomDocument(mockUri1, mockBytes);
		const document2 = new RomDocument(mockUri2, mockBytes);

		treeProvider.addDocument(document1);
		treeProvider.addDocument(document2);

		const children = await treeProvider.getChildren();
		expect(children).toHaveLength(2);

		// Should be sorted alphabetically
		expect(children[0]?.data.label).toBe("rom1.hex");
		expect(children[1]?.data.label).toBe("rom2.hex");
	});

	it("should not show description for clean ROM", async () => {
		const mockUri = vscode.Uri.file("/test/rom.hex");
		const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);
		const document = new RomDocument(mockUri, mockBytes);

		treeProvider.addDocument(document);

		const children = await treeProvider.getChildren();
		expect(children).toHaveLength(1);
		expect(children[0]?.description).toBeUndefined();
	});

	// Phase 1: Category and Table Node Tests

	it("should return empty array for ROM without definition", async () => {
		const mockUri = vscode.Uri.file("/test/rom.hex");
		const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);
		const document = new RomDocument(mockUri, mockBytes);

		treeProvider.addDocument(document);

		const romNodes = await treeProvider.getChildren();
		expect(romNodes).toHaveLength(1);
		const firstRomNode = romNodes[0];
		if (!firstRomNode) throw new Error("Expected first ROM node to be defined");

		// Get children of ROM node (should be empty)
		const categoryNodes = await treeProvider.getChildren(firstRomNode);
		expect(categoryNodes).toEqual([]);
	});

	it("should return category nodes for ROM with definition", async () => {
		const mockUri = vscode.Uri.file("/test/rom.hex");
		const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

		const tables = [
			createTestTable({ name: "Table1", category: "Fuel" }),
			createTestTable({ name: "Table2", category: "Fuel" }),
			createTestTable({ name: "Table3", category: "Ignition" }),
		];
		const definition = createTestDefinition(tables);

		const document = new RomDocument(mockUri, mockBytes, definition);
		treeProvider.addDocument(document);

		const romNodes = await treeProvider.getChildren();
		expect(romNodes).toHaveLength(1);
		const firstRomNode = romNodes[0];
		if (!firstRomNode) throw new Error("Expected first ROM node to be defined");

		// Get category nodes
		const categoryNodes = await treeProvider.getChildren(firstRomNode);
		expect(categoryNodes).toHaveLength(2);

		// Check category names
		const categoryLabels = categoryNodes.map((n) => n.label).sort();
		expect(categoryLabels).toEqual(
			[...new Set(tables.map((table) => table.category ?? "Uncategorized"))].sort(),
		);
	});

	it("should group tables by category correctly", async () => {
		const mockUri = vscode.Uri.file("/test/rom.hex");
		const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

		const tables = [
			createTestTable({ name: "FuelTable1", category: "Fuel" }),
			createTestTable({ name: "FuelTable2", category: "Fuel" }),
			createTestTable({ name: "IgnitionTable", category: "Ignition" }),
		];
		const definition = createTestDefinition(tables);

		const document = new RomDocument(mockUri, mockBytes, definition);
		treeProvider.addDocument(document);

		const romNodes = await treeProvider.getChildren();
		const firstRom = romNodes[0];
		if (!firstRom) throw new Error("No ROM nodes found");
		const categoryNodes = await treeProvider.getChildren(firstRom);

		// Find Fuel category
		const fuelCategoryName = tables[0]?.category;
		const expectedFuelTables = tables.filter(
			(table) => table.category === fuelCategoryName,
		);
		const fuelCategory = categoryNodes.find((n) => n.label === fuelCategoryName);
		if (!fuelCategory) throw new Error("Fuel category not found");
		expect(fuelCategory).toBeDefined();
		expect(fuelCategory.description).toBe(
			`${expectedFuelTables.length} tables`,
		);

		// Get tables in Fuel category
		const fuelTables = await treeProvider.getChildren(fuelCategory);
		expect(fuelTables).toHaveLength(expectedFuelTables.length);
		expect(fuelTables.map((t) => t.label).sort()).toEqual(
			expectedFuelTables.map((table) => table.name).sort(),
		);
	});

	it("should handle tables without category (Uncategorized)", async () => {
		const mockUri = vscode.Uri.file("/test/rom.hex");
		const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

		const tables = [
			createTestTable({ name: "Table1", category: "Fuel" }),
			createTestTable({ name: "Table2" }),
			createTestTable({ name: "Table3" }),
		];
		const definition = createTestDefinition(tables);

		const document = new RomDocument(mockUri, mockBytes, definition);
		treeProvider.addDocument(document);

		const romNodes = await treeProvider.getChildren();
		const firstRomNode = romNodes[0];
		if (!firstRomNode) throw new Error("Expected first ROM node to be defined");
		const categoryNodes = await treeProvider.getChildren(firstRomNode);

		// Should have Fuel and Uncategorized
		expect(categoryNodes).toHaveLength(2);
		const categoryLabels = categoryNodes.map((n) => n.label).sort();
		expect(categoryLabels).toEqual(
			[...new Set(tables.map((table) => table.category ?? "Uncategorized"))].sort(),
		);

		// Check Uncategorized count
		const uncategorized = categoryNodes.find(
			(n) => n.label === "Uncategorized",
		);
		expect(uncategorized?.description).toBe(
			`${tables.filter((table) => table.category === undefined).length} tables`,
		);
	});

	it("should sort categories alphabetically", async () => {
		const mockUri = vscode.Uri.file("/test/rom.hex");
		const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

		const tables = [
			createTestTable({ name: "Table1", category: "Zebra" }),
			createTestTable({ name: "Table2", category: "Apple" }),
			createTestTable({ name: "Table3", category: "Mango" }),
		];
		const definition = createTestDefinition(tables);

		const document = new RomDocument(mockUri, mockBytes, definition);
		treeProvider.addDocument(document);

		const romNodes = await treeProvider.getChildren();
		const firstRomNode = romNodes[0];
		if (!firstRomNode) throw new Error("Expected first ROM node to be defined");
		const categoryNodes = await treeProvider.getChildren(firstRomNode);

		const categoryLabels = categoryNodes.map((n) => n.label);
		expect(categoryLabels).toEqual(
			[...new Set(tables.map((table) => table.category ?? "Uncategorized"))].sort(),
		);
	});

	it("should sort tables within category alphabetically", async () => {
		const mockUri = vscode.Uri.file("/test/rom.hex");
		const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

		const tables = [
			createTestTable({ name: "ZebraTable", category: "Fuel" }),
			createTestTable({ name: "AppleTable", category: "Fuel" }),
			createTestTable({ name: "MangoTable", category: "Fuel" }),
		];
		const definition = createTestDefinition(tables);

		const document = new RomDocument(mockUri, mockBytes, definition);
		treeProvider.addDocument(document);

		const romNodes = await treeProvider.getChildren();
		const firstRomNode = romNodes[0];
		if (!firstRomNode) throw new Error("Expected first ROM node to be defined");
		const categoryNodes = await treeProvider.getChildren(firstRomNode);
		const fuelCategory = categoryNodes[0];
		if (!fuelCategory) throw new Error("Expected fuel category to be defined");

		const tableNodes = await treeProvider.getChildren(fuelCategory);
		const tableLabels = tableNodes.map((t) => t.label);
		expect(tableLabels).toEqual(tables.map((table) => table.name).sort());
	});

	it("should return empty array for table nodes (leaf nodes)", async () => {
		const mockUri = vscode.Uri.file("/test/rom.hex");
		const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

		const tables = [createTestTable({ name: "Table1", category: "Fuel" })];
		const definition = createTestDefinition(tables);

		const document = new RomDocument(mockUri, mockBytes, definition);
		treeProvider.addDocument(document);

		const romNodes = await treeProvider.getChildren();
		const firstRomNode = romNodes[0];
		if (!firstRomNode) throw new Error("Expected first ROM node to be defined");
		const categoryNodes = await treeProvider.getChildren(firstRomNode);
		const firstCategoryNode = categoryNodes[0];
		if (!firstCategoryNode)
			throw new Error("Expected first category node to be defined");
		const tableNodes = await treeProvider.getChildren(firstCategoryNode);
		const tableNode = tableNodes[0];
		if (!tableNode) throw new Error("Expected table node to be defined");

		// Table nodes should have no children
		const tableChildren = await treeProvider.getChildren(tableNode);
		expect(tableChildren).toEqual([]);
	});

	it("should make ROM nodes expandable when they have tables", async () => {
		const mockUri = vscode.Uri.file("/test/rom.hex");
		const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

		const tables = [createTestTable({ name: "Table1", category: "Fuel" })];
		const definition = createTestDefinition(tables);

		const document = new RomDocument(mockUri, mockBytes, definition);
		treeProvider.addDocument(document);

		const romNodes = await treeProvider.getChildren();
		expect(romNodes[0]?.collapsibleState).toBe(
			vscode.TreeItemCollapsibleState.Collapsed,
		);
	});

	it("should make ROM nodes non-expandable when they have no tables", async () => {
		const mockUri = vscode.Uri.file("/test/rom.hex");
		const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

		const document = new RomDocument(mockUri, mockBytes);
		treeProvider.addDocument(document);

		const romNodes = await treeProvider.getChildren();
		expect(romNodes[0]?.collapsibleState).toBe(
			vscode.TreeItemCollapsibleState.None,
		);
	});

	it("should handle ROM with empty tables array", async () => {
		const mockUri = vscode.Uri.file("/test/rom.hex");
		const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

		const definition = createTestDefinition([]);
		const document = new RomDocument(mockUri, mockBytes, definition);
		treeProvider.addDocument(document);

		const romNodes = await treeProvider.getChildren();
		expect(romNodes[0]?.collapsibleState).toBe(
			vscode.TreeItemCollapsibleState.None,
		);

		const firstRomNode = romNodes[0];
		if (!firstRomNode) throw new Error("Expected first ROM node to be defined");
		const categoryNodes = await treeProvider.getChildren(firstRomNode);
		expect(categoryNodes).toEqual([]);
	});

	it("should support all table types (1D, 2D, 3D)", async () => {
		const mockUri = vscode.Uri.file("/test/rom.hex");
		const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

		const tables = [
			createTestTable({ name: "Table1D", category: "Fuel", kind: "table1d" }),
			createTestTable({ name: "Table2D", category: "Fuel", kind: "table2d" }),
			createTestTable({ name: "Table3D", category: "Fuel", kind: "table3d" }),
		];
		const definition = createTestDefinition(tables);

		const document = new RomDocument(mockUri, mockBytes, definition);
		treeProvider.addDocument(document);

		const romNodes = await treeProvider.getChildren();
		const firstRomNode = romNodes[0];
		if (!firstRomNode) throw new Error("Expected first ROM node to be defined");

		const categoryNodes = await treeProvider.getChildren(firstRomNode);
		const firstCategoryNode = categoryNodes[0];
		if (!firstCategoryNode)
			throw new Error("Expected first category node to be defined");
		const tableNodes = await treeProvider.getChildren(firstCategoryNode);

		expect(tableNodes).toHaveLength(3);
		expect(tableNodes.map((t) => t.label).sort()).toEqual(
			tables.map((table) => table.name).sort(),
		);
	});

	it("should create unique IDs for tree items", async () => {
		const mockUri = vscode.Uri.file("/test/rom.hex");
		const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

		const tables = [
			createTestTable({ name: "Table1", category: "Fuel" }),
			createTestTable({ name: "Table2", category: "Fuel" }),
		];
		const definition = createTestDefinition(tables);

		const document = new RomDocument(mockUri, mockBytes, definition);
		treeProvider.addDocument(document);

		const romNodes = await treeProvider.getChildren();
		const firstRomNode = romNodes[0];
		if (!firstRomNode) throw new Error("Expected first ROM node to be defined");
		const categoryNodes = await treeProvider.getChildren(firstRomNode);
		const firstCategoryNode = categoryNodes[0];
		if (!firstCategoryNode)
			throw new Error("Expected first category node to be defined");

		const tableNodes = await treeProvider.getChildren(firstCategoryNode);

		// All IDs should be unique
		const ids = [
			romNodes[0]?.id,
			categoryNodes[0]?.id,
			...tableNodes.map((t) => t.id),
		];
		const uniqueIds = new Set(ids);
		expect(uniqueIds.size).toBe(ids.length);
	});

	it("should handle multiple ROMs with different categories", async () => {
		const mockUri1 = vscode.Uri.file("/test/rom1.hex");
		const mockUri2 = vscode.Uri.file("/test/rom2.hex");
		const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

		const tables1 = [
			createTestTable({ name: "Table1", category: "Fuel" }),
			createTestTable({ name: "Table2", category: "Ignition" }),
		];
		const tables2 = [
			createTestTable({ name: "Table3", category: "Boost" }),
			createTestTable({ name: "Table4", category: "Timing" }),
		];

		const definition1 = createTestDefinition(tables1);
		const definition2 = createTestDefinition(tables2);

		const document1 = new RomDocument(mockUri1, mockBytes, definition1);
		const document2 = new RomDocument(mockUri2, mockBytes, definition2);

		treeProvider.addDocument(document1);
		treeProvider.addDocument(document2);

		const romNodes = await treeProvider.getChildren();
		expect(romNodes).toHaveLength(2);
		const rom1Node = romNodes[0];
		const rom2Node = romNodes[1];
		if (!rom1Node || !rom2Node)
			throw new Error("Expected both ROM nodes to be defined");

		// Check first ROM categories
		const rom1Categories = await treeProvider.getChildren(rom1Node);
		expect(rom1Categories).toHaveLength(2);

		// Check second ROM categories
		const rom2Categories = await treeProvider.getChildren(rom2Node);
		expect(rom2Categories).toHaveLength(2);
	});

	it("should have correct tree item types for all nodes", async () => {
		const mockUri = vscode.Uri.file("/test/rom.hex");
		const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

		const tables = [createTestTable({ name: "Table1", category: "Fuel" })];
		const definition = createTestDefinition(tables);

		const document = new RomDocument(mockUri, mockBytes, definition);
		treeProvider.addDocument(document);

		const romNodes = await treeProvider.getChildren();
		expect(romNodes[0]?.data.type).toBe("rom");

		const firstRomNode = romNodes[0];
		if (!firstRomNode) throw new Error("Expected first ROM node to be defined");
		const categoryNodes = await treeProvider.getChildren(firstRomNode);
		expect(categoryNodes[0]?.data.type).toBe("category");

		const firstCategoryNode = categoryNodes[0];
		if (!firstCategoryNode)
			throw new Error("Expected first category node to be defined");

		const tableNodes = await treeProvider.getChildren(firstCategoryNode);
		expect(tableNodes[0]?.data.type).toBe("table");
	});

	it("should have correct collapsible states", async () => {
		const mockUri = vscode.Uri.file("/test/rom.hex");
		const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

		const tables = [createTestTable({ name: "Table1", category: "Fuel" })];
		const definition = createTestDefinition(tables);

		const document = new RomDocument(mockUri, mockBytes, definition);
		treeProvider.addDocument(document);

		const romNodes = await treeProvider.getChildren();
		expect(romNodes[0]?.collapsibleState).toBe(
			vscode.TreeItemCollapsibleState.Collapsed,
		);

		const firstRomNode = romNodes[0];
		if (!firstRomNode) throw new Error("Expected first ROM node to be defined");

		const categoryNodes = await treeProvider.getChildren(firstRomNode);
		expect(categoryNodes[0]?.collapsibleState).toBe(
			vscode.TreeItemCollapsibleState.Collapsed,
		);

		const firstCategoryNode = categoryNodes[0];
		if (!firstCategoryNode)
			throw new Error("Expected first category node to be defined");

		const tableNodes = await treeProvider.getChildren(firstCategoryNode);
		expect(tableNodes[0]?.collapsibleState).toBe(
			vscode.TreeItemCollapsibleState.None,
		);
	});

	it("should handle category names with special characters", async () => {
		const mockUri = vscode.Uri.file("/test/rom.hex");
		const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

		const tables = [
			createTestTable({ name: "Table1", category: "Fuel & Air" }),
			createTestTable({ name: "Table2", category: "Ignition (Primary)" }),
			createTestTable({ name: "Table3", category: "Boost/Pressure" }),
		];
		const definition = createTestDefinition(tables);

		const document = new RomDocument(mockUri, mockBytes, definition);
		treeProvider.addDocument(document);

		const romNodes = await treeProvider.getChildren();
		const firstRomNode = romNodes[0];
		if (!firstRomNode) throw new Error("Expected first ROM node to be defined");
		const categoryNodes = await treeProvider.getChildren(firstRomNode);

		expect(categoryNodes).toHaveLength(3);
		const categoryLabels = categoryNodes.map((n) => n.label).sort();
		expect(categoryLabels).toEqual(
			[...new Set(tables.map((table) => table.category ?? "Uncategorized"))].sort(),
		);
	});

	it("should preserve table definition data in tree items", async () => {
		const mockUri = vscode.Uri.file("/test/rom.hex");
		const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

		const tables = [
			createTestTable({ name: "TestTable", category: "Fuel", kind: "table2d" }),
		];
		const definition = createTestDefinition(tables);

		const document = new RomDocument(mockUri, mockBytes, definition);
		treeProvider.addDocument(document);

		const romNodes = await treeProvider.getChildren();
		const firstRomNode = romNodes[0];
		if (!firstRomNode) throw new Error("Expected first ROM node to be defined");
		const categoryNodes = await treeProvider.getChildren(firstRomNode);
		const firstCategoryNode = categoryNodes[0];
		if (!firstCategoryNode)
			throw new Error("Expected first category node to be defined");

		const tableNodes = await treeProvider.getChildren(firstCategoryNode);

		const tableNode = tableNodes[0];
		if (!tableNode) throw new Error("Expected table node to be defined");

		expect(tableNode.data.type).toBe("table");
		if (tableNode.data.type === "table") {
			expect(tableNode.data.tableDef.name).toBe(tables[0]?.name);
			expect(tableNode.data.tableDef.kind).toBe(tables[0]?.kind);
		}
	});

	it("should handle large number of tables efficiently", async () => {
		const mockUri = vscode.Uri.file("/test/rom.hex");
		const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

		// Create 100 tables across 10 categories
		const tables: TableDefinition[] = [];
		for (let i = 0; i < 100; i++) {
			const categoryIndex = Math.floor(i / 10);
			tables.push(
				createTestTable({ name: `Table${i}`, category: `Category${categoryIndex}` }),
			);
		}

		const definition = createTestDefinition(tables);
		const document = new RomDocument(mockUri, mockBytes, definition);
		treeProvider.addDocument(document);

		const romNodes = await treeProvider.getChildren();
		const firstRomNode = romNodes[0];
		if (!firstRomNode) throw new Error("Expected first ROM node to be defined");
		const categoryNodes = await treeProvider.getChildren(firstRomNode);

		expect(categoryNodes).toHaveLength(10);

		// Check that each category has 10 tables
		for (const categoryNode of categoryNodes) {
			const tableNodes = await treeProvider.getChildren(categoryNode);
			expect(tableNodes).toHaveLength(10);
		}
	});

	// Phase 3: Dirty State, Table Count, and Table Type Icon Tests

	it("should display table count in category description", async () => {
		const mockUri = vscode.Uri.file("/test/rom.hex");
		const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

		const tables = [
			createTestTable({ name: "Table1", category: "Fuel" }),
			createTestTable({ name: "Table2", category: "Fuel" }),
			createTestTable({ name: "Table3", category: "Fuel" }),
		];
		const definition = createTestDefinition(tables);

		const document = new RomDocument(mockUri, mockBytes, definition);
		treeProvider.addDocument(document);

		const romNodes = await treeProvider.getChildren();
		const firstRomNode = romNodes[0];
		if (!firstRomNode) throw new Error("Expected first ROM node to be defined");
		const categoryNodes = await treeProvider.getChildren(firstRomNode);

		expect(categoryNodes).toHaveLength(1);
		expect(categoryNodes[0]?.description).toBe(`${tables.length} tables`);
	});

	it("should display singular 'table' for single table in category", async () => {
		const mockUri = vscode.Uri.file("/test/rom.hex");
		const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

		const tables = [createTestTable({ name: "Table1", category: "Fuel" })];
		const definition = createTestDefinition(tables);

		const document = new RomDocument(mockUri, mockBytes, definition);
		treeProvider.addDocument(document);

		const romNodes = await treeProvider.getChildren();
		const firstRomNode = romNodes[0];
		if (!firstRomNode) throw new Error("Expected first ROM node to be defined");
		const categoryNodes = await treeProvider.getChildren(firstRomNode);

		expect(categoryNodes).toHaveLength(1);
		expect(categoryNodes[0]?.description).toBe(`${tables.length} table`);
	});

	it("should show correct icon for 1D table", async () => {
		const mockUri = vscode.Uri.file("/test/rom.hex");
		const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

		const tables = [
			createTestTable({ name: "Table1D", category: "Fuel", kind: "table1d" }),
		];
		const definition = createTestDefinition(tables);

		const document = new RomDocument(mockUri, mockBytes, definition);
		treeProvider.addDocument(document);

		const romNodes = await treeProvider.getChildren();
		const firstRomNode = romNodes[0];
		if (!firstRomNode) throw new Error("Expected first ROM node to be defined");
		const categoryNodes = await treeProvider.getChildren(firstRomNode);
		const firstCategoryNode = categoryNodes[0];
		if (!firstCategoryNode)
			throw new Error("Expected first category node to be defined");

		const tableNodes = await treeProvider.getChildren(firstCategoryNode);

		expect(tableNodes).toHaveLength(1);
		const tableNode = tableNodes[0];
		if (!tableNode) throw new Error("Expected table node to be defined");

		expect(tableNode.iconPath).toBeDefined();
		if (tableNode.iconPath instanceof vscode.ThemeIcon) {
			expect(tableNode.iconPath.id).toBe("graph-line");
		}
	});

	it("should show correct icon for 2D table", async () => {
		const mockUri = vscode.Uri.file("/test/rom.hex");
		const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

		const tables = [
			createTestTable({ name: "Table2D", category: "Fuel", kind: "table2d" }),
		];
		const definition = createTestDefinition(tables);

		const document = new RomDocument(mockUri, mockBytes, definition);
		treeProvider.addDocument(document);

		const romNodes = await treeProvider.getChildren();
		const firstRomNode = romNodes[0];
		if (!firstRomNode) throw new Error("Expected first ROM node to be defined");
		const categoryNodes = await treeProvider.getChildren(firstRomNode);
		const firstCategoryNode = categoryNodes[0];
		if (!firstCategoryNode)
			throw new Error("Expected first category node to be defined");

		const tableNodes = await treeProvider.getChildren(firstCategoryNode);

		expect(tableNodes).toHaveLength(1);
		const tableNode = tableNodes[0];
		if (!tableNode) throw new Error("Expected table node to be defined");

		expect(tableNode.iconPath).toBeDefined();
		if (tableNode.iconPath instanceof vscode.ThemeIcon) {
			expect(tableNode.iconPath.id).toBe("table");
		}
	});

	it("should show correct icon for 3D table", async () => {
		const mockUri = vscode.Uri.file("/test/rom.hex");
		const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

		const tables = [
			createTestTable({ name: "Table3D", category: "Fuel", kind: "table3d" }),
		];
		const definition = createTestDefinition(tables);

		const document = new RomDocument(mockUri, mockBytes, definition);
		treeProvider.addDocument(document);

		const romNodes = await treeProvider.getChildren();
		const firstRomNode = romNodes[0];
		if (!firstRomNode) throw new Error("Expected first ROM node to be defined");
		const categoryNodes = await treeProvider.getChildren(firstRomNode);
		const firstCategoryNode = categoryNodes[0];
		if (!firstCategoryNode)
			throw new Error("Expected first category node to be defined");

		const tableNodes = await treeProvider.getChildren(firstCategoryNode);

		expect(tableNodes).toHaveLength(1);
		const tableNode = tableNodes[0];
		if (!tableNode) throw new Error("Expected table node to be defined");

		expect(tableNode.iconPath).toBeDefined();
		if (tableNode.iconPath instanceof vscode.ThemeIcon) {
			expect(tableNode.iconPath.id).toBe("cube");
		}
	});

	it("should show different icons for different table types in same category", async () => {
		const mockUri = vscode.Uri.file("/test/rom.hex");
		const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

		const tables = [
			createTestTable({ name: "Table1D", category: "Fuel", kind: "table1d" }),
			createTestTable({ name: "Table2D", category: "Fuel", kind: "table2d" }),
			createTestTable({ name: "Table3D", category: "Fuel", kind: "table3d" }),
		];
		const definition = createTestDefinition(tables);

		const document = new RomDocument(mockUri, mockBytes, definition);
		treeProvider.addDocument(document);

		const romNodes = await treeProvider.getChildren();
		const firstRomNode = romNodes[0];
		if (!firstRomNode) throw new Error("Expected first ROM node to be defined");

		const categoryNodes = await treeProvider.getChildren(firstRomNode);
		const firstCategoryNode = categoryNodes[0];
		if (!firstCategoryNode)
			throw new Error("Expected first category node to be defined");

		const tableNodes = await treeProvider.getChildren(firstCategoryNode);

		expect(tableNodes).toHaveLength(3);

		// Check each table has correct icon
		const icons = tableNodes.map((node) => {
			if (node.iconPath instanceof vscode.ThemeIcon) {
				return node.iconPath.id;
			}
			return undefined;
		});

		expect(icons).toContain("graph-line");
		expect(icons).toContain("table");
		expect(icons).toContain("cube");
	});
});
