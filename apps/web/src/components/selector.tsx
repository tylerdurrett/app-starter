import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { cn, Tooltip } from '@repo/ui';
import { Check } from 'lucide-react';

interface SelectorTrigger {
  title: string;
  avatarLabel: string;
  muted?: boolean;
}

interface SelectorApi {
  close: () => void;
}

interface SelectorProps {
  ariaLabel: string;
  openDirection: 'up' | 'down';
  trigger: SelectorTrigger;
  children: (api: SelectorApi) => React.ReactNode;
  onOpen?: () => void;
  onClose?: () => void;
}

export function Selector({
  ariaLabel,
  openDirection,
  trigger,
  children,
  onOpen,
  onClose,
}: SelectorProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ top?: number; bottom?: number; left: number }>({
    left: 0,
  });

  const close = useCallback(() => setOpen(false), []);
  const toggleOpen = useCallback(() => setOpen((prev) => !prev), []);

  // Keep the latest callback refs so the transition effect fires the current
  // handler without needing them in its dep array (which would fire the effect
  // on every parent render).
  const onOpenRef = useRef(onOpen);
  const onCloseRef = useRef(onClose);
  onOpenRef.current = onOpen;
  onCloseRef.current = onClose;

  // Fire onOpen/onClose on every transition except the initial mount.
  const isMountedRef = useRef(false);
  useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true;
      return;
    }
    if (open) onOpenRef.current?.();
    else onCloseRef.current?.();
  }, [open]);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const left = rect.right + 8;
    if (openDirection === 'down') {
      setPopoverPos({ top: rect.top, left });
    } else {
      setPopoverPos({ bottom: window.innerHeight - rect.bottom, left });
    }
  }, [openDirection]);

  // useLayoutEffect: measure trigger and set popover position synchronously
  // after DOM mutation but before paint, so the popover never renders a frame
  // with the default `{ left: 0 }` state (which caused a visible flash on
  // first open of selectors whose popover would otherwise paint on-screen).
  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;

    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) {
        return;
      }
      close();
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, close]);

  return (
    <>
      <Tooltip label={trigger.title} disabled={open}>
        <button
          ref={triggerRef}
          type="button"
          onClick={toggleOpen}
          aria-label={ariaLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex items-center justify-center w-full py-2 px-1 transition-colors cursor-pointer text-foreground hover:text-foreground"
        >
          <div
            className={cn(
              'w-14 h-14 rounded-full flex items-center justify-center text-lg font-semibold',
              trigger.muted ? 'bg-muted text-muted-foreground' : 'bg-accent',
            )}
          >
            {trigger.avatarLabel}
          </div>
        </button>
      </Tooltip>

      {open && (
        <div
          ref={popoverRef}
          role="menu"
          style={popoverPos}
          className="fixed z-50 bg-popover text-popover-foreground border rounded-lg shadow-lg w-64 p-2"
        >
          {children({ close })}
        </div>
      )}
    </>
  );
}

// Shared helpers so callers (workspace switcher, project switcher) render
// visually identical rows without duplicating class strings.

export function selectorRowClass(isActive: boolean): string {
  return cn(
    'flex items-center gap-2 px-2 py-1.5 rounded text-sm w-full transition-colors',
    isActive
      ? 'bg-accent text-accent-foreground'
      : 'text-foreground hover:bg-accent/50',
  );
}

export function SelectorRowContent({
  name,
  isActive,
}: {
  name: string;
  isActive: boolean;
}) {
  return (
    <>
      <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-semibold shrink-0">
        {name[0]?.toUpperCase() ?? '?'}
      </div>
      <span className="truncate">{name}</span>
      {isActive && <Check className="w-4 h-4 ml-auto shrink-0" />}
    </>
  );
}

export function SelectorSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{children}</div>
  );
}

export function SelectorDivider() {
  return <div className="border-t my-1.5" />;
}
