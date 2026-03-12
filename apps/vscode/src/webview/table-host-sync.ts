import type { TableDefinition } from "@ecu-explorer/core";

export interface UndoRedoIntentSink {
	postMessage(message: { type: "undo" | "redo" }): void;
}

export type TableViewConstructor<TDefinition, TView> = new (
	rom: Uint8Array,
	definition: TDefinition,
) => TView;

export function postUndoIntent(sink: UndoRedoIntentSink): void {
	sink.postMessage({ type: "undo" });
}

export function postRedoIntent(sink: UndoRedoIntentSink): void {
	sink.postMessage({ type: "redo" });
}

export function rebuildTableViewFromHostUpdate<
	TDefinition extends TableDefinition,
	TView,
>(
	TableViewCtor: TableViewConstructor<TDefinition, TView>,
	definition: TDefinition,
	rom: Uint8Array,
): TView {
	return new TableViewCtor(rom, definition);
}
