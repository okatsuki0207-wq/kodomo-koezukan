import { useRef, useState } from 'react';
import { Copy, Share2, X } from 'lucide-react';
import { useDialogFocus } from '../hooks/useDialogFocus';

type Props = {
  url: string;
  onCopy: () => Promise<boolean>;
  onClose: () => void;
};

export default function ShareLinkDialog({ url, onCopy, onClose }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  useDialogFocus(dialog, '[data-testid="button-share"]', onClose);

  const copy = async () => {
    const copied = await onCopy();
    if (!copied) {
      setCopyFailed(true);
      linkInput.current?.select();
    }
  };

  return (
    <div
      className="overlay overlay-top"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}
    >
      <div
        ref={dialog}
        className="dialog share-link-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-link-title"
        data-testid="dialog-share-link"
      >
        <div className="dialog-head">
          <div>
            <span className="share-link-icon"><Share2 size={21} aria-hidden="true" /></span>
            <h2 id="share-link-title" className="dialog-title">ずかんを共有する</h2>
            <p className="dialog-lede">このリンクを家族に送ると、ずかんを見てもらえます。</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="閉じる" data-testid="button-close-share-link">
            <X size={19} />
          </button>
        </div>

        <label className="share-link-label" htmlFor="share-link-url">共有リンク</label>
        <input
          ref={linkInput}
          id="share-link-url"
          className="share-link-input"
          type="url"
          value={url}
          readOnly
          onFocus={(event) => event.currentTarget.select()}
          data-testid="input-share-link"
        />
        {copyFailed && <p className="share-link-copy-hint" role="status">リンクを長押ししてコピーしてください。</p>}
        <button type="button" className="share-link-copy-button" onClick={() => void copy()} data-testid="button-copy-share-link">
          <Copy size={18} aria-hidden="true" />
          <span>リンクをコピー</span>
        </button>
      </div>
    </div>
  );
}
