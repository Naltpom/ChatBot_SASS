// Helper partagé d'extraction de message d'erreur — pour passer les blocs
// `catch (err: unknown)` sans accès direct à `err.message` (interdit sur
// `unknown`). ApiError étend Error, donc son `.message` reste préservé.
export function errMsg(err: unknown, fallback = 'Une erreur est survenue.'): string {
  return err instanceof Error ? err.message : fallback
}
