// What every field and option on the export page means, in plain words. Each entry feeds both the hover tooltip
// (`tip`) and the info box (`intro`, the options and `more`), so the two never disagree. Checked against the
// renderers in @echoes/core and the export runner; keep them in step when behaviour changes.

export interface HelpOption {
  name: string;
  /** One line: the option's tooltip and its line in the info box. */
  text: string;
}

export interface HelpEntry {
  title: string;
  /** The hover tooltip of the field's label: one short sentence. */
  tip: string;
  /** The info box's opening paragraph. */
  intro: string;
  options?: HelpOption[];
  /** Extra paragraphs: tips, pitfalls. */
  more?: string[];
}

export const HELP = {
  scope: {
    title: 'What to export',
    tip: 'Choose one chat, some of its turns, or many chats at once.',
    intro: 'Start here: tell Echoes how much to save. The other steps are the same whichever you pick.',
    options: [
      { name: 'This chat', text: 'The whole chat that is open in your ChatGPT tab. Opening another chat there switches to it.' },
      { name: 'Some turns', text: 'Only the turns you pick from the open chat: tick them by hand, search, or use rules. A turn is one question and its answer.' },
      { name: 'Many chats', text: 'Several chats in one go: everything in your account, or one Project. Saved into a folder you choose.' },
    ],
  },
  format: {
    title: 'Format',
    tip: 'The kind of file Echoes saves.',
    intro: 'Which kind of file you get. Every format keeps the same content; they differ in where you can open it and what it looks like.',
    options: [
      { name: 'Markdown', text: 'A plain-text file (.md) with light formatting marks. Opens in any text editor and in notes apps like Obsidian, Notion or GitHub. Best for notes and long-term archives.' },
      { name: 'HTML', text: 'A web page (.html) that opens in any browser, looking much like ChatGPT: math, coloured code, working widgets, Copy buttons and foldable turns.' },
      { name: 'PDF', text: 'A printable document. Echoes opens your browser\'s print window: set Destination to "Save as PDF", press Save and pick a folder; the PDF goes there. Many chats: one PDF each (a print window per chat), or all in one file (one print window).' },
      { name: 'Echoes JSON', text: 'Everything Echoes knows about the chat, as structured data for programs and scripts. Always holds the whole chat, every version included.' },
      { name: 'Resources only', text: 'No chat text: just the files, code, canvases and links from the chat, sorted into one folder per turn.' },
    ],
  },
  layout: {
    title: 'Files',
    tip: 'Save each chat as its own file, or all of them together in one file.',
    intro: 'With many chats, choose whether each chat gets its own file or they all go into one file, one after the other.',
    options: [
      { name: 'One file per chat', text: 'A file for every chat, named after it. Easy to find one chat later; a second export only rewrites the chats that changed. With PDF, the print window opens once per chat.' },
      { name: 'All in one file', text: 'One document with a table of contents and a section per chat, in the order you set below. Good for reading a whole Project start to finish, sharing it, or printing it as one PDF.' },
    ],
    more: [
      'In one file, every chat keeps its own title, dates and link to ChatGPT, and its pictures go in a folder per chat next to the file.',
      'Exporting again into the same folder rebuilds the file only when a chat changed or you changed the order. Echoes keeps a copy of each chat in a hidden ".echoes-parts" folder for that; leave it there.',
      'Resources only is always one folder per chat.',
    ],
  },
  pdfEach: {
    title: 'One PDF per chat',
    tip: 'Chrome\'s print window opens once for every chat; press Save in each.',
    intro: 'Chrome lets an extension make a PDF only through its print window (or with a permission Chrome asks for at install, with a strong warning, which Echoes does not use). So with PDF and "One file per chat", Echoes opens the print window once for each chat, one after the other.',
    more: [
      'In each window, set Destination to "Save as PDF" (Chrome remembers it after the first time) and press Save. The file is named after the chat, and Chrome saves it where you choose (usually Downloads).',
      'Cancel skips that chat and goes on to the next. "Stop after this chat" next to the button ends the run.',
      'For many chats, "All in one file" is quicker: one print window, one PDF with a table of contents.',
    ],
  },
  mergeOrder: {
    title: 'Order in the file',
    tip: 'Drag the chats into the order they should appear in the file.',
    intro: 'The ticked chats, in the order the file will show them. Drag a chat (by its handle ⠿ or its name) and drop it where the line shows. Without a mouse: focus the handle and press the up or down arrow, or Home and End to jump to the top or bottom. The ↑ and ↓ buttons move a chat one place; ⤒ and ⤓ send it to the top or the bottom.',
    more: ['Chats you tick later go to the end. "Reset order" puts them back in the order of the list.'],
  },
  mergeTitle: {
    title: 'File title',
    tip: 'The title at the top of the file, also used as its name.',
    intro: 'The heading of the whole document and its file name. It starts as the Project\'s name when all ticked chats are in one Project.',
  },
  flavor: {
    title: 'Markdown style',
    tip: 'Which app the Markdown is tuned for. The text is the same; math and folding boxes differ.',
    intro: 'Markdown comes in dialects. The words are identical in all three; what changes is how math, the reasoning summary and notes are written so that your app shows them properly.',
    options: [
      { name: 'GitHub', text: 'For GitHub, GitLab, VS Code and most viewers. Math as $x$ and $$…$$, the reasoning summary as a click-to-open box, chat details at the top (front matter).' },
      { name: 'Obsidian', text: 'For Obsidian. Math as $x$ and $$…$$, the reasoning summary and warnings as Obsidian callouts (folding boxes), chat details at the top.' },
      { name: 'CommonMark', text: 'The plain standard, for any tool. Math as $x$ and $$…$$, the reasoning summary and notes as simple quotes, no details block at the top.' },
    ],
    more: ['Not sure? Pick GitHub; it reads well almost everywhere.'],
  },
  colours: {
    title: 'Colours',
    tip: 'Light or dark pages, or follow the reader\'s system setting.',
    intro: 'The colour palette of HTML and PDF files. Every colour (text, code, the tinted boxes for reasoning, tools and sources) is tuned for light and for dark.',
    options: [
      { name: 'Follow system', text: 'The page is light or dark depending on the reader\'s computer setting. Prints light.' },
      { name: 'Light', text: 'Always light: dark text on white.' },
      { name: 'Dark', text: 'Always dark: light text on a dark background. PDFs print dark too.' },
    ],
    more: ['Readers can still switch light or dark with the button at the top of an HTML file.'],
  },
  look: {
    title: 'Look',
    tip: 'The page design of HTML and PDF files.',
    intro: 'The layout and typography of HTML and PDF files. The content is the same in every look.',
    options: [
      { name: 'Like ChatGPT', text: 'Your questions in bubbles on the right, answers below, as in the ChatGPT app.' },
      { name: 'Article', text: 'A calm, book-like page with a serif font: good for reading long answers.' },
      { name: 'Compact notes', text: 'Small text and tight spacing: more fits on a page. Good for study notes and printing many turns.' },
      { name: 'Print-friendly', text: 'Black on white, no backgrounds, web addresses written out after each link. Saves ink.' },
    ],
  },
  parts: {
    title: 'Parts of each turn',
    tip: 'Which pieces of each question-and-answer go into the file.',
    intro: 'A turn is one question and everything that answers it. Tick the parts you want; the rest is left out. Presets tick a useful set in one click, and you can save your own.',
    options: [
      { name: 'Questions', text: 'What you asked.' },
      { name: 'Answers', text: 'What ChatGPT replied.' },
      { name: 'Reasoning summaries', text: 'The short "thinking" summaries ChatGPT shows above some answers. Never the raw chain of thought, which ChatGPT does not share.' },
      { name: 'Tool calls and outputs', text: 'Code ChatGPT ran (for example Python for a chart) and what it printed.' },
      { name: 'Citations', text: 'The sources ChatGPT linked when it searched the web.' },
      { name: 'Pictures', text: 'Images you uploaded and images ChatGPT made or found.' },
      { name: 'Attachments', text: 'Other files you uploaded, like PDFs or spreadsheets.' },
      { name: 'Hidden context', text: 'Things the chat used but ChatGPT does not show: memory, custom instructions, system notes. Off by default.' },
    ],
  },
  presets: {
    title: 'Presets',
    tip: 'Ready-made sets of parts. Click one to tick its parts; you can still change them.',
    intro: 'A preset ticks a set of parts in one click. After that you can tick or untick parts freely.',
    options: [
      { name: 'Full archive', text: 'Everything except hidden context: a complete record.' },
      { name: 'Answers only', text: 'Just the answers and their pictures: the result without the conversation.' },
      { name: 'Study notes', text: 'Questions, answers, citations and pictures: clean notes without the machinery.' },
      { name: 'Save as preset', text: 'Keep the parts you ticked now under a name of your own. Your presets appear next to the built-in ones; × deletes one.' },
    ],
  },
  versions: {
    title: 'Versions',
    tip: 'Edited questions and regenerated answers create other versions of a chat.',
    intro: 'When you edit a question or press "Regenerate" in ChatGPT, the chat splits: the old version is kept, and ChatGPT shows you one of them with "< 2/2 >" arrows. Each version continues on its own.',
    options: [
      { name: 'Only the one shown', text: 'Save the chat as ChatGPT shows it right now. The other versions are left out.' },
      { name: 'All versions', text: 'Save every version, each with what followed it. Turns all versions share are written once.' },
    ],
  },
  branchOutput: {
    title: 'Other versions go',
    tip: 'Where the other versions of a chat are written.',
    intro: 'With All versions, choose how they are laid out.',
    options: [
      { name: 'In the same file', text: 'One file: the shared turns, then a section per version.' },
      { name: 'In one file each', text: 'A separate file for every version, each readable on its own.' },
    ],
  },
  attachments: {
    title: 'Save uploads and images',
    tip: 'Also download pictures and files, next to the chat file.',
    intro: 'When on, Echoes downloads the pictures and files in the chat and saves them in a folder next to the chat file, so the file shows them even offline. When off, they are listed by name only.',
    more: ['Old uploads may have expired at ChatGPT; Echoes then writes a note in their place.'],
  },
  reexport: {
    title: 'Re-export all',
    tip: 'Save every chat again, even the ones that did not change since the last export.',
    intro: 'Normally a second export into the same folder saves only new or changed chats. Tick this to save them all again, for example after you deleted files in the folder.',
  },
  recheck: {
    title: 'Re-check chats every … days',
    tip: 'Older chats are fetched again after this many days, in case they changed quietly.',
    intro: 'ChatGPT does not always update a chat\'s date when it changes. So Echoes fetches chats again after this many days, even when their date says nothing changed. 0 turns this off.',
  },
  search: {
    title: 'Search turns',
    tip: 'Find turns by their words; typos are fine.',
    intro: 'Type a few words: matching turns light up. "Select only these" picks exactly them; "Add" adds them to what you already picked. Accents, capitals and small typos are ignored.',
  },
  rules: {
    title: 'Rules',
    tip: 'Pick turns by conditions, for example "has code" or "the last 5 turns".',
    intro: 'Each rule is a sentence about a turn. Click a coloured word to change it; the verb flips a rule around ("has" or "doesn\'t have"). Choose whether all rules must hold, or any one of them, then select, add or remove the matching turns.',
    options: [
      { name: 'Words in the question or answer', text: 'Turns whose text contains some words; allowing typos, exactly, or as a regular expression (a pattern language for experts).' },
      { name: 'Code, math, tables, pictures…', text: 'Turns with that kind of content.' },
      { name: 'Every Nth turn', text: 'For example every 2nd turn, counting from turn 1.' },
      { name: 'A range of turns', text: 'Turns between two numbers, both included.' },
      { name: 'The first / last turns', text: 'The first or last few turns of the chat.' },
      { name: 'The model that answered', text: 'Matches when the chat\'s model has exactly this name, like gpt-4o (capitals don\'t matter). ChatGPT reports one model per chat, so this keeps or drops all its turns.' },
      { name: 'When it was asked', text: 'Turns asked between two dates.' },
      { name: 'Edited or regenerated turns', text: 'Turns that have other versions.' },
    ],
  },
  selection: {
    title: 'Selecting turns',
    tip: 'Tick the turns to export. Shift-click ticks a range.',
    intro: 'Ticked turns are exported. All, None and Invert change every tick at once. Shift-click a second turn to tick everything between. Click a turn\'s text to preview it exactly as it will be saved, and to switch between its versions.',
  },
  chatList: {
    title: 'Your chats',
    tip: 'Load the list, filter it, and tick the chats to export.',
    intro: 'Load the list of your chats (or of the open Project). Everything is ticked at first. Filter by title or by the date a chat last changed, then tick or untick chats or whole Projects.',
  },
  quickButton: {
    title: 'Floating Echoes button',
    tip: 'A small Echoes button on ChatGPT pages for quick exports.',
    intro: 'Shows a round Echoes button in the corner of ChatGPT chat and Project pages. It opens this page ready to export that chat, its turns or the Project.',
    more: ['Its × hides it until you restart the browser. This switch turns it off or on for good.'],
  },
  check: {
    title: 'Check compatibility',
    tip: 'Test that Echoes still understands ChatGPT, using the open chat.',
    intro: 'ChatGPT changes now and then. This fetches the open chat (or your newest one) exactly as an export would and reports, line by line, what worked. Run it if an export looks wrong.',
  },
} satisfies Record<string, HelpEntry>;

export type HelpId = keyof typeof HELP;

/** The tooltip of one option of a field, by its on-screen name. */
export function optionTip(id: HelpId, name: string): string | undefined {
  const entry: HelpEntry = HELP[id];
  return entry.options?.find((o) => o.name === name)?.text;
}
