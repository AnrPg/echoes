import { describe, expect, it } from 'vitest';
import { ID_KEY, MAX_VALUES, mergeShapes, shapeOf } from '../../src/inspect/shape';
import { renderShape } from '../../src/inspect/render';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

describe('shapeOf / mergeShapes', () => {
  it('collapses id-keyed maps into one <id> entry', () => {
    const s = shapeOf({ nodes: { [U1]: { role: 'user' }, [U2]: { role: 'assistant', extra: 1 } } });
    const nodes = s.obj!.keys.nodes!.shape.obj!;
    expect(Object.keys(nodes.keys)).toEqual([ID_KEY]);
    const node = nodes.keys[ID_KEY]!.shape;
    expect(node.str).toBeUndefined();
    expect(node.obj!.keys.role!.shape.str!.values).toEqual(['assistant', 'user']);
  });

  it('marks keys optional across observations', () => {
    const s = mergeShapes(shapeOf({ a: 1, b: 'x' }), shapeOf({ a: 2 }));
    expect(s.obj!.n).toBe(2);
    expect(s.obj!.keys.a!.present).toBe(2);
    expect(s.obj!.keys.b!.present).toBe(1);
    expect(renderShape(s)).toContain('b?: "x"  // 1/2');
  });

  it('never keeps user text, even when it looks like a token', () => {
    const s = shapeOf({ content: { parts: ['yes', 'My secret plan'] }, title: 'hello' });
    const text = JSON.stringify(s);
    expect(text).not.toContain('yes');
    expect(text).not.toContain('secret');
    expect(text).not.toContain('hello');
  });

  it('records unions of kinds and numeric ranges', () => {
    const s = mergeShapes(mergeShapes(shapeOf(1), shapeOf(2.5)), shapeOf(null));
    expect(s.kinds).toEqual(['null', 'num']);
    expect(s.num).toEqual({ int: false, min: 1, max: 2.5 });
  });

  it('caps the literal list and flags overflow', () => {
    let s = shapeOf('t0');
    for (let i = 1; i < MAX_VALUES + 5; i++) s = mergeShapes(s, shapeOf(`t${i}`));
    expect(s.str!.values.length).toBe(MAX_VALUES);
    expect(s.str!.more).toBe(true);
  });

  it('is JSON round-trippable (it is stored in chrome.storage)', () => {
    const s = shapeOf({ a: [1, 'x', { b: null }], c: true });
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe('renderShape', () => {
  it('renders a readable TS-like form', () => {
    const s = shapeOf({ id: U1, items: [{ kind: 'code' }, { kind: 'text' }], n: 3 });
    expect(renderShape(s)).toBe(
      [
        '{',
        '  id: string<uuid>',
        '  items: Array<{',
        '    kind: "code" | "text"',
        '  }>(max 2)',
        '  n: int[3..3]',
        '}',
      ].join('\n'),
    );
  });
});
