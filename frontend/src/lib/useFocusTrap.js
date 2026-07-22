import { useEffect, useRef } from "react";

// Shared modal a11y behavior for BugReportDialog and BodyFatPicker (the
// app's only two true blocking dialogs — everything else, like the Coach
// panel, is a non-blocking floating widget with its own lighter handling).
//
// Gives a dialog, for free:
//  - focus moves into it the moment it opens (first focusable element)
//  - Tab / Shift+Tab wrap inside it instead of escaping to the app behind
//  - Escape closes it
//  - focus returns to whatever triggered it when it closes
//
// `active` should be the dialog's own open/mounted condition. `containerRef`
// must point at the dialog panel (not the full-screen overlay).
const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(containerRef, { active, onClose }) {
  const previouslyFocused = useRef(null);

  useEffect(() => {
    if (!active) return undefined;
    previouslyFocused.current = document.activeElement;

    const container = containerRef.current;
    const focusFirst = () => {
      const focusables = container ? container.querySelectorAll(FOCUSABLE) : [];
      (focusables[0] || container)?.focus();
    };
    // rAF: let the panel finish its first paint before stealing focus.
    const raf = requestAnimationFrame(focusFirst);

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key !== "Tab" || !container) return;
      const focusables = Array.from(container.querySelectorAll(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null // skip hidden/collapsed elements
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    // Capture phase so Escape/Tab are caught before anything inside (e.g. a
    // textarea) treats them as ordinary input.
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", handleKeyDown, true);
      const prev = previouslyFocused.current;
      if (prev && document.contains(prev) && typeof prev.focus === "function") {
        prev.focus();
      }
    };
  }, [active, containerRef, onClose]);
}
