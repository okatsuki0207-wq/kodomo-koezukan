export type ArchiveEntry = { id: string; archived?: boolean };

export function activeKeepsakes<T extends ArchiveEntry>(items: readonly T[]): T[] {
  return items.filter((item) => item.archived !== true);
}

export function archivedKeepsakes<T extends ArchiveEntry>(items: readonly T[]): T[] {
  return items.filter((item) => item.archived === true);
}
