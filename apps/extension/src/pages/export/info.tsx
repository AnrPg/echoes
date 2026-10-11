import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

/**
 * An ⓘ button that opens a box explaining a setting in plain words. Reusable for any setting: pass a title and the
 * explanation as children. The box is a modal dialog, so Esc, the Close button or a click outside closes it.
 */
export function InfoButton({ title, children }: { title: string; children: ComponentChildren }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    const outside = (e: MouseEvent) => {
      if (e.target === d) d.close(); // the backdrop counts as the dialog itself
    };
    d.addEventListener('click', outside);
    return () => d.removeEventListener('click', outside);
  }, []);
  return (
    <>
      <button type="button" class="info-button" aria-label={`About: ${title}`} title={`About: ${title}`} onClick={() => dialog.current?.showModal()}>
        ⓘ
      </button>
      <dialog class="info-box" ref={dialog} aria-label={title}>
        <div class="info-head">
          <h3>{title}</h3>
          <button type="button" onClick={() => dialog.current?.close()}>
            Close
          </button>
        </div>
        <div class="info-body">{children}</div>
      </dialog>
    </>
  );
}

/** Saving only what changed: what it is, why, and how to use it. Checked against `exportChats` and the manifest. */
export function IncrementalExportInfo() {
  return (
    <InfoButton title="Saving only what changed">
      <p>
        <strong>In short:</strong> Echoes works like a backup drive that copies only your new photos. The first export saves every chat you picked.
        Later exports into the <strong>same folder</strong> save only the chats that are new or have changed, and skip the rest.
      </p>

      <h4>Why it helps</h4>
      <ul>
        <li>
          <strong>It's fast.</strong> If you back up 200 chats every week and talked in 5 of them, the next export fetches those 5, not all 200.
        </li>
        <li>
          <strong>It's gentle on your ChatGPT account.</strong> Echoes reads each chat from ChatGPT one by one, with a pause between requests. Fewer
          chats to read means fewer requests.
        </li>
        <li>
          <strong>Your folder stays tidy.</strong> Each chat keeps its file; a changed chat's file is replaced, not duplicated.
        </li>
      </ul>

      <h4>How to use it</h4>
      <ol>
        <li>Press <strong>Load chat list</strong> and tick the chats you want (all of them are ticked at first).</li>
        <li>
          Press <strong>Export</strong> and pick a folder on your computer, for example <em>Documents/ChatGPT backup</em>. Allow Echoes to use it
          when the browser asks.
        </li>
        <li>
          Echoes saves the chats there, plus two small files it needs: <code>manifest.json</code> (the list of what it saved and when each chat last
          changed) and <code>echoes-report.json</code> (what happened in this export). Leave them in the folder.
        </li>
        <li>
          Next time, do the same and pick the <strong>same folder</strong>. Echoes reads its list and saves only what is new or changed. The activity
          log at the bottom says how many chats were written and how many were skipped as unchanged.
        </li>
      </ol>

      <h4>What counts as "changed"</h4>
      <ul>
        <li>A chat that wasn't in the folder yet.</li>
        <li>A chat with new messages since the last export.</li>
        <li>
          Every chat, when you changed a setting such as the format or the look. Echoes notices this by itself, so you don't need the box below for
          it.
        </li>
        <li>
          A chat whose last check is older than the <strong>Re-check chats every … days</strong> setting. ChatGPT doesn't always update a chat's date
          when it changes, so Echoes looks at older chats again now and then to be sure.
        </li>
      </ul>

      <h4>When to tick "Re-export all, even unchanged chats"</h4>
      <p>Tick it to save every chat again, ignoring the list. Use it when:</p>
      <ul>
        <li>you deleted or edited files in the folder and want fresh copies;</li>
        <li>an export looks wrong and you want to rule out leftovers from an earlier one.</li>
      </ul>
      <p>Leave it unticked the rest of the time.</p>

      <h4>Without folder access, you get a zip</h4>
      <p>
        If your browser can't give Echoes a folder, or you choose not to, Echoes saves one zip file instead. A zip is a new file each time, so Echoes
        can't see what an earlier zip held: <strong>every zip export is a full export</strong>.
      </p>
    </InfoButton>
  );
}
