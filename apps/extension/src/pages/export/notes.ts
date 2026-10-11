/**
 * Export warnings as a person reads them. The adapter repeats a warning per message, so a long chat can list the
 * same note dozens of times; this collapses repeats into one line with a count, in first-seen order. Warnings are
 * "code: message"; the code is dropped, as the message already says what happened.
 *
 * @example
 * ```ts
 * summarizeWarnings(['a: x', 'a: x', 'b: y']); // ['x (2 times)', 'y']
 * ```
 */
export function summarizeWarnings(warnings: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const w of warnings) {
    const text = w.replace(/^[a-z-]+: /, '');
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return [...counts].map(([text, n]) => (n > 1 ? `${text} (${n} times)` : text));
}
