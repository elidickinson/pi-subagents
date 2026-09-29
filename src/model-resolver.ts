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

/** Most models an unscoped error message suggests. */
const MAX_SUGGESTIONS = 5;

// Normalize separators so cosmetic punctuation differences still match —
// e.g. "claude-haiku-4.5" and "claude-haiku-4-5" (dot vs dash).
const normalize = (s: string) => s.toLowerCase().replace(/\./g, "-");

/**
 * How well a normalized query matches a model: exact id > id substring (tighter
 * scores higher) > name substring > every part present somewhere > 0.
 */
function matchScore(query: string, m: ModelEntry): number {
  const id = normalize(m.id);
  const name = normalize(m.name ?? "");
  const full = normalize(`${m.provider}/${m.id}`);

  if (id === query || full === query) return 100;
  if (id.includes(query) || full.includes(query)) return 60 + (query.length / id.length) * 30;
  if (name.includes(query)) return 40 + (query.length / name.length) * 20;
  // A trailing date-stamp token (e.g. "20251001") is optional, so a
  // date-pinned config like "claude-haiku-4-5-20251001" still matches an
  // undated registry id like "claude-haiku-4-5".
  const allParts = query
    .split(/[\s\-/]+/)
    .every(part => /^\d{8}$/.test(part) || id.includes(part) || name.includes(part) || m.provider.toLowerCase().includes(part));
  return allParts ? 20 : 0;
}

/**
 * The models closest to `input`, best first: by match score, then by how many
 * of its words (3+ letters) they contain, so a typo still surfaces its family.
 */
function suggest(input: string, models: ModelEntry[]): ModelEntry[] {
  const query = normalize(input);
  const words = query.split(/[\s\-/]+/).filter(w => w.length >= 3 && !/^\d+$/.test(w));
  const rank = (m: ModelEntry) => {
    const text = normalize(`${m.provider}/${m.id} ${m.name ?? ""}`);
    return matchScore(query, m) + words.filter(w => text.includes(w)).length;
  };
  return models
    .map(m => ({ m, r: rank(m) }))
    .filter(({ r }) => r > 0)
    .sort((a, b) => b.r - a.r || a.m.id.length - b.m.id.length)
    .slice(0, MAX_SUGGESTIONS)
    .map(({ m }) => m);
}

/**
 * Resolve a model string to a Model instance, or an error message string.
 *
 * A "provider/modelId" must name an available (authed) model exactly, ignoring
 * case. A short name like "haiku" is fuzzy-matched, but only against `scope`
 * (the resolved enabledModels keys); without a scope, short names are refused.
 * Matching never crosses providers on its own, so a mistyped or guessed name
 * errors instead of landing on whichever provider happens to carry a lookalike.
 *
 * Errors list the scoped models when there is a scope, else the few closest
 * available ones — the full catalogue can run to hundreds.
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
  const lines = (models: ModelEntry[]) => models.map(m => `  ${m.provider}/${m.id}`);
  const notFound = (reason: string) => {
    if (scope) return `${reason}\n\nScoped models:\n${lines(candidates).sort().join("\n")}`;
    const close = suggest(input, all);
    return close.length
      ? `${reason}\n\nClosest available models:\n${lines(close).join("\n")}`
      : `${reason}\n\nNo close matches among ${all.length} available models.`;
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

  const query = normalize(input);
  let bestMatch: ModelEntry | undefined;
  let bestScore = 0;
  for (const m of candidates) {
    const score = matchScore(query, m);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = m;
    }
  }

  const found = bestMatch && registry.find(bestMatch.provider, bestMatch.id);
  return found || notFound(`No scoped model matches "${input}".`);
}
