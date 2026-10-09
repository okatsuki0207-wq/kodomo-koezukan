import { useRef } from 'react';
import { Share2, Smartphone, X } from 'lucide-react';
import { useDialogFocus } from '../hooks/useDialogFocus';

type Props = {
  isInstalled: boolean;
  onShare: () => void;
  onClose: () => void;
};

export default function InstallAppDialog({ isInstalled, onShare, onClose }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  useDialogFocus(dialog, '[data-testid="button-share"]', onClose);

  return (
    <div
      className="overlay overlay-top"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}
    >
      <div
        ref={dialog}
        className="dialog pwa-install-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pwa-install-title"
        data-testid="dialog-pwa-install"
      >
        <div className="dialog-head">
          <div>
            <span className="pwa-install-icon"><Smartphone size={23} aria-hidden="true" /></span>
            <h2 id="pwa-install-title" className="dialog-title">ホーム画面に追加</h2>
            <p className="dialog-lede">「こどもの こえずかん」を次からすぐに開けます。</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="閉じる" data-testid="button-close-install-guide">
            <X size={19} />
          </button>
        </div>

        {isInstalled ? (
          <p className="pwa-installed-note" role="status">この端末には、すでにホーム画面への追加が完了しています。</p>
        ) : (
          <ol className="pwa-install-steps">
            <li><strong>iPhone・iPad</strong><span>Safariの「共有」ボタンを押して、「ホーム画面に追加」を選びます。</span></li>
            <li><strong>Android・Chrome</strong><span>ブラウザ右上の「⋮」を押して、「アプリをインストール」または「ホーム画面に追加」を選びます。</span></li>
          </ol>
        )}

        <button type="button" className="pwa-share-link-button" onClick={onShare} data-testid="button-share-encyclopedia-link">
          <Share2 size={18} aria-hidden="true" />
          <span>ずかんのリンクを共有する</span>
        </button>
      </div>
    </div>
  );
}
