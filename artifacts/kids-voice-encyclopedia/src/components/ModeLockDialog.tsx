import { useEffect, useRef, useState } from 'react';
import { LockKeyhole, X } from 'lucide-react';
import { useDialogFocus } from '../hooks/useDialogFocus';

type Props = { onClose: () => void; onUnlock: () => void };

export default function ModeLockDialog({ onClose, onUnlock }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const [holding, setHolding] = useState(false);
  useDialogFocus(dialog, '[data-testid="button-unlock-edit-mode"]', onClose);

  const stopHold = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  const startHold = (event: React.PointerEvent<HTMLButtonElement> | React.KeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (timer.current !== null) return;
    setHolding(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onUnlock();
    }, 3000);
  };
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  return <div className="overlay lock-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} className="lock-dialog" role="dialog" aria-modal="true" aria-labelledby="lock-title" tabIndex={-1}>
      <button type="button" className="icon-button lock-close" onClick={onClose} aria-label="閉じる"><X size={19} /></button>
      <div className="lock-icon"><LockKeyhole size={25} /></div>
      <h2 id="lock-title">おとなの人へ</h2>
      <p>編集画面に戻るには、<br /><strong>下のボタンを3秒おしつづけてください。</strong></p>
      <button
        type="button"
        className={`lock-hold-button${holding ? ' is-holding' : ''}`}
        onPointerDown={startHold}
        onPointerUp={stopHold}
        onPointerCancel={stopHold}
        onPointerLeave={stopHold}
        onKeyDown={(event) => { if (!event.repeat && (event.key === 'Enter' || event.key === ' ')) startHold(event); }}
        onKeyUp={(event) => { if (event.key === 'Enter' || event.key === ' ') stopHold(); }}
        onContextMenu={(event) => event.preventDefault()}
        aria-describedby="lock-hold-hint"
        data-testid="button-confirm-edit-unlock"
      >
        <span className="lock-hold-progress" />
        <span className="lock-hold-label">{holding ? 'そのままおしつづけてね…' : '3秒おしつづけて解除'}</span>
      </button>
      <p id="lock-hold-hint" className="lock-hint">途中で指をはなすと、はじめからになります。</p>
    </div>
  </div>;
}
