/**
 * Model resolution: exact "provider/modelId", or a short name fuzzy-matched
 * within the scoped models.
 */

export interface ModelEntry {
  id: string;
  name?: string;
  provider: string;
}

export interface ModelRegistry {
  find(provider: string, modelId: string): any;
  getAll(): any[];
  getAvailable?(): any[];
}

/**
 * Both display forms of a model. The short one goes on tight rows (the widget,
 * the Agent tool result), the canonical one where there is room to disambiguate
 * two providers serving a similarly-named model (the conversation viewer).
 *
 * One function, because `index.ts` labels the model it resolved before the run
 * and `agent-manager.ts` relabels it from the live session afterwards — the two
 * must agree or the label would visibly change the moment the session starts.
 */
export function describeModel(
  model: { provider: string; id: string; name?: string },
): { modelName: string; modelId: string } {
  return {
    modelName: (model.name ?? model.id).replace(/^Claude\s+/i, "").toLowerCase(),
    modelId: `${model.provider}/${model.id}`,
  };
}

/**
 * Resolve a model string to a Model instance, or an error message string.
 *
 * A "provider/modelId" must name an available (authed) model exactly, ignoring
 * case. A short name like "haiku" is fuzzy-matched, but only against `scope`
 * (the resolved enabledModels keys); without a scope, short names are refused.
 * Matching never crosses providers on its own, so a mistyped or guessed name
 * errors instead of landing on whichever provider happens to carry a lookalike.
 */
export function resolveModel(
  input: string,
  registry: ModelRegistry,
  scope?: Set<string>,
): any | string {
  // Available models (those with auth configured)
  const all = (registry.getAvailable?.() ?? registry.getAll()) as ModelEntry[];
  const key = (m: ModelEntry) => `${m.provider}/${m.id}`.toLowerCase();
  const candidates = scope ? all.filter(m => scope.has(key(m))) : all;
  const notFound = (reason: string) => {
    const list = candidates.map(m => `  ${m.provider}/${m.id}`).sort().join("\n");
    return `${reason}\n\n${scope ? "Scoped" : "Available"} models:\n${list}`;
  };

  if (input.includes("/")) {
    const exact = all.find(m => key(m) === input.toLowerCase());
    const found = exact && registry.find(exact.provider, exact.id);
    return found ?? notFound(`Model not found: "${input}". Use an exact provider/modelId.`);
  }

  if (!scope) {
    return notFound(
      `Model "${input}" is not a provider/modelId. Short names only match scoped models (scopeModels on, with enabledModels set).`,
    );
  }

  // Fuzzy match. Normalize separators so cosmetic punctuation differences still
  // match — e.g. "claude-haiku-4.5" and "claude-haiku-4-5" (dot vs dash).
  const normalize = (s: string) => s.toLowerCase().replace(/\./g, "-");
  const query = normalize(input);

  // Score each model: prefer exact id match > id contains > name contains > provider+id contains
  let bestMatch: ModelEntry | undefined;
  let bestScore = 0;

  for (const m of candidates) {
    const id = normalize(m.id);
    const name = normalize(m.name ?? "");
    const full = normalize(`${m.provider}/${m.id}`);

    let score = 0;
    if (id === query || full === query) {
      score = 100; // exact
    } else if (id.includes(query) || full.includes(query)) {
      score = 60 + (query.length / id.length) * 30; // substring, prefer tighter matches
    } else if (name.includes(query)) {
      score = 40 + (query.length / name.length) * 20;
    } else if (
      // A trailing date-stamp token (e.g. "20251001") is optional, so a
      // date-pinned config like "claude-haiku-4-5-20251001" still matches an
      // undated registry id like "claude-haiku-4-5".
      query
        .split(/[\s\-/]+/)
        .every(part => /^\d{8}$/.test(part) || id.includes(part) || name.includes(part) || m.provider.toLowerCase().includes(part))
    ) {
      score = 20; // all parts present somewhere
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = m;
    }
  }

  const found = bestMatch && bestScore >= 20 && registry.find(bestMatch.provider, bestMatch.id);
  return found || notFound(`No scoped model matches "${input}".`);
}
