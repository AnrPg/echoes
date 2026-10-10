import { describe, expect, it } from 'vitest';
import {
  TURN_PRESETS, activePath, applyTurnDefinition, buildTurns, nodesOf, parseConversation, type TurnDefinition,
} from '@echoes/core';
import { sampleJson } from './helpers.ts';

const c = parseConversation(sampleJson());
const turns = buildTurns(nodesOf(c, activePath(c)));
const kinds = (t: ReturnType<typeof applyTurnDefinition>) => ({
  q: t.question?.blocks.map((b) => b.kind) ?? null,
  r: t.responses.map((n) => `${n.id}:${n.blocks.map((b) => b.kind).join('+')}`),
});

describe('buildTurns', () => {
  it('groups a question with the responses until the next question; leading context is turn 0', () => {
    expect(turns.map((t) => [t.index, t.question?.id ?? null, t.responses.map((n) => n.id)])).toEqual([
      [0, null, ['root', 'sys']],
      [1, 'u1', ['a1']],
      [2, 'u2b', ['a2b2']],
    ]);
  });

  it('omits turn 0 when the path starts with a question', () => {
    expect(buildTurns(nodesOf(c, ['u1', 'a1'])).map((t) => t.index)).toEqual([1]);
  });
});

describe('applyTurnDefinition', () => {
  it('full archive keeps everything except hidden context', () => {
    const out = turns.map((t) => applyTurnDefinition(t, TURN_PRESETS.fullArchive));
    expect(out[0]!.responses).toEqual([]);
    expect(kinds(out[1]!)).toEqual({ q: ['markdown'], r: ['a1:reasoning+markdown'] });
    expect(kinds(out[2]!)).toEqual({ q: ['markdown'], r: ['a2b2:code+toolOutput+markdown+citation+unknown'] });
  });

  it('hidden: true shows context nodes', () => {
    const out = applyTurnDefinition(turns[0]!, { ...TURN_PRESETS.fullArchive, hidden: true });
    expect(out.responses.map((n) => n.id)).toEqual(['sys']); // root has no blocks, so it is dropped
  });

  it('answers only drops the question and tool runs but keeps unknown content', () => {
    const out = applyTurnDefinition(turns[2]!, TURN_PRESETS.answersOnly);
    expect(kinds(out)).toEqual({ q: null, r: ['a2b2:markdown+unknown'] });
  });

  it('answers off still yields wanted extras from answer nodes', () => {
    const def: TurnDefinition = { ...TURN_PRESETS.fullArchive, answers: false };
    expect(kinds(applyTurnDefinition(turns[1]!, def)).r).toEqual(['a1:reasoning']);
    expect(kinds(applyTurnDefinition(turns[2]!, def)).r).toEqual(['a2b2:code+toolOutput+citation']);
  });

  it('does not mutate its input', () => {
    const before = JSON.stringify(turns);
    turns.forEach((t) => applyTurnDefinition(t, TURN_PRESETS.answersOnly));
    expect(JSON.stringify(turns)).toBe(before);
  });
});
