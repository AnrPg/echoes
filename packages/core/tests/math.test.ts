import { describe, expect, it } from 'vitest';
import { convertMath } from '@echoes/core';

const cases: [string, string, string][] = [
  ['inline \\( \\)', 'Area \\(\\pi r^2\\) here', 'Area $\\pi r^2$ here'],
  ['inline math is trimmed so $ x $ never appears', 'see \\( x+1 \\)', 'see $x+1$'],
  ['display \\[ \\] on its own lines keeps its layout', 'Then\n\\[\nE = mc^2\n\\]\ndone', 'Then\n$$\nE = mc^2\n$$\ndone'],
  ['display inside a line', 'so \\[a=b\\] holds', 'so $$a=b$$ holds'],
  ['existing $…$ math is kept', 'we have $x^2$ and $$y$$', 'we have $x^2$ and $$y$$'],
  ['a price is escaped', 'It costs $5.', 'It costs \\$5.'],
  ['two prices are not paired into math', 'from $5 to $10', 'from \\$5 to \\$10'],
  ['closing $ followed by a digit is not math', '$20,000 and $30,000', '\\$20,000 and \\$30,000'],
  ['$ followed by a space is not math', 'pay $ 5 or $ 6', 'pay \\$ 5 or \\$ 6'],
  ['already escaped \\$ stays', 'only \\$5', 'only \\$5'],
  ['inline math does not cross a blank line', '$a\n\nb$', '\\$a\n\nb\\$'],
  ['unclosed \\( is left alone', 'a \\( b', 'a \\( b'],
  ['other escapes are copied', '\\*not italic\\* \\\\(x)', '\\*not italic\\* \\\\(x)'],
  ['inline code is untouched', 'run `echo $HOME \\(x\\)` now $5', 'run `echo $HOME \\(x\\)` now \\$5'],
  ['double-backtick code with a backtick inside', '``a ` $b``', '``a ` $b``'],
  ['unmatched backtick is literal and scanning goes on', 'a ` b $5', 'a ` b \\$5'],
  ['link destinations are untouched', '[price](https://x.example/$5?q=\\(1\\)) $5', '[price](https://x.example/$5?q=\\(1\\)) \\$5'],
  ['unclosed $$ is escaped', 'a $$ b', 'a \\$\\$ b'],
  ['Greek and other scripts pass through', 'Η μάζα \\(m\\) κοστίζει $3', 'Η μάζα $m$ κοστίζει \\$3'],
];

describe('convertMath', () => {
  for (const [name, input, expected] of cases) it(name, () => expect(convertMath(input)).toBe(expected));

  it('leaves fenced code blocks untouched, including ~~~ and longer fences', () => {
    const input = ['before \\(a\\)', '```bash', 'echo $5 \\(x\\)', '```', '~~~~', 'still $code', '```', 'not closed by a shorter or other fence', '~~~~', 'after $5'].join('\n');
    const expected = ['before $a$', '```bash', 'echo $5 \\(x\\)', '```', '~~~~', 'still $code', '```', 'not closed by a shorter or other fence', '~~~~', 'after \\$5'].join('\n');
    expect(convertMath(input)).toBe(expected);
  });

  it('handles fences indented inside list items', () => {
    const input = '1. Step \\(x\\)\n\n    ```python\n    cost = "$5"\n    ```\n2. Done $5';
    expect(convertMath(input)).toBe('1. Step $x$\n\n    ```python\n    cost = "$5"\n    ```\n2. Done \\$5');
  });

  it('an unclosed fence protects the rest of the text', () => {
    expect(convertMath('```\n$5 \\(x\\)')).toBe('```\n$5 \\(x\\)');
  });

  it('a backtick line with backticks in its info string is not a fence', () => {
    expect(convertMath('```a`b $5')).toBe('```a`b \\$5');
  });

  it('is idempotent on its own output', () => {
    const once = convertMath('Area \\(\\pi r^2\\) costs $5, `$x`, $$y$$');
    expect(convertMath(once)).toBe(once);
  });
});
