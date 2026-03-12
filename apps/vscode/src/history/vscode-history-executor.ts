import type {
	EditTransaction,
	HistoryExecutionResult,
	HistoryExecutor,
} from "@ecu-explorer/ui";
import { getTransactionByteRange } from "@ecu-explorer/ui";
import type { RomDocument } from "../rom/document.js";

export interface ExecuteHistoryOptions {
	atSavePoint?: boolean;
}

export class VsCodeHistoryExecutor<
	TTransaction extends EditTransaction = EditTransaction,
> implements HistoryExecutor<TTransaction, HistoryExecutionResult>
{
	constructor(
		private readonly romBytes: Uint8Array,
		private readonly document: RomDocument | null = null,
	) {}

	apply(
		transaction: TTransaction,
		options: ExecuteHistoryOptions = {},
	): HistoryExecutionResult {
		for (const edit of transaction.edits) {
			this.romBytes.set(edit.after, edit.address);
		}

		return this.finish(transaction, options);
	}

	revert(
		transaction: TTransaction,
		options: ExecuteHistoryOptions = {},
	): HistoryExecutionResult {
		for (const edit of [...transaction.edits].reverse()) {
			this.romBytes.set(edit.before, edit.address);
		}

		return this.finish(transaction, options);
	}

	private finish(
		transaction: TTransaction,
		options: ExecuteHistoryOptions,
	): HistoryExecutionResult {
		const range = getTransactionByteRange(transaction);
		const atSavePoint = options.atSavePoint ?? false;

		if (this.document) {
			if (atSavePoint) {
				this.document.makeClean();
			}

			this.document.updateBytes(
				this.romBytes,
				range?.offset,
				range?.length,
				!atSavePoint,
			);
		}

		return { range };
	}
}
