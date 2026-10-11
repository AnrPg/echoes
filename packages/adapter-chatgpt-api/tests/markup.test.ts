import { describe, expect, it } from 'vitest';
import type { WidgetNode } from '@echoes/core';
import { INTERACTIVE_NOTE, convertLayoutMarkup, splitLayoutMarkup, type LayoutSegment } from '../src/markup.ts';

// Snippets shaped like a real answer exported on 2026-10-11 (text shortened; the raw JSON has not been captured).

const IDEAS = `Πέντε ιδέες για το δείπνο σας

<box gap={4}>
  <box gap={2}>
    <row align="center" justify="between">
      <title size="lg">1. Πλιγουρότο με μοσχάρι</title>
      <badge color="success">Η αγαπημένη μου</badge>
    </row>
    <AsyncImage query="elegant bulgur pilaf with veal" aspectRatio="16:9" maxHeight={220}/>
    <text color="secondary" size="xs">Αρωματικό · Ζουμερό</text>

    Θα έφτιαχνα ένα πλιγούρι σχεδόν σαν ριζότο, με **τον ζωμό**.

    - Σιγομαγειρεύεις το ποντίκι.
      - με δάφνη
    - Ξεψαχνίζεις το κρέας.

    **Γιατί το προτείνω:** απορροφά τη νοστιμιά.<Cite refs={["turn135897search4","turn135897search7"]}/>
  </box>
  <divider color="subtle"/>
  <box gap={2}>
    <title size="lg">2. Οσομπούκο</title>
    <AsyncImage ref="turn813304image1" aspectRatio="16:9"/>
    Δες <Link url={turn202216search9.url.uri}>τη συνταγή</Link> και <Entity category="food" value="Vitello tonnato"/>.
    <icon name="users" color="secondary"/>
  </box>
</box>

Καλή όρεξη!`;

