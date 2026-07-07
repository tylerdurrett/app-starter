import { Link } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import { cn, Tooltip } from '@repo/ui';

type NavTileProps = {
  label: string;
  icon: LucideIcon;
  active: boolean;
  to: string;
  params?: Record<string, string>;
};

export function NavTile({ label, icon: Icon, active, to, params }: NavTileProps) {
  return (
    <Tooltip label={label}>
      {/* Link's props are keyed off a literal `to` union; widening `to` to string here breaks that inference, so cast through unknown. Runtime behavior is unaffected. */}
      <Link
        to={to as unknown as never}
        params={params as unknown as never}
        className={cn(
          'flex flex-col items-center justify-center py-2 px-2 transition-colors',
          active
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
        )}
      >
        <div className="w-14 h-14 rounded-md bg-muted flex items-center justify-center mb-1">
          <Icon className="w-6 h-6" />
        </div>
        <span className="text-xs">{label}</span>
      </Link>
    </Tooltip>
  );
}
