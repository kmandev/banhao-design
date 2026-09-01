'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * The modal behaviour M-04 established and M-05, M-11 and M-12 all reuse:
 * focus moves in on open, is trapped while open, Escape closes, and focus
 * returns to whatever opened the overlay when it closes.
 *
 * Extracted rather than copied a third time. `AcceptConfirmDialog` still owns
 * its own copy: its Escape handling is conditional on an in-flight command and
 * its initial focus target is a preset button chosen by its own rules, so
 * folding it in here would mean parameterising this hook for one caller's
 * special case. That is a refactor M-05 did not ask for and this task should
 * not smuggle in.
 *
 * Focus **returns** on close, which neither existing dialog implements: a
 * merchant who opened the edit drawer from a dish row should land back on that
 * row, not at the top of the document (M-11 §11).
 */
export function useModalFocus(options: {
  /** The dialog container. Focus is trapped inside it. */
  containerRef: RefObject<HTMLElement | null>;
  /** Whether the overlay is currently open. */
  open: boolean;
  /** Escape, and the scrim. */
  onClose: () => void;
  /**
   * Selector for the element to focus on open. Defaults to the first
   * focusable. A form drawer names its first field; a destructive dialog names
   * its cancel button, so an accidental Enter never confirms.
   */
  initialFocusSelector?: string;
}): void {
  const { containerRef, open, onClose, initialFocusSelector } = options;

  const previouslyFocused = useRef<HTMLElement | null>(null);
  // Held in a ref so the keydown listener never has to be rebuilt when the
  // caller passes a fresh closure, which would drop keystrokes mid-rebuild.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current =
      typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;

    const container = containerRef.current;
    const target = initialFocusSelector
      ? container?.querySelector<HTMLElement>(initialFocusSelector)
      : getFocusable(container)[0];

    (target ?? container)?.focus();

    return () => {
      // Only restore if the element is still in the document — a row removed
      // by the very edit that closed this drawer cannot take focus back.
      const previous = previouslyFocused.current;
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [open, containerRef, initialFocusSelector]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const container = containerRef.current;
      if (!container) return;
      const focusable = getFocusable(container);
      if (focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, containerRef]);
}

function getFocusable(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}
