import { describe, it, expect, afterEach } from "vitest";
import { GroupJoinManager, type DeliveryCallback } from "../src/group-join.js";
import type { AgentRecord } from "../src/types.js";

function makeRecord(id: string, overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id,
    type: "general-purpose",
    description: `agent ${id}`,
    status: "completed",
    toolUses: 1,
    startedAt: Date.now() - 1000,
    completedAt: Date.now(),
    ...overrides,
  };
}

describe("GroupJoinManager", () => {
  let manager: GroupJoinManager;

  afterEach(() => {
    manager?.dispose();
  });

  it("ungrouped agents pass through", () => {
    const delivered: AgentRecord[][] = [];
    manager = new GroupJoinManager((records) => delivered.push(records));

    const result = manager.onAgentComplete(makeRecord("1"));
    expect(result).toBe("pass");
    expect(delivered).toHaveLength(0);
  });

  it("delivers when all grouped agents complete", () => {
    const delivered: { records: AgentRecord[]; partial: boolean }[] = [];
    manager = new GroupJoinManager((records, partial) => delivered.push({ records, partial }));
    manager.registerGroup("g1", ["1", "2"]);

    expect(manager.onAgentComplete(makeRecord("1"))).toBe("held");
    expect(delivered).toHaveLength(0);

    expect(manager.onAgentComplete(makeRecord("2"))).toBe("delivered");
    expect(delivered).toHaveLength(1);
    expect(delivered[0].partial).toBe(false);
    expect(delivered[0].records.map(r => r.id).sort()).toEqual(["1", "2"]);
  });

  it("partial delivery on timeout, then straggler delivery", async () => {
    const delivered: { records: AgentRecord[]; partial: boolean }[] = [];
    // Use a short timeout so the test doesn't wait long
    manager = new GroupJoinManager((records, partial) => delivered.push({ records, partial }), 50);
    manager.registerGroup("g1", ["1", "2"]);

    manager.onAgentComplete(makeRecord("1"));
    expect(delivered).toHaveLength(0);

    // Wait for timeout to fire partial delivery
    await new Promise(r => setTimeout(r, 100));
    expect(delivered).toHaveLength(1);
    expect(delivered[0].partial).toBe(true);
    expect(delivered[0].records[0].id).toBe("1");

    // Straggler completes — should trigger another delivery
    manager.onAgentComplete(makeRecord("2"));
    // Straggler with 1 agent delivers immediately (size >= agentIds.size)
    expect(delivered).toHaveLength(2);
    expect(delivered[1].records[0].id).toBe("2");
  });

  // Verifies that the delivery callback receives the original record objects
  // by reference, so resultConsumed set externally is visible at delivery time.
  // This is the mechanism that suppresses stale notifications when the parent
  // has already retrieved results via get_subagent_result(wait=true).
  it("delivery callback sees resultConsumed set on records", () => {
    const delivered: AgentRecord[][] = [];
    manager = new GroupJoinManager((records) => delivered.push(records));
    manager.registerGroup("g1", ["1", "2"]);

    const r1 = makeRecord("1");
    const r2 = makeRecord("2");

    manager.onAgentComplete(r1);

    // Simulate get_subagent_result marking consumed before the group delivers
    r1.resultConsumed = true;

    manager.onAgentComplete(r2);

    // The delivery callback gets the original record objects — the caller
    // (index.ts) filters on resultConsumed to skip already-consumed agents.
    expect(delivered).toHaveLength(1);
    const unconsumed = delivered[0].filter(r => !r.resultConsumed);
    expect(unconsumed).toHaveLength(1);
    expect(unconsumed[0].id).toBe("2");
  });

  it("isGrouped returns correct state", () => {
    manager = new GroupJoinManager(() => {});
    manager.registerGroup("g1", ["1", "2"]);

    expect(manager.isGrouped("1")).toBe(true);
    expect(manager.isGrouped("3")).toBe(false);
  });

  it("cleans up after full delivery", () => {
    manager = new GroupJoinManager(() => {});
    manager.registerGroup("g1", ["1"]);

    manager.onAgentComplete(makeRecord("1"));

    // After delivery, agent is no longer grouped
    expect(manager.isGrouped("1")).toBe(false);
    // Re-completing returns pass (group is gone)
    expect(manager.onAgentComplete(makeRecord("1"))).toBe("pass");
  });
});
