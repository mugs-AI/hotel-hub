import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Compact, click-to-open help used beside reservation-card titles. */
export function CardInfoPopover({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        aria-label={label}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-input bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ color: "#0F9D8A" }}
      >
        <Info className="h-3 w-3" aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-[var(--radix-popover-content-available-height)] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto text-sm leading-relaxed"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** The description stays in a touch/keyboard accessible popover beside its title. */
export function CardHeading({
  title,
  children,
  id,
}: {
  title: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <h2 id={id} className="text-base font-semibold" style={{ color: "#102A43" }}>
        {title}
      </h2>
      <CardInfoPopover label={`About ${title}`}>{children}</CardInfoPopover>
    </div>
  );
}
