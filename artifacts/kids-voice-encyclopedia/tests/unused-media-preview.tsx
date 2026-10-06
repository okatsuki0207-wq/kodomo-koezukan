// Dev-only component fixture. No app Store/Firebase config import, credentials,
// network media, Auth, or cloud SDK operation. Never use real family data here.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import UnusedMediaDialog from '../src/components/UnusedMediaDialog';
import type { UnusedFile, UnusedMediaReport } from '../src/lib/unusedMedia';
import '../src/index.css';

const checkedAt = Date.now();
const statuses: UnusedFile['status'][] = ['referenced', 'active', 'legacy', 'waiting', 'eligible', 'eligible'];
const files: UnusedFile[] = statuses.map((status, index) => ({
  path: `users/synthetic/keepsakes/test-${index}/attempt-${index}/photo`,
  bucket: 'demo-ui-only', size: 128, updatedAt: checkedAt - 8 * 86400000,
  generation: 'synthetic', cardId: `test-${index}`, attemptId: `attempt-${index}`, status,
}));
const calls = { scans: 0, deleted: [] as string[] };
Object.assign(window, { cleanupFixture: calls });
const options = new URLSearchParams(location.search);

function Fixture() {
  const [open, setOpen] = useState(true);
  const [, refresh] = useState(0);
  useEffect(() => {
    if (options.has('inspected')) document.querySelector<HTMLButtonElement>('[data-testid="button-inspect-unused"]')?.click();
  }, []);
  return <>
    <p style={{ padding: 12 }} data-testid="fixture-status">合成データのみ · 一覧確認 {calls.scans} 回 · 削除 {calls.deleted.length} 回</p>
    <button type="button" data-testid="button-unused-media" onClick={() => setOpen(true)}>合成データの画面を開く</button>
    {open && <UnusedMediaDialog onClose={() => setOpen(false)}
      describeError={(error) => error instanceof Error ? error.message : 'テストエラー'}
      inspectUnusedMedia={async (): Promise<UnusedMediaReport> => {
        calls.scans++; refresh((n) => n + 1);
        if (options.get('failure') === 'scan') throw new Error('合成サーバーはオフラインです。削除しません。');
        return { checkedAt, bucket: 'demo-ui-only', files: files.filter((file) => !calls.deleted.includes(file.path)) };
      }}
      deleteUnusedMedia={async (path, confirmed) => {
        if (!confirmed) throw new Error('確認がありません');
        // Keep the action pending briefly to exercise double-click protection.
        await new Promise((resolve) => setTimeout(resolve, 150));
        if (options.get('failure') === 'delete') throw new Error('合成削除を中断しました。');
        calls.deleted.push(path); refresh((n) => n + 1);
      }}
    />}
  </>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
