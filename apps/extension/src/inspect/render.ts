import type { Shape } from './shape';

/** Renders a Shape as readable TypeScript-like text for the Phase 0 report. */
export function renderShape(s: Shape, indent = 0): string {
  const pad = '  '.repeat(indent);
  const parts: string[] = [];
  for (const k of s.kinds) {
    switch (k) {
      case 'null': parts.push('null'); break;
      case 'bool': parts.push('boolean'); break;
      case 'other': parts.push('unknown'); break;
      case 'num': {
        const r = s.num;
        parts.push(r ? `${r.int ? 'int' : 'number'}[${r.min}..${r.max}]` : 'number');
        break;
      }
      case 'str': {
        const st = s.str;
        if (!st) { parts.push('string'); break; }
        const lits = st.values.map((v) => JSON.stringify(v));
        if (st.more) lits.push('"…"');
        const other = st.classes.filter((c) => c !== 'token' || st.values.length === 0);
        if (other.length) lits.push(`string<${other.join('|')}>`);
        parts.push(...lits);
        break;
      }
      case 'arr': {
        const items = s.arr?.items;
        const inner = items ? renderShape(items, indent) : 'never';
        parts.push(`Array<${inner}>(max ${s.arr?.maxLen ?? 0})`);
        break;
      }
      case 'obj': {
        const o = s.obj;
        if (!o || Object.keys(o.keys).length === 0) { parts.push('{}'); break; }
        const lines = Object.keys(o.keys).sort().map((key) => {
          const e = o.keys[key]!;
          const optional = e.present < o.n ? `?` : '';
          const freq = e.present < o.n ? `  // ${e.present}/${o.n}` : '';
          return `${pad}  ${key}${optional}: ${renderShape(e.shape, indent + 1)}${freq}`;
        });
        if (o.truncated) lines.push(`${pad}  … more keys truncated`);
        parts.push(`{\n${lines.join('\n')}\n${pad}}`);
        break;
      }
    }
  }
  return parts.join(' | ');
}
