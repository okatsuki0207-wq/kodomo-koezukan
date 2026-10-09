export type BookOpeningPhase = 'idle' | 'fade' | 'opening' | 'glow' | 'reveal';
export type ActiveBookOpeningPhase = Exclude<BookOpeningPhase, 'idle'>;

export const BOOK_OPENING_TIMING = {
  fadeOutMs: 260,
  openingMs: 700,
  glowMs: 420,
  revealMs: 460,
} as const;
