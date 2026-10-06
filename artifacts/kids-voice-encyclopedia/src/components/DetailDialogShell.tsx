import { useRef, type ReactNode } from 'react';
import { useDialogFocus } from '../hooks/useDialogFocus';

export default function DetailDialogShell({ children, label, returnSelector, onClose, className = 'dialog dialog-detail' }: {
  children: ReactNode; label: string; returnSelector: string; onClose: () => void; className?: string;
}) {
  const ref = useRef<HTMLElement | null>(null);
  useDialogFocus(ref, returnSelector, onClose);
  return <section ref={ref} className={className} role="dialog" aria-modal="true" aria-label={label}>{children}</section>;
}
