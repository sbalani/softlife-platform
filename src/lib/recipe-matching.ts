export type RecipeMatchCandidate = {
  id: string;
  name: string;
  componentIds: string[];
};

export type RecipeMatchSuggestion = {
  recipe_id: string;
  recipe_name: string;
  confidence: number;
  matched_components: number;
  missing_components: number;
  extra_components: number;
  exact: boolean;
};

export function rankRecipeMatches(observedProductIds: string[], candidates: RecipeMatchCandidate[]): RecipeMatchSuggestion[] {
  const observed = new Set(observedProductIds.filter(Boolean));
  if (observed.size === 0) return [];
  return candidates.map((candidate) => {
    const components = new Set(candidate.componentIds.filter(Boolean));
    const matched = [...observed].filter((id) => components.has(id)).length;
    const denominator = observedProductIds.length + components.size;
    return {
      recipe_id: candidate.id,
      recipe_name: candidate.name,
      confidence: denominator ? Math.round((200 * matched) / denominator) : 0,
      matched_components: matched,
      missing_components: Math.max(0, components.size - matched),
      extra_components: Math.max(0, observedProductIds.length - matched),
      exact: observedProductIds.length === observed.size && observed.size === components.size && matched === observed.size,
    };
  }).filter((suggestion) => suggestion.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence
      || b.matched_components - a.matched_components
      || (a.missing_components + a.extra_components) - (b.missing_components + b.extra_components)
      || a.recipe_name.localeCompare(b.recipe_name)
      || a.recipe_id.localeCompare(b.recipe_id));
}

export function uniqueExactRecipe(suggestions: RecipeMatchSuggestion[]) {
  const exact = suggestions.filter((suggestion) => suggestion.exact);
  return exact.length === 1 ? exact[0] : null;
}
