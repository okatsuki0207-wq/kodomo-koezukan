import { useRef, useState } from 'react';
import { Check, Menu, Share, Smartphone, X } from 'lucide-react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import {
  canPromptInstall,
  currentInstallPlatform,
  currentIsIosSafari,
  promptInstall,
} from '../lib/installGuide';

type Props = {
  onClose: () => void;
  returnSelector?: string;
};

export default function InstallGuideDialog({ onClose, returnSelector = '[data-testid="button-home"]' }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  useDialogFocus(dialog, returnSelector, onClose);
  const [platform] = useState(currentInstallPlatform);
  const [iosSafari] = useState(currentIsIosSafari);
  const [nativeAvailable, setNativeAvailable] = useState(canPromptInstall);
  const [installed, setInstalled] = useState(false);
  const [busy, setBusy] = useState(false);

  const runNativePrompt = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const outcome = await promptInstall();
      if (outcome === 'accepted') {
        setInstalled(true);
      } else {
        setNativeAvailable(canPromptInstall());
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay overlay-top" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialog} className="dialog install-guide-dialog" role="dialog" aria-modal="true" aria-labelledby="install-guide-title" data-testid="install-guide-dialog">
        <div className="dialog-head">
          <div>
            <h2 id="install-guide-title" className="dialog-title">ホーム画面に追加しよう</h2>
            <p className="dialog-lede">追加すると、アイコンからすぐ開けるようになります。キロクは端末の中に保存されるので、ホーム画面から開く方が長く残りやすくなります。</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="閉じる" data-testid="button-close-install-guide"><X size={19} /></button>
        </div>

        <div className="install-guide-character" aria-hidden="true">
          <img src={`${import.meta.env.BASE_URL}character/voicel_fly.png`} alt="" draggable={false} decoding="async" />
        </div>

        {installed ? (
          <p className="install-guide-done" role="status" data-testid="status-install-done">
            <Check size={18} /> 追加できました。ホーム画面のアイコンから開いてね。
          </p>
        ) : platform === 'ios' ? (
          <>
            {!iosSafari && (
              <p className="install-guide-note" role="note">
                いま開いているブラウザではホーム画面に追加できないことがあります。そのときは、このページをSafariで開き直してから試してみてください。
              </p>
            )}
            <ol className="install-guide-steps">
              <li>
                <span className="install-guide-step-icon"><Share size={17} /></span>
                <span>画面の下にある<strong>共有ボタン</strong>をタップします。</span>
              </li>
              <li>
                <span className="install-guide-step-icon"><Smartphone size={17} /></span>
                <span>メニューから<strong>「ホーム画面に追加」</strong>をえらびます。</span>
              </li>
              <li>
                <span className="install-guide-step-icon"><Check size={17} /></span>
                <span>右上の<strong>「追加」</strong>をタップしたら完了です。</span>
              </li>
            </ol>
          </>
        ) : platform === 'android' ? (
          <>
            {nativeAvailable && (
              <button type="button" className="install-guide-native-button" disabled={busy} onClick={() => { void runNativePrompt(); }} data-testid="button-install-native">
                <Smartphone size={19} />
                <span>ホーム画面に追加する</span>
              </button>
            )}
            <ol className="install-guide-steps">
              <li>
                <span className="install-guide-step-icon"><Menu size={17} /></span>
                <span>画面の右上にある<strong>メニュー（︙）</strong>をタップします。</span>
              </li>
              <li>
                <span className="install-guide-step-icon"><Smartphone size={17} /></span>
                <span><strong>「アプリをインストール」</strong>または<strong>「ホーム画面に追加」</strong>をえらびます。</span>
              </li>
              <li>
                <span className="install-guide-step-icon"><Check size={17} /></span>
                <span>案内にそって<strong>「インストール」</strong>をタップしたら完了です。</span>
              </li>
            </ol>
          </>
        ) : (
          <ol className="install-guide-steps">
            <li>
              <span className="install-guide-step-icon"><Menu size={17} /></span>
              <span>ブラウザの<strong>メニュー</strong>を開きます。</span>
            </li>
            <li>
              <span className="install-guide-step-icon"><Smartphone size={17} /></span>
              <span><strong>「アプリをインストール」</strong>または<strong>「ホーム画面に追加」</strong>をえらぶと、アイコンから開けるようになります。</span>
            </li>
          </ol>
        )}

        <div className="dialog-actions">
          <button type="button" className="cancel-button" onClick={onClose} data-testid="button-install-guide-later">あとで</button>
        </div>
      </div>
    </div>
  );
}