describe('convertLayoutMarkup', () => {
  it('leaves text without the markup untouched', () => {
    const text = 'Plain **answer**\n\n    indented code\n\n- a\n\n- b\n\nA {x} and <text>prose</text>.';
    expect(convertLayoutMarkup(text)).toEqual({ markdown: text, unresolvedImages: 0, unreadableWidgets: 0 });
  });

  it('turns cards into paragraphs, titles, badges, notes and a thematic break', () => {
    const r = convertLayoutMarkup(IDEAS);
    expect(r.markdown).toBe(
      [
        'Πέντε ιδέες για το δείπνο σας',
        '**1. Πλιγουρότο με μοσχάρι**',
        '**Η αγαπημένη μου**',
        '*[Image: elegant bulgur pilaf with veal]*',
        'Αρωματικό · Ζουμερό',
        'Θα έφτιαχνα ένα πλιγούρι σχεδόν σαν ριζότο, με **τον ζωμό**.',
        '- Σιγομαγειρεύεις το ποντίκι.\n  - με δάφνη\n- Ξεψαχνίζεις το κρέας.',
        '**Γιατί το προτείνω:** απορροφά τη νοστιμιά.',
        '---',
        '**2. Οσομπούκο**',
        '*[Image]*',
        'Δες τη συνταγή και Vitello tonnato.',
        'Καλή όρεξη!',
      ].join('\n\n'),
    );
    expect(r.unresolvedImages).toBe(2);
    expect(r.markdown).not.toMatch(/<|turn\d/);
  });

  it('uses image and link URLs when the caller can resolve them', () => {
    const r = convertLayoutMarkup(IDEAS, {
      imageRef: (ref) => (ref === 'turn813304image1' ? 'https://img.example/osso.jpg' : undefined),
      urlExpr: (e) => (e === 'turn202216search9.url.uri' ? 'https://recipes.example/osso' : undefined),
    });
    expect(r.markdown).toContain('![](https://img.example/osso.jpg)');
    expect(r.markdown).toContain('Δες [τη συνταγή](https://recipes.example/osso) και');
    expect(r.unresolvedImages).toBe(1);
  });

  it('expands a checklist widget from its data, without the live counter or buttons', () => {
    const text = `1. Υλικά

{@body const ingredients = [ {group:"Κυρίως",items:["3 φέτες ποντίκι","1 κυδώνι"]},
{group:"Ρύζι",items:["120 γρ. μπασμάτι"]}]} {@body
const [checked,setChecked] = DIL.useState([])} <box border radius="xl" padding=
{3} gap={3}> <row justify="between" align="center"> Λίστα αγορών
<text color="secondary" size="xs" tabularNums>
{checked.length}/{ingredients.reduce((n,g)=>n+g.items.length,0)}</text>
</row> {#each ingredients as group, gi} <box gap={2} key={gi}> <text
weight="medium" color="default">{group.group}</text> {#each group.items as
item, i} <checkbox key={\`\${gi}-\${i}\`} checked={checked.includes(\`\${gi}-\${i}\`)}
onChange={v=>setChecked(old=>v?[...old,\`\${gi}-\${i}\`]:old.filter(x=>x!==\`\${gi}-\${i}\`))}>{item}</checkbox>
{/each} </box> {/each} <row justify="end"> <button size="sm"
variant="outline" color="secondary" onClick={()=>setChecked([])}>Καθαρισμός
επιλογών</button> </row> </box>

2. Μοσχαράκι`;
    const r = convertLayoutMarkup(text);
    expect(r.markdown).toBe(
      '1. Υλικά\n\nΛίστα αγορών\n\nΚυρίως\n\n- [ ] 3 φέτες ποντίκι\n- [ ] 1 κυδώνι\n\nΡύζι\n\n- [ ] 120 γρ. μπασμάτι\n\n2. Μοσχαράκι',
    );
    expect(r.unreadableWidgets).toBe(0);
  });

  it('repeats over an inline list', () => {
    const text = `<box border> {#each [{t:"3½ ώρες πριν",d:"Ρόδισε το μοσχάρι."},{t:"Ώρα σερβιρίσματος",d:"Σέρβιρε."}] as step,i} <row key={i}> <box width="108px"> <text weight="medium">{step.t}</text> </box> <box flex="1"> <text size="sm">{step.d}</text> </box> </row> {/each} </box>`;
    expect(convertLayoutMarkup(text).markdown).toBe('3½ ώρες πριν\n\nΡόδισε το μοσχάρι.\n\nΏρα σερβιρίσματος\n\nΣέρβιρε.');
  });

  it('shows radio options and the initially selected option, reading Number() and String()', () => {
    const text = `{@body const blends=[{name:"Ήπιο",items:[{name:"Σπανάκι",g:150}]},{name:"Έντονο",items:[{name:"Ραδίκι",g:100}]}]} {@body const [blend,setBlend] =
DIL.useState("0")} <box border> <radio-group direction="col" value={blend} onChange={setBlend}> {#each blends as b,i}
<radio value={String(i)}>{b.name}</radio> {/each} </radio-group> <divider color="subtle"/> <box gap={2}> {#each blends[Number(blend)].items as item}
<row key={item.name}> <text size="sm">{item.name}</text> <box width={\`\${item.g/300*100}%\`}/> <text size="xs">{item.g} γρ.</text> </row> {/each} </box> </box>`;
    expect(convertLayoutMarkup(text).markdown).toBe('- Ήπιο\n- Έντονο\n\n---\n\nΣπανάκι 150 γρ.');
  });

  it('says so when a widget list cannot be read', () => {
    const text = `{@body const items = makeItems()} <box> {#each items as it} <checkbox>{it}</checkbox> {/each} </box>`;
    const r = convertLayoutMarkup(text);
    expect(r.markdown).toBe(INTERACTIVE_NOTE);
    expect(r.unreadableWidgets).toBe(1);
  });

  it('never touches code, inline code or math', () => {
    const text = [
      '<box>',
      'Το `<row>` είναι tag και $x^{2}$ ή \\(\\frac{a}{b}\\) μένουν.',
      '</box>',
      '',
      '```jsx',
      '<box>',
      '  {#each items as item}',
      '</box>',
      '```',
      '',
      '$$',
      '\\sum_{i} {x}',
      '$$',
    ].join('\n');
    expect(convertLayoutMarkup(text).markdown).toBe(
      'Το `<row>` είναι tag και $x^{2}$ ή \\(\\frac{a}{b}\\) μένουν.\n\n```jsx\n<box>\n  {#each items as item}\n</box>\n```\n\n$$\n\\sum_{i} {x}\n$$',
    );
  });
});

