import { useEffect, type RefObject } from 'react';

/** 新しい分類ダイアログ内にキーボード操作を保ち、閉じた後は操作元へ戻す。 */
export function useDialogFocus(ref: RefObject<HTMLFormElement | null>, returnSelector: string) {
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (dialog.querySelector<HTMLElement>('input, select') ?? dialog.querySelector<HTMLElement>('button'))?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')];
      if (!controls.length) { event.preventDefault(); return; }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    dialog.addEventListener('keydown', trap);
    return () => {
      dialog.removeEventListener('keydown', trap);
      const target = previous?.isConnected ? previous : document.querySelector<HTMLElement>(returnSelector);
      if (target && !target.closest('[inert]')) target.focus();
    };
  }, [ref, returnSelector]);
}
