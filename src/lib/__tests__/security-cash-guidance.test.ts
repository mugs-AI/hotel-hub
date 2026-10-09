import { expect, it } from "vitest";
import { operationErrorMessage } from "../operations-client";
import { settlementMessage } from "@/components/SettlementCard";
it("guides a required-deposit refusal to collection or Owner waiver", () =>
  expect(operationErrorMessage("security_collection_required")).toContain("waiver"));
it("guides a custody checkout refusal without changing guest bill rules", () =>
  expect(settlementMessage("security_return_required")).toContain("security cash"));
