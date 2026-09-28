import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { HOUSEKEEPING_QUERY_KEY, resetHousekeepingBoardCache } from "../housekeeping-client";

describe("dashboard tenant cache isolation", () => {
  it("clears every tenant's old housekeeping board when the property mode changes", () => {
    const qc = new QueryClient();
    qc.setQueryData([...HOUSEKEEPING_QUERY_KEY, "tenant-a"], { propertyDate: "2026-09-26" });
    qc.setQueryData([...HOUSEKEEPING_QUERY_KEY, "tenant-b"], { propertyDate: "2026-09-27" });
    resetHousekeepingBoardCache(qc);
    expect(qc.getQueryData([...HOUSEKEEPING_QUERY_KEY, "tenant-a"])).toBeUndefined();
    expect(qc.getQueryData([...HOUSEKEEPING_QUERY_KEY, "tenant-b"])).toBeUndefined();
  });
});
