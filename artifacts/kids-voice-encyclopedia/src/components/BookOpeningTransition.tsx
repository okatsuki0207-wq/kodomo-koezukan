import type { ActiveBookOpeningPhase } from '../lib/bookOpening';

export default function BookOpeningTransition({ phase }: { phase: ActiveBookOpeningPhase }) {
  return (
    <div
      className="book-opening-overlay"
      data-phase={phase}
      aria-hidden="true"
      data-testid="book-opening-transition"
    >
      <div className="book-opening-light" />
      <div className="book-opening-art">
        <div className="book-opening-cover" />
        <div className="book-opening-page book-opening-page-left">
          <span className="book-opening-page-lines" />
          <span className="book-opening-page-picture" />
        </div>
        <div className="book-opening-page book-opening-page-right">
          <span className="book-opening-page-lines" />
          <span className="book-opening-page-picture" />
        </div>
        <div className="book-opening-spine" />
        <div className="book-opening-cover-edge" />
      </div>
    </div>
  );
}
