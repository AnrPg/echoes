/**
 * Picked turns split into files of N: turns 1–5 in the first file, 6–10 in the next, and so on. The host renders
 * each group with `selectedTurns: group.turns`, so turn numbers stay the chat's own and gaps show. Deterministic.
 *
 * @packageDocumentation
 */

/** One file's worth of turns. */
export interface TurnGroup {
  /** 1-based position among the groups. */
  n: number;
  /** 1-based turn indexes along the path, ascending (as `selectTurns` returns them). */
  turns: number[];
}

/**
 * Split turn indexes into groups of `size`, in turn order. Indexes are sorted and deduplicated first, so the same
 * picks always give the same groups. The last group holds what is left and may be smaller. No turns, no groups.
 * Counting is per chat: group each chat's own picks separately.
 *
 * @throws RangeError when `size` is not a whole number of at least 1.
 *
 * @example
 * ```ts
 * groupTurns([1, 2, 3, 4, 5, 6, 7], 5).map((g) => g.turns); // [[1, 2, 3, 4, 5], [6, 7]]
 * groupTurns([9, 2, 4, 2], 2).map((g) => g.turns);          // [[2, 4], [9]]
 * ```
 */
export function groupTurns(turns: readonly number[], size: number): TurnGroup[] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError(`group size must be a whole number of at least 1, got ${size}`);
  const sorted = [...new Set(turns)].sort((a, b) => a - b);
  const groups: TurnGroup[] = [];
  for (let i = 0; i < sorted.length; i += size) groups.push({ n: groups.length + 1, turns: sorted.slice(i, i + size) });
  return groups;
}

/**
 * The part of a file name that says which turns a group holds: `turns-01-05`, or `turns-07` for a group of one. The
 * numbers are the first and last turn in the group (with gaps, `turns-02-09` may hold only some turns between). They
 * are zero-padded to the widest turn number in `groups`, at least two digits, so the files sort in turn order.
 *
 * @example
 * ```ts
 * const groups = groupTurns([1, 2, 3, 4, 5, 6, 7], 5);
 * groups.map((g) => turnGroupLabel(g, groups)); // ['turns-01-05', 'turns-06-07']
 * ```
 */
export function turnGroupLabel(group: TurnGroup, groups: readonly TurnGroup[]): string {
  const widest = Math.max(0, ...groups.flatMap((g) => g.turns));
  const width = Math.max(2, String(widest).length);
  const pad = (t: number) => String(t).padStart(width, '0');
  const first = group.turns[0];
  const last = group.turns[group.turns.length - 1];
  if (first === undefined || last === undefined) throw new RangeError(`turn group ${group.n} is empty`);
  return first === last ? `turns-${pad(first)}` : `turns-${pad(first)}-${pad(last)}`;
}

/**
 * A file name (without extension) for a group: `<base>_turns-01-05`. `base` should already be safe, for example from
 * `safeFileName(conversation.title)`.
 *
 * @example
 * ```ts
 * const groups = groupTurns([1, 2, 3, 4, 5, 6, 7], 5);
 * groups.map((g) => turnGroupFileName('Chat title', g, groups)); // ['Chat title_turns-01-05', 'Chat title_turns-06-07']
 * ```
 */
export function turnGroupFileName(base: string, group: TurnGroup, groups: readonly TurnGroup[]): string {
  return `${base}_${turnGroupLabel(group, groups)}`;
}
