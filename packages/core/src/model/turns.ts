import type { Block, Node } from './schema.ts';

/**
 * A turn: one user node plus the assistant and tool nodes after it, up to the next user node. Turns are a derived
 * view over a path (see {@link activePath}, {@link pathThrough}); they are never stored in the tree.
 */
export interface Turn {
  /** 1-based position along the path. Turn 0 exists only when non-user nodes come before the first question. */
  index: number;
  /** The question, or undefined for turn 0. */
  question: Node | undefined;
  /** Assistant, tool and system nodes after the question, in path order. */
  responses: Node[];
}

/**
 * Split a path's nodes into turns. Nodes before the first user node (system prompt, context) form turn 0, which is
 * omitted when empty. Hidden nodes are kept here; {@link applyTurnDefinition} decides whether to show them.
 *
 * @example
 * ```ts
 * const turns = buildTurns(nodesOf(conversation, activePath(conversation)));
 * turns.map((t) => t.index); // [0, 1, 2]
 * ```
 */
export function buildTurns(pathNodes: readonly Node[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn = { index: 0, question: undefined, responses: [] };
  for (const node of pathNodes) {
    if (node.role === 'user') {
      if (current.question || current.responses.length) turns.push(current);
      current = { index: current.index + 1, question: node, responses: [] };
    } else {
      current.responses.push(node);
    }
  }
  if (current.question || current.responses.length) turns.push(current);
  return turns;
}

/**
 * Which parts of a turn to include. Each flag is a user-facing toggle in the turn-definition presets.
 * `reasoning` means only the summaries the provider shows, never raw chain of thought.
 */
export interface TurnDefinition {
  questions: boolean;
  answers: boolean;
  reasoning: boolean;
  /** Tool nodes, tool code runs and tool outputs. */
  tools: boolean;
  citations: boolean;
  images: boolean;
  attachments: boolean;
  /** Memory, custom instructions and other context the chat view hides. Off by default. */
  hidden: boolean;
}

/** Built-in presets. Hosts may store their own; these names are stable. */
export const TURN_PRESETS = {
  fullArchive: {
    questions: true, answers: true, reasoning: true, tools: true,
    citations: true, images: true, attachments: true, hidden: false,
  },
  answersOnly: {
    questions: false, answers: true, reasoning: false, tools: false,
    citations: false, images: true, attachments: false, hidden: false,
  },
  studyNotes: {
    questions: true, answers: true, reasoning: false, tools: false,
    citations: true, images: true, attachments: false, hidden: false,
  },
} as const satisfies Record<string, TurnDefinition>;

/**
 * Filter one turn by a {@link TurnDefinition}. Returns a new turn; inputs are not mutated. A node left with no
 * blocks is dropped. `unknown` blocks count as the node's main content: they are kept whenever the question or
 * answer they belong to is included, so content an adapter could not parse stays visible instead of vanishing.
 *
 * @example
 * ```ts
 * buildTurns(pathNodes).map((t) => applyTurnDefinition(t, TURN_PRESETS.studyNotes));
 * ```
 */
export function applyTurnDefinition(turn: Turn, def: TurnDefinition): Turn {
  const keepNode = (n: Node): Node | undefined => {
    if (n.hidden && !def.hidden) return undefined;
    if (n.role === 'user' && !def.questions) return undefined;
    if (n.role === 'tool' && !def.tools) return undefined;
    // With answers off, an assistant node can still contribute its reasoning, citations, images, tool runs.
    const dropProse = !def.answers && (n.role === 'assistant' || n.role === 'system');
    const blocks = n.blocks.filter((b) => keepBlock(b, def) && !(dropProse && isProse(b)));
    return blocks.length ? { ...n, blocks } : undefined;
  };
  const question = turn.question && keepNode(turn.question);
  const responses = turn.responses.map(keepNode).filter((n): n is Node => n !== undefined);
  return { index: turn.index, question, responses };
}

function isProse(b: Block): boolean {
  return b.kind === 'markdown' || b.kind === 'unknown' || b.kind === 'canvas' || b.kind === 'widget' || (b.kind === 'code' && b.origin === 'fence');
}

function keepBlock(b: Block, def: TurnDefinition): boolean {
  switch (b.kind) {
    case 'markdown':
    case 'canvas':
    case 'widget':
    case 'unknown':
      return true;
    case 'code':
      return b.origin === 'fence' || def.tools;
    case 'toolOutput':
      return def.tools;
    case 'reasoning':
      return def.reasoning;
    case 'citation':
      return def.citations;
    case 'image':
      return def.images;
    case 'attachment':
      return def.attachments;
  }
}
