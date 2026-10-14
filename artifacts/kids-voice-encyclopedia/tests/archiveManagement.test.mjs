import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { readFile } from 'node:fs/promises';

test('gallery and archive lists split archived cards without mutating source order', async () => {
  const source = stripTypeScriptTypes(await readFile(new URL('../src/lib/archiveManagement.ts', import.meta.url), 'utf8'));
  const context = vm.createContext({});
  const module = new vm.SourceTextModule(source, { context });
  await module.link(() => { throw new Error('Unexpected archive helper dependency'); });
  await module.evaluate();
  const cards = [{ id: 'a' }, { id: 'b', archived: true }, { id: 'c', archived: false }];
  assert.deepEqual(Array.from(module.namespace.activeKeepsakes(cards), ({ id }) => id), ['a', 'c']);
  assert.deepEqual(Array.from(module.namespace.archivedKeepsakes(cards), ({ id }) => id), ['b']);
  assert.deepEqual(cards.map(({ id }) => id), ['a', 'b', 'c']);
});
