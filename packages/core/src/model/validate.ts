import { ConversationShapeSchema, type Conversation } from './schema.ts';

/** One problem found while validating a conversation. `path` points into the input, e.g. `["nodes", "n3", "parentId"]`. */
export interface ValidationIssue {
  path: (string | number)[];
  message: string;
}

/** Thrown by {@link parseConversation}. Carries every issue found, not just the first. */
export class EchoesValidationError extends Error {
  override readonly name = 'EchoesValidationError';
  readonly issues: ValidationIssue[];
  constructor(issues: ValidationIssue[]) {
    super(
      `Invalid Echoes conversation (${issues.length} issue${issues.length === 1 ? '' : 's'}):\n` +
        issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n'),
    );
    this.issues = issues;
  }
}

export type ParseResult = { success: true; data: Conversation } | { success: false; issues: ValidationIssue[] };

/**
 * Validate unknown input as an Echoes conversation: field shapes (zod) and tree integrity.
 *
 * Tree integrity means: every map key equals its node's `id`; the root exists and has no parent; every other node's
 * parent exists and lists it exactly once in `childIds`; every child id exists; every node is reachable from the root
 * (so there are no cycles or orphans); and `activeLeafId` names a node with no children. A `lineage.parentSnapshot`
 * is checked the same way.
 *
 * @example
 * ```ts
 * const result = safeParseConversation(JSON.parse(text));
 * if (!result.success) console.error(result.issues);
 * ```
 */
export function safeParseConversation(input: unknown): ParseResult {
  const shape = ConversationShapeSchema.safeParse(input);
  if (!shape.success) {
    return {
      success: false,
      issues: shape.error.issues.map((i) => ({ path: i.path.map(toKey), message: i.message })),
    };
  }
  const data = shape.data as Conversation;
  const issues = treeIssues(data, []);
  if (data.lineage?.parentSnapshot) issues.push(...treeIssues(data.lineage.parentSnapshot, ['lineage', 'parentSnapshot']));
  return issues.length ? { success: false, issues } : { success: true, data };
}

/**
 * Like {@link safeParseConversation} but throws {@link EchoesValidationError} on failure.
 *
 * @example
 * ```ts
 * const conversation = parseConversation(JSON.parse(text)); // typed Conversation, tree checked
 * ```
 */
export function parseConversation(input: unknown): Conversation {
  const result = safeParseConversation(input);
  if (!result.success) throw new EchoesValidationError(result.issues);
  return result.data;
}

function toKey(k: PropertyKey): string | number {
  return typeof k === 'symbol' ? String(k) : k;
}

function treeIssues(c: Conversation, base: (string | number)[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const at = (path: (string | number)[], message: string) => issues.push({ path: [...base, ...path], message });
  const { nodes } = c;

  for (const [key, node] of Object.entries(nodes)) {
    if (node.id !== key) at(['nodes', key, 'id'], `id "${node.id}" does not match its key "${key}"`);
    const seen = new Set<string>();
    for (const [i, childId] of node.childIds.entries()) {
      if (seen.has(childId)) at(['nodes', key, 'childIds', i], `duplicate child "${childId}"`);
      seen.add(childId);
      const child = nodes[childId];
      if (!child) at(['nodes', key, 'childIds', i], `child "${childId}" does not exist`);
      else if (child.parentId !== key) at(['nodes', childId, 'parentId'], `expected parent "${key}", got "${child.parentId}"`);
    }
    if (key === c.rootId) {
      if (node.parentId !== null) at(['nodes', key, 'parentId'], 'root node must have parentId null');
    } else if (node.parentId === null) {
      at(['nodes', key, 'parentId'], 'only the root may have parentId null');
    } else {
      const parent = nodes[node.parentId];
      if (!parent) at(['nodes', key, 'parentId'], `parent "${node.parentId}" does not exist`);
      else if (!parent.childIds.includes(key)) at(['nodes', node.parentId, 'childIds'], `missing child "${key}"`);
    }
  }

  const root = nodes[c.rootId];
  if (!root) at(['rootId'], `root "${c.rootId}" does not exist`);
  const leaf = nodes[c.activeLeafId];
  if (!leaf) at(['activeLeafId'], `node "${c.activeLeafId}" does not exist`);
  else if (leaf.childIds.length > 0) at(['activeLeafId'], `node "${c.activeLeafId}" has children, so it is not a leaf`);

  if (root && issues.length === 0) {
    // Only safe once links are consistent: then a walk from the root visits each node once unless there is a cycle.
    const reached = new Set<string>();
    const stack = [c.rootId];
    while (stack.length) {
      const id = stack.pop()!;
      if (reached.has(id)) {
        at(['nodes', id], 'cycle detected');
        break;
      }
      reached.add(id);
      stack.push(...nodes[id]!.childIds);
    }
    for (const id of Object.keys(nodes)) if (!reached.has(id)) at(['nodes', id], 'not reachable from the root');
  }
  return issues;
}
