---
title: "Δείπνο με widgets"
conversation_id: "widget-sample"
source: "https://chatgpt.com/c/widget-sample"
created: "2026-10-11T12:00:00Z"
updated: "2026-10-11T12:00:00Z"
echoes_schema: 1
---

# Δείπνο με widgets

## Turn 1

### User

Λίστα υλικών;

### Assistant

1. Υλικά

*Widget · shown static*

Λίστα αγορών

Κυρίως

- [ ] 3 φέτες ποντίκι
- [ ] 1 κυδώνι

Ρύζι

- [ ] 120 γρ. μπασμάτι

2. Μοσχαράκι

## Turn 2

### User

Ποια μυρωδικά;

### Assistant

Ποιον συνδυασμό να διαλέξεις;

*Widget · shown static*

- ◉ Ήπιο, ιταλικό

  Αναδεικνύει την ντομάτα.
- ○ Ελληνικό, σπιτικό

  Πιο οικείο.

---

Τα μυρωδικά:

**For “Ήπιο, ιταλικό”:**

1 κλωνάρι θυμάρι + 1 δάφνη.

**For “Ελληνικό, σπιτικό”:**

1 δάφνη + σέλινο.

Θα διάλεγα τον πρώτο.

## Turn 3

### User

Show me a live widget

### Assistant

Change the numbers and press **Run**.

*Widget · shown static*

**Live Code Widget**

*This widget is a small app: open the HTML export to use it. Its code:*

```html
<div id="live-code-demo" class="w-full space-y-4">
  <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
    <label class="space-y-1">
      <span class="text-sm font-medium">x</span>
      <input id="xInput" type="number" value="12" class="w-full rounded-lg border border-[var(--viz-border)] bg-[var(--viz-card)] px-3 py-2 text-base text-[var(--viz-text)]" />
    </label>
    <label class="space-y-1">
      <span class="text-sm font-medium">Operation</span>
      <select id="opInput" class="w-full rounded-lg border border-[var(--viz-border)] bg-[var(--viz-card)] px-3 py-2 text-base text-[var(--viz-text)]">
        <option value="+">+</option>
        <option value="-">−</option>
        <option value="*">×</option>
        <option value="/">÷</option>
        <option value="pow">xʸ</option>
      </select>
    </label>
    <label class="space-y-1">
      <span class="text-sm font-medium">y</span>
      <input id="yInput" type="number" value="5" class="w-full rounded-lg border border-[var(--viz-border)] bg-[var(--viz-card)] px-3 py-2 text-base text-[var(--viz-text)]" />
    </label>
  </div>

  <div class="flex flex-wrap items-center gap-3">
    <button id="runBtn" type="button" class="min-h-11 rounded-lg bg-[var(--viz-accent)] px-4 py-2 font-medium text-white focus:outline-none focus:ring-2 focus:ring-[var(--viz-accent)] focus:ring-offset-2">Run</button>
    <button id="resetBtn" type="button" class="min-h-11 rounded-lg border border-[var(--viz-border)] bg-[var(--viz-card)] px-4 py-2 font-medium text-[var(--viz-text)]">Reset</button>
  </div>

  <div class="rounded-xl border border-[var(--viz-border)] bg-[var(--viz-panel)] p-4">
    <div class="text-sm text-[var(--viz-muted)]">Executed expression</div>
    <pre id="codeView" class="mt-1 whitespace-pre-wrap text-sm text-[var(--viz-text)]">12 + 5</pre>
    <div class="mt-3 text-sm text-[var(--viz-muted)]">Result</div>
    <div id="result" class="mt-1 text-2xl font-semibold text-[var(--viz-text)]" aria-live="polite">17</div>
    <div id="message" class="mt-2 text-sm text-[var(--viz-muted)]" aria-live="polite"></div>
  </div>

  <script>
    (() => {
      const root = document.getElementById('live-code-demo');
      if (!root || root.dataset.ready === '1') return;
      root.dataset.ready = '1';

      const xInput = root.querySelector('#xInput');
      const yInput = root.querySelector('#yInput');
      const opInput = root.querySelector('#opInput');
      const runBtn = root.querySelector('#runBtn');
      const resetBtn = root.querySelector('#resetBtn');
      const codeView = root.querySelector('#codeView');
      const result = root.querySelector('#result');
      const message = root.querySelector('#message');

      function execute() {
        const x = Number(xInput.value);
        const y = Number(yInput.value);
        const op = opInput.value;
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          message.textContent = 'Enter two valid numbers.';
          result.textContent = '—';
          return;
        }

        let value;
        let shownOp = op;
        if (op === '+') value = x + y;
        else if (op === '-') value = x - y;
        else if (op === '*') { value = x * y; shownOp = '*'; }
        else if (op === '/') {
          shownOp = '/';
          if (y === 0) {
            codeView.textContent = `${x} / ${y}`;
            result.textContent = '—';
            message.textContent = 'Division by zero is undefined.';
            return;
          }
          value = x / y;
        } else {
          value = Math.pow(x, y);
          shownOp = '**';
        }

        codeView.textContent = `${x} ${shownOp} ${y}`;
        result.textContent = Number.isFinite(value) ? String(value) : 'Result too large';
        message.textContent = 'Executed locally inside the widget.';
      }

      runBtn.addEventListener('click', execute);
      resetBtn.addEventListener('click', () => {
        xInput.value = '12';
        yInput.value = '5';
        opInput.value = '+';
        execute();
      });
    })();
  </script>
</div>
```
