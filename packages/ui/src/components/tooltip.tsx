import * as React from 'react';
import { Tooltip as BaseTooltip } from '@base-ui-components/react/tooltip';
import { cn } from '../lib/utils';

const TooltipRoot = BaseTooltip.Root;
const TooltipProvider = BaseTooltip.Provider;
const TooltipTrigger = BaseTooltip.Trigger;
const TooltipPortal = BaseTooltip.Portal;

const TooltipPositioner = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseTooltip.Positioner>
>(({ side = 'right', sideOffset = -8, ...props }, ref) => (
  <BaseTooltip.Positioner ref={ref} side={side} sideOffset={sideOffset} {...props} />
));
TooltipPositioner.displayName = 'TooltipPositioner';

const TooltipPopup = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseTooltip.Popup>
>(({ className, ...props }, ref) => (
  <BaseTooltip.Popup
    ref={ref}
    className={cn(
      'z-50 rounded-md border bg-popover text-popover-foreground px-2.5 py-1.5 text-sm shadow-md',
      className,
    )}
    {...props}
  />
));
TooltipPopup.displayName = 'TooltipPopup';

interface TooltipProps {
  label: React.ReactNode;
  children: React.ReactElement<Record<string, unknown>>;
  side?: React.ComponentPropsWithoutRef<typeof BaseTooltip.Positioner>['side'];
  sideOffset?: number;
  disabled?: boolean;
}

// Convenience shorthand for the common icon-with-label case. Wraps a single
// child element and shows `label` on hover/focus.
function Tooltip({ label, children, side, sideOffset, disabled }: TooltipProps) {
  return (
    <TooltipRoot disabled={disabled}>
      <TooltipTrigger render={children} />
      <TooltipPortal>
        <TooltipPositioner side={side} sideOffset={sideOffset}>
          <TooltipPopup>{label}</TooltipPopup>
        </TooltipPositioner>
      </TooltipPortal>
    </TooltipRoot>
  );
}

export {
  Tooltip,
  TooltipRoot,
  TooltipProvider,
  TooltipTrigger,
  TooltipPortal,
  TooltipPositioner,
  TooltipPopup,
};
