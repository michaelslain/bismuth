// Shared checkbox-task-line patterns for body/task cards. The writers (toggleTaskLine /
// setTaskLineStatus) normalize every bullet to `-`, so a single `-` bullet is all the cards
// need to recognize a task. Centralized here so the recognizer and the capturing variant can't
// drift apart across cardBodySplit.ts / taskCardMarkup.ts / CardEditor.tsx.

/** Recognizer: `- [<one char>] body`, possibly indented. Test-only (no capture groups). */
export const TASK_LINE = /^[ \t]*- \[.\] /;

/** Capturing variant: groups are [indent, statusChar, body]. */
export const TASK_LINE_CAP = /^(\s*)- \[(.)\] (.*)$/;
