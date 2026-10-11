import { describe, expect, it } from 'vitest';
import { INTERACTIVE_NOTE, convertLayoutMarkup } from '../src/markup.ts';

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
    expect(convertLayoutMarkup(text)).toEqual({ markdown: text, pieces: [{ markdown: text }], unresolvedImages: 0, unreadableWidgets: 0 });
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

  it('uses what the resolver found for images, links and citations, by tag position', () => {
    const asked: string[] = [];
    const r = convertLayoutMarkup(IDEAS, {
      image: (at) => {
        asked.push(`image ${at.ordinal} @${IDEAS.slice(at.offset, at.offset + 11)}`);
        return at.ordinal === 1 ? { url: 'https://images.example/osso.jpg', source: { title: 'Osso buco', url: 'https://recipes.example/osso' } } : undefined;
      },
      link: (at) => (at.ordinal === 0 ? { url: 'https://recipes.example/osso', title: 'Osso buco recipe' } : undefined),
      cite: () => [{ url: 'https://a.example/1', title: 'La Cucina [Italiana]' }, { url: 'https://b.example/2' }],
    });
    expect(asked).toEqual(['image 0 @<AsyncImage', 'image 1 @<AsyncImage']);
    expect(r.markdown).toContain('**Γιατί το προτείνω:** απορροφά τη νοστιμιά. ([La Cucina \\[Italiana\\]](https://a.example/1), [https://b.example/2](https://b.example/2))');
    expect(r.markdown).toContain('**2. Οσομπούκο**\n\n![Osso buco](https://images.example/osso.jpg)\n\nΔες [τη συνταγή](https://recipes.example/osso) και');
    expect(r.unresolvedImages).toBe(1);
    expect(r.pieces.map((p) => ('image' in p ? p.image.url : p.markdown.slice(-12)))).toEqual([
      expect.stringContaining('Οσομπούκο**'),
      'https://images.example/osso.jpg',
      expect.stringContaining('Καλή όρεξη!'),
    ]);
  });

  it('a self-closing Link uses its title; a Link to an unknown expression asks the resolver', () => {
    const text = '<box>Δες <Link url="https://www.ricardocuisine.com/en/braising" title="RICARDO — Braising"/> και <Link url={turn1search9.url.uri}/>.</box>';
    expect(convertLayoutMarkup(text, { link: (at) => (at.ordinal === 1 ? { url: 'https://x.example/', title: 'X' } : undefined) }).markdown).toBe(
      'Δες [RICARDO — Braising](https://www.ricardocuisine.com/en/braising) και [X](https://x.example/).',
    );
  });

  it('leaves citation markers alone, even with tags inside them', () => {
    const marker = '\ue200genui\ue202{"app_block":{"content":"<button>Run</button> <box>"}}\ue201';
    expect(convertLayoutMarkup(`<box>Widget: ${marker}</box>`).markdown).toBe(`Widget: ${marker}`);
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

  it('never leaves layout indentation that Markdown would read as code', () => {
    const text = '<box gap={3}>\n  <row>\n    <box flex="1" gap={1}>\n      **1. Πλιγούρι**\n\n      <badge color="success">Η πρώτη μου επιλογή</badge>\n\n      Το πλιγούρι απορροφά τη σάλτσα.\n    </box>\n  </row>\n</box>';
    const md = convertLayoutMarkup(text).markdown;
    expect(md).toBe('**1. Πλιγούρι**\n\n **Η πρώτη μου επιλογή**\n\nΤο πλιγούρι απορροφά τη σάλτσα.');
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
