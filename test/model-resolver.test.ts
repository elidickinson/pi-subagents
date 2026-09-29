import { describe, expect, it } from "vitest";
import { describeModel, type ModelRegistry, resolveModel } from "../src/model-resolver.js";

// Mock model entries matching typical pi model registry shape
const MODELS = [
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: "anthropic" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic" },
  { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", provider: "anthropic" },
  { id: "gpt-4o", name: "GPT-4o", provider: "openai" },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "google" },
];

function makeRegistry(models = MODELS, available?: typeof MODELS): ModelRegistry {
  return {
    find(provider: string, modelId: string) {
      return models.find(m => m.provider === provider && m.id === modelId);
    },
    getAll() {
      return models;
    },
    getAvailable: available ? () => available : undefined,
  };
}

/** A scope (resolved enabledModels keys) covering the given models. */
function scopeOf(models: { provider: string; id: string }[] = MODELS): Set<string> {
  return new Set(models.map(m => `${m.provider}/${m.id}`.toLowerCase()));
}

describe("resolveModel", () => {
  describe("provider/modelId is exact", () => {
    it("resolves exact provider/modelId", () => {
      expect(resolveModel("anthropic/claude-opus-4-6", makeRegistry())).toEqual(MODELS[0]);
      expect(resolveModel("openai/gpt-4o", makeRegistry())).toEqual(MODELS[3]);
    });

    it("is case-insensitive", () => {
      expect(resolveModel("Anthropic/Claude-Opus-4-6", makeRegistry())).toEqual(MODELS[0]);
    });

    it("does not fuzzy-match a near miss, even with a scope", () => {
      for (const input of ["anthropic/haiku", "anthropic/claude-haiku-4.5", "anthropic/claude-haiku-4-5"]) {
        const result = resolveModel(input, makeRegistry(), scopeOf());
        expect(result).toContain(`Model not found: "${input}"`);
      }
    });

    it("never lands on another provider's copy of the model", () => {
      const gatewayHaiku = { id: "anthropic/claude-haiku-4.5", name: "Claude Haiku 4.5", provider: "openrouter" };
      const reg = makeRegistry([gatewayHaiku]);
      expect(typeof resolveModel("anthropic/claude-haiku-4.5", reg)).toBe("string");
      expect(typeof resolveModel("anthropic/claude-haiku-4.5", reg, scopeOf([gatewayHaiku]))).toBe("string");
      expect(resolveModel("openrouter/anthropic/claude-haiku-4.5", reg)).toEqual(gatewayHaiku);
    });

    it("resolves an out-of-scope exact model (the scope check decides what to do with it)", () => {
      expect(resolveModel("openai/gpt-4o", makeRegistry(), scopeOf([MODELS[0]]))).toEqual(MODELS[3]);
    });

    it("fails when the model has no auth (not in getAvailable)", () => {
      const result = resolveModel("anthropic/claude-sonnet-4-6", makeRegistry(MODELS, [MODELS[0]]));
      expect(result).toContain("Model not found");
      expect(result).toContain("Closest available models:\n  anthropic/claude-opus-4-6");
    });
  });

  describe("unscoped errors suggest instead of listing everything", () => {
    it("puts another provider's copy of the model first, without using it", () => {
      const gatewayHaiku = { id: "anthropic/claude-haiku-4.5", name: "Claude Haiku 4.5", provider: "openrouter" };
      const result = resolveModel("anthropic/claude-haiku-4-5", makeRegistry([...MODELS, gatewayHaiku]));
      expect(result).toContain("Closest available models:\n  openrouter/anthropic/claude-haiku-4.5\n");
    });

    it("suggests a typo's model family", () => {
      const result = resolveModel("anthropic/claude-sonet-4-6", makeRegistry());
      expect(result).toContain("  anthropic/claude-sonnet-4-6");
      expect(result).not.toContain("openai/gpt-4o");
    });

    it("caps the suggestions at five", () => {
      const many = Array.from({ length: 20 }, (_, i) => ({ id: `claude-haiku-${i}`, name: "Haiku", provider: "p" }));
      const result = resolveModel("haiku", makeRegistry(many));
      expect(result.split("\n  ").length - 1).toBe(5);
    });

    it("says so when nothing is close", () => {
      expect(resolveModel("zzz/qqq", makeRegistry())).toContain("No close matches among 5 available models.");
    });
  });

  describe("short names need a scope", () => {
    it("refuses a short name when there is no scope", () => {
      const result = resolveModel("haiku", makeRegistry());
      expect(result).toContain('"haiku" is not a provider/modelId');
      expect(result).toContain("Closest available models:\n  anthropic/claude-haiku-4-5-20251001");
    });

    it("only considers scoped models", () => {
      const scope = scopeOf([MODELS[0], MODELS[3]]);
      expect(resolveModel("opus", makeRegistry(), scope)).toEqual(MODELS[0]);
      const result = resolveModel("haiku", makeRegistry(), scope);
      expect(result).toContain('No scoped model matches "haiku"');
      expect(result).toContain("Scoped models:\n  anthropic/claude-opus-4-6\n  openai/gpt-4o");
    });

    it("ignores scoped models that have no auth", () => {
      expect(typeof resolveModel("haiku", makeRegistry(MODELS, [MODELS[0]]), scopeOf())).toBe("string");
    });
  });

  describe("fuzzy match within scope", () => {
    const resolve = (input: string, models = MODELS) => resolveModel(input, makeRegistry(models), scopeOf(models));

    it("matches exact id, case-insensitively", () => {
      expect(resolve("claude-opus-4-6")).toEqual(MODELS[0]);
      expect(resolve("Claude-Opus-4-6")).toEqual(MODELS[0]);
      expect(resolve("gpt-4o")).toEqual(MODELS[3]);
    });

    it("matches substrings", () => {
      expect(resolve("haiku")).toEqual(MODELS[2]);
      expect(resolve("sonnet")).toEqual(MODELS[1]);
      expect(resolve("opus")).toEqual(MODELS[0]);
      expect(resolve("gemini")).toEqual(MODELS[4]);
      expect(resolve("HAIKU")).toEqual(MODELS[2]);
    });

    it("treats dot and dash as equivalent", () => {
      const haiku = { id: "claude-haiku-4-5", name: "Claude Haiku", provider: "anthropic" };
      expect(resolve("claude-haiku-4.5", [haiku])).toEqual(haiku);
      expect(resolve("gemini-2-5-pro")).toEqual(MODELS[4]);
    });

    it("treats a trailing date stamp as optional", () => {
      const haiku = { id: "claude-haiku-4.5", name: "Claude Haiku", provider: "anthropic" };
      expect(resolve("claude-haiku-4-5-20251001", [haiku])).toEqual(haiku);
    });

    it("matches via model name and across name parts", () => {
      expect(resolve("Opus 4.6")).toEqual(MODELS[0]);
      expect(resolve("Haiku 4.5")).toEqual(MODELS[2]);
      expect(resolve("anthropic opus")).toEqual(MODELS[0]);
      expect(resolve("google pro")).toEqual(MODELS[4]);
    });

    it("prefers tighter matches", () => {
      const similar = [
        { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic" },
        { id: "claude-sonnet-4-5-20241022", name: "Claude Sonnet 4.5", provider: "anthropic" },
        { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", provider: "anthropic" },
      ];
      expect(resolve("sonnet", similar)).toEqual(similar[0]);
      expect(resolve("sonnet 4.5", similar)).toEqual(similar[1]);
      expect(resolve("4-6", similar)).toEqual(similar[0]);
    });

    it("errors when nothing matches", () => {
      expect(resolve("nonexistent-model")).toContain('No scoped model matches "nonexistent-model"');
      expect(resolve("haiku", [])).toContain("No scoped model matches");
    });

    it("fuzzy-matches a model without a name instead of crashing", () => {
      // Extension-registered providers can omit `name`; pi doesn't default it.
      const nameless = { id: "local-coder-7b", provider: "ollama" } as (typeof MODELS)[number];
      expect(resolve("coder", [...MODELS, nameless])).toEqual(nameless);
    });
  });
});

describe("describeModel", () => {
  it("gives a short label and a canonical id", () => {
    expect(describeModel({ provider: "anthropic", id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" }))
      .toEqual({ modelName: "sonnet 4.6", modelId: "anthropic/claude-sonnet-4-6" });
  });

  it("falls back to the id when the model has no display name", () => {
    expect(describeModel({ provider: "openai-codex", id: "gpt-5.6-sol" }))
      .toEqual({ modelName: "gpt-5.6-sol", modelId: "openai-codex/gpt-5.6-sol" });
  });
});
