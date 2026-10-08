import { describe, expect, it } from "vitest";
import { folioErrorMessage, FolioApiError } from "../folio-client";
import { depositErrorMessage } from "../deposits-client";
import { operationErrorMessage } from "../operations-client";
import { receiptControlMessage } from "../receipt-controls-client";
describe("financial freeze feedback across affected readers", () => {
  it.each(["settlement_locked", "settlement_busy"])(
    "%s explains the same boundary without a generic retry instruction",
    (code) => {
      const messages = [
        folioErrorMessage(new FolioApiError(code, 409)),
        depositErrorMessage(code),
        operationErrorMessage(code),
        receiptControlMessage(code),
      ];
      for (const message of messages)
        expect(message).toMatch(
          code === "settlement_locked" ? /billing is frozen/i : /another reservation operation/i,
        );
    },
  );
});
