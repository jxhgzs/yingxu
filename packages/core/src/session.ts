import {check, validateDocument} from './document.ts';
import type {Document} from './document.ts';
import {applyCommand} from './commands.ts';
import type {Command} from './commands.ts';

export type SessionArchive = {revision: number; document: Document; past: Document[]; future: Document[]};
export function createSession(initial: Document, restore?: Omit<SessionArchive, 'document'>) {
  validateDocument(initial);
  if (restore) {
    check(Number.isSafeInteger(restore.revision) && restore.revision >= 0 && Array.isArray(restore.past) && Array.isArray(restore.future), 'INVALID_SESSION_ARCHIVE');
    for (const doc of [...restore.past, ...restore.future]) validateDocument(doc);
  }
  let current = structuredClone(initial), revision = restore?.revision ?? 0;
  const past: Document[] = structuredClone(restore?.past || []), future: Document[] = structuredClone(restore?.future || []);
  const snapshot = () => ({revision, document: structuredClone(current), canUndo: !!past.length, canRedo: !!future.length});
  const requireRevision = (expected: number) => check(expected === revision, 'REVISION_CONFLICT');
  return {
    snapshot,
    serialize: (): SessionArchive => structuredClone({revision, document: current, past, future}),
    execute(expected: number, command: Command) {
      requireRevision(expected); const next = applyCommand(current, command);
      if (JSON.stringify(next) === JSON.stringify(current)) return snapshot();
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
