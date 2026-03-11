/**
 * Edit operation for undo/redo tracking
 */
export interface EditOperation {
	row: number;
	col: number;
	depth?: number;
	/** Direct ROM address — when set, used instead of calculateCellAddress(row, col) */
	address?: number;
	oldValue: Uint8Array;
	newValue: Uint8Array;
	timestamp: number;
	label?: string;
}

/**
 * A batch of edit operations that are undone/redone as a single unit.
 * Used for math operations that affect multiple cells at once.
 */
export interface BatchEditOperation {
	ops: EditOperation[];
	timestamp: number;
	label: string | undefined;
}

/** Stack entry — either a single edit or a batch */
export type StackEntry = EditOperation | BatchEditOperation;

export function isBatchEdit(entry: StackEntry): entry is BatchEditOperation {
	return "ops" in entry;
}

/**
 * Manages undo/redo stack for table edits
 */
export class UndoRedoManager {
	private undoStack: StackEntry[] = [];
	private redoStack: StackEntry[] = [];
	private readonly stateIds = new WeakMap<StackEntry, number>();
	private nextStateId = 1;
	private savePointStateId = 0;

	private assignStateId(entry: StackEntry): void {
		this.stateIds.set(entry, this.nextStateId++);
	}

	private getCurrentStateId(): number {
		const entry = this.undoStack.at(-1);
		if (!entry) {
			return 0;
		}

		return this.stateIds.get(entry) ?? 0;
	}

	/**
	 * Push an edit operation to the undo stack
	 * Clears redo stack when new edit is made
	 */
	push(op: EditOperation): void {
		this.assignStateId(op);
		this.undoStack.push(op);
		this.redoStack = [];
	}

	/**
	 * Push a batch of edit operations as a single undo unit.
	 * All operations in the batch are undone/redone together.
	 * Clears redo stack when new edit is made.
	 */
	pushBatch(ops: EditOperation[], label?: string): void {
		if (ops.length === 0) return;
		const batch = { ops, timestamp: Date.now(), label };
		this.assignStateId(batch);
		this.undoStack.push(batch);
		this.redoStack = [];
	}

	/**
	 * Undo the last operation (single or batch)
	 */
	undo(): StackEntry | null {
		const entry = this.undoStack.pop();
		if (entry) this.redoStack.push(entry);
		return entry ?? null;
	}

	/**
	 * Redo the last undone operation (single or batch)
	 */
	redo(): StackEntry | null {
		const entry = this.redoStack.pop();
		if (entry) this.undoStack.push(entry);
		return entry ?? null;
	}

	/**
	 * Check if undo is available
	 */
	canUndo(): boolean {
		return this.undoStack.length > 0;
	}

	/**
	 * Check if redo is available
	 */
	canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	/**
	 * Check if we're at the initial state (no changes)
	 * This is true when the undo stack is empty
	 */
	isAtInitialState(): boolean {
		return this.undoStack.length === 0;
	}

	/**
	 * Mark the current history state as the persisted save point.
	 */
	markSavePoint(): void {
		this.savePointStateId = this.getCurrentStateId();
	}

	/**
	 * Check if the current history state matches the last persisted save point.
	 */
	isAtSavePoint(): boolean {
		return this.getCurrentStateId() === this.savePointStateId;
	}

	/**
	 * Clear all history
	 */
	clear(): void {
		this.undoStack = [];
		this.redoStack = [];
		this.savePointStateId = 0;
	}
}
