import { useEffect, useRef, type RefObject } from 'react';

/** 新しい分類ダイアログ内にキーボード操作を保ち、閉じた後は操作元へ戻す。 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, returnSelector: string, onEscape?: () => void) {
  const escape = useRef(onEscape);
  escape.current = onEscape;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement : null;
    if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;
    const topmost = () => [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].at(-1) === dialog;
    const controls = () => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')]
      .filter((element) => element.getClientRects().length > 0);
    (dialog.querySelector<HTMLElement>('input, select') ?? dialog.querySelector<HTMLElement>('button'))?.focus();
    const trap = (event: KeyboardEvent) => {
      if (!topmost()) return;
      if (event.key === 'Escape' && escape.current) {
        event.preventDefault(); event.stopPropagation(); escape.current(); return;
      }
      if (event.key !== 'Tab') return;
      const available = controls();
      if (!available.length) { event.preventDefault(); dialog.focus(); return; }
      const first = available[0];
      const last = available[available.length - 1];
      if (!dialog.contains(document.activeElement) || document.activeElement === dialog) {
        event.preventDefault(); (event.shiftKey ? last : first).focus(); return;
      }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const keepFocus = () => {
      if (topmost() && !dialog.contains(document.activeElement)) (controls()[0] ?? dialog).focus();
    };
    // Disabling/removing an async action's button can move focus to BODY. Keep
    // handling keys even then, rather than only listening inside the dialog.
    document.addEventListener('keydown', trap, true);
    document.addEventListener('focusin', keepFocus);
    return () => {
      document.removeEventListener('keydown', trap, true);
      document.removeEventListener('focusin', keepFocus);
      const target = document.querySelector<HTMLElement>(returnSelector) ?? (previous?.isConnected ? previous : null);
      if (target && !target.closest('[inert]')) target.focus();
    };
  }, [ref, returnSelector]);
}
