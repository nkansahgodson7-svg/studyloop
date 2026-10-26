"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react";
import { Icon } from "@/components/ui/icons";

interface SheetApi {
  open: (node: ReactNode) => void;
  close: () => void;
}

const SheetContext = createContext<SheetApi>({ open: () => undefined, close: () => undefined });

export function useSheet(): SheetApi {
  return useContext(SheetContext);
}

export function SheetProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<ReactNode | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = useCallback((next: ReactNode) => {
    if (isOpen) {
      setNode(next);
      return;
    }
    lastFocused.current = document.activeElement as HTMLElement | null;
    setNode(next);
    setTabHelper();
  }, []);

  function setTabHelper() {
    const firstPaint = () => {
      void rootRef.current?.offsetWidth;
      setIsOpen(true);
      requestAnimationFrame(() => {
        const panel = rootRef.current?.querySelector<HTMLElement>(".sheet-panel");
        if (!panel) return;
        const target = panel.querySelector<HTMLElement>(
          'input:not([type="file"]):not([type="hidden"]), textarea, .kind, button'
        );
        if (target) target.focus({ preventScroll: true });
      });
    };
    requestAnimationFrame(firstPaint);
  }

  const close = useCallback(() => {
    setIsOpen(false);
    const focused = lastFocused.current;
    if (focused && typeof focused.focus === "function") focused.focus({ preventScroll: true });
    lastFocused.current = null;
    closeTimer.current = setTimeout(() => setNode(null), 320);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = rootRef.current?.querySelector(".sheet-panel");
      if (!panel) return;
      const nodes = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href]'
        )
      ).filter((el) => el.offsetParent !== null);
      if (!nodes.length) return;
      const first = nodes[0] as HTMLElement;
      const last = nodes[nodes.length - 1] as HTMLElement;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  return (
    <SheetContext.Provider value={{ open, close }}>
      <div ref={rootRef} className={`sheet-root ${isOpen ? "is-open" : ""}`}>
        {node !== null ? (
          <>
            <div className="sheet-scrim" onClick={close} />
            {node}
          </>
        ) : null}
      </div>
      {children}
    </SheetContext.Provider>
  );
}

export function SheetFrame({
  title,
  sub,
  body,
  foot,
  formId,
  onSubmit
}: {
  title: ReactNode;
  sub?: ReactNode;
  body: ReactNode;
  foot?: ReactNode;
  formId?: string;
  onSubmit?: (data: FormData) => void;
}) {
  const { close } = useSheet();
  return (
    <div className="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
      <div className="sheet__grab" aria-hidden="true" />
      <div className="sheet__head">
        <div>
          <h2 className="sheet__title" id="sheetTitle">
            {title}
          </h2>
          {sub ? <p className="sheet__sub">{sub}</p> : null}
        </div>
        <button className="icon-btn" type="button" onClick={close} aria-label="Close">
          <Icon name="close" />
        </button>
      </div>
      {formId ? (
        <form
          className="sheet__body"
          id={formId}
          onSubmit={(event) => {
            event.preventDefault();
            if (onSubmit) onSubmit(new FormData(event.currentTarget));
          }}
        >
          {body}
        </form>
      ) : (
        <div className="sheet__body">{body}</div>
      )}
      <div className="sheet__foot">{foot}</div>
    </div>
  );
}