describe('splitLayoutMarkup', () => {
  const CHECKLIST = `1. Υλικά

{@body const ingredients = [ {group:"Κυρίως",items:["3 φέτες ποντίκι","1 κυδώνι"]},
{group:"Ρύζι",items:["120 γρ. μπασμάτι"]}]} {@body
const [checked,setChecked] = DIL.useState([])} <box border radius="xl" padding=
{3} gap={3}> <row justify="between" align="center"> Λίστα αγορών
<text color="secondary" size="xs" tabularNums>
{checked.length}/{ingredients.reduce((n,g)=>n+g.items.length,0)}</text>
</row> {#each ingredients as group, gi} <box gap={2} key={gi}> <text
weight="medium" color="default">{group.group}</text> {#each group.items as
item, i} <checkbox key={\`\${gi}-\${i}\`} checked={checked.includes(\`\${gi}-\${i}\`)}
onChange={v=>setChecked(old=>v?[...old,\`\${gi}-\${i}\`]:old.filter(x=>x!==\`\${gi}-\${i}\`))}>{item}</checkbox>
{/each} </box> {/each} <row justify="end"> <button size="sm"
variant="outline" color="secondary" onClick={()=>setChecked([])}>Καθαρισμός
επιλογών</button> </row> </box>

2. Μοσχαράκι`;

  const CHOICE = `Ποιον συνδυασμό;

{@body const mixes=[{name:"Ήπιο, ιταλικό",desc:"Αναδεικνύει την ντομάτα.",herbs:"Θυμάρι και δάφνη."},{name:"Ελληνικό",desc:"Πιο οικείο.",herbs:"Δάφνη και σέλινο."}]} {@body const [choice,setChoice]=DIL.useState("1")} <box border
radius="xl" padding={3} gap={3}> <radio-group direction="col" value={choice}
onChange={setChoice}> {#each mixes as mix,i} <radio value={String(i)}> <box
gap="2px"> {mix.name} <text color="secondary" size="sm">{mix.desc}</text>
</box> </radio> {/each} </radio-group> <divider color="subtle"/> <text
weight="medium" size="sm">Τα μυρωδικά:</text>
{mixes[Number(choice)].herbs} </box>

Θα διάλεγα τον πρώτο.`;

  it('splits a checklist widget out with its exact code, a counter and a reset button', () => {
    const r = splitLayoutMarkup(CHECKLIST);
    expect(r.segments.map((s) => s.kind)).toEqual(['markdown', 'widget', 'markdown']);
    expect(r.segments[0]).toEqual({ kind: 'markdown', text: '1. Υλικά' });
    expect(r.segments[2]).toEqual({ kind: 'markdown', text: '2. Μοσχαράκι' });
    const w = r.segments[1] as Extract<LayoutSegment, { kind: 'widget' }>;
    expect(w.source).toBe(CHECKLIST.slice(CHECKLIST.indexOf('{@body'), CHECKLIST.lastIndexOf('</box>') + 6));
    const items = (title: string, ...labels: string[]): WidgetNode => ({
      type: 'group',
      direction: 'column',
      children: [{ type: 'markdown', text: title }, ...labels.map((label): WidgetNode => ({ type: 'checkbox', label, checked: false }))],
    });
    expect(w.view).toEqual([
      {
        type: 'group',
        direction: 'column',
        children: [
          { type: 'group', direction: 'row', children: [{ type: 'markdown', text: 'Λίστα αγορών' }, { type: 'counter' }] },
          items('Κυρίως', '3 φέτες ποντίκι', '1 κυδώνι'),
          items('Ρύζι', '120 γρ. μπασμάτι'),
          { type: 'group', direction: 'row', children: [{ type: 'reset', label: 'Καθαρισμός επιλογών' }] },
        ],
      },
    ]);
    expect(r.unreadableWidgets).toBe(0);
  });

  it('reads a choice and gives every option its own case of the content that depends on it', () => {
    const r = splitLayoutMarkup(CHOICE);
    const w = r.segments[1] as Extract<LayoutSegment, { kind: 'widget' }>;
    expect(w.view).toEqual([
      {
        type: 'group',
        direction: 'column',
        children: [
          {
            type: 'choice',
            id: 'choice',
            options: [{ label: 'Ήπιο, ιταλικό\n\nΑναδεικνύει την ντομάτα.' }, { label: 'Ελληνικό\n\nΠιο οικείο.' }],
            selected: 1,
          },
          { type: 'markdown', text: '---\n\nΤα μυρωδικά:' },
          { type: 'switch', choice: 'choice', cases: [[{ type: 'markdown', text: 'Θυμάρι και δάφνη.' }], [{ type: 'markdown', text: 'Δάφνη και σέλινο.' }]] },
        ],
      },
    ]);
    expect(r.segments[2]).toEqual({ kind: 'markdown', text: 'Θα διάλεγα τον πρώτο.' });
  });

  it('keeps static markup as Markdown and drops buttons that do more than reset', () => {
    const text = `<box> {#each ["α","β"] as x} <text>{x}</text> {/each} </box>\n\n{@body const [n,setN] = DIL.useState(0)} <box> <checkbox checked>Έτοιμο</checkbox> <button onClick={()=>setN(n+1)}>Πάλι</button> </box>`;
    const r = splitLayoutMarkup(text);
    expect(r.segments[0]).toEqual({ kind: 'markdown', text: 'α β' });
    expect(r.segments[1]).toMatchObject({ kind: 'widget', view: [{ type: 'checkbox', label: 'Έτοιμο', checked: true }] });
  });

  it('leaves text without the markup as one Markdown segment', () => {
    expect(splitLayoutMarkup('Plain {x}').segments).toEqual([{ kind: 'markdown', text: 'Plain {x}' }]);
    expect(splitLayoutMarkup('').segments).toEqual([]);
  });

  it('never reads widgets inside code', () => {
    const text = '```jsx\n<box><checkbox>a</checkbox></box>\n```';
    expect(splitLayoutMarkup(text).segments).toEqual([{ kind: 'markdown', text }]);
  });
});
