import type { ReactNode } from "react";
import { CardInfoPopover } from "@/components/CardInfoPopover";

/** One compact title row; explanations stay accessible without taking page space. */
export function WorkspaceHeader({
  title,
  badge,
  help,
  actions,
  children,
}: {
  title: string;
  badge?: string;
  help: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="sticky top-[var(--hh-navigation-height,56px)] z-30 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gradient-to-r from-[#102A43] to-[#0F9D8A] px-3 py-2 text-white shadow-sm sm:px-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {badge ? (
          <span className="rounded-full bg-[#E5A93D] px-2 py-0.5 text-xs font-semibold text-[#102A43]">
            {badge}
          </span>
        ) : null}
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <CardInfoPopover label={`About ${title}`}>{help}</CardInfoPopover>
        {children}
      </div>
      {actions}
    </header>
  );
}
