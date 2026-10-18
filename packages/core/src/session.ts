import {check, validateDocument} from './document.ts';
import type {Document} from './document.ts';
import {applyCommand} from './commands.ts';
import type {Command} from './commands.ts';

export function createSession(initial: Document) {
  validateDocument(initial);
  let current = structuredClone(initial), revision = 0;
  const past: Document[] = [], future: Document[] = [];
  const snapshot = () => ({revision, document: structuredClone(current), canUndo: !!past.length, canRedo: !!future.length});
  const requireRevision = (expected: number) => check(expected === revision, 'REVISION_CONFLICT');
  return {
    snapshot,
    execute(expected: number, command: Command) {
      requireRevision(expected); const next = applyCommand(current, command);
      past.push(current); current = next; future.length = 0; revision++; return snapshot();
    },
    undo(expected: number) {
      requireRevision(expected); check(past.length, 'NO_UNDO');
      future.push(current); current = past.pop()!; revision++; return snapshot();
    },
    redo(expected: number) {
      requireRevision(expected); check(future.length, 'NO_REDO');
      past.push(current); current = future.pop()!; revision++; return snapshot();
    }
  };
}
