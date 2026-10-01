import { useEffect, useRef, useSyncExternalStore } from "react";
import { useNavigate } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useWorkspace } from "@/lib/workspace-context";
import { widthContainerClass, type DisplayWidth } from "@/lib/display-preference";

export function WorkTabs({ width }: { width: DisplayWidth }) {
  const workspace = useWorkspace();
  if (!workspace) return null;
  return <OpenedTabs workspace={workspace} width={width} />;
}
function OpenedTabs({
  workspace,
  width,
}: {
  workspace: NonNullable<ReturnType<typeof useWorkspace>>;
  width: DisplayWidth;
}) {
  const { store, active } = workspace;
  const { tabs } = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const navigate = useNavigate();
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    strip.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active?.key, tabs.length]);
  return (
    <nav aria-label="Open work tabs" className="border-b bg-white">
      <div
        ref={strip}
        className={`${widthContainerClass(width)} flex min-w-0 gap-1 overflow-x-auto py-1`}
      >
        {tabs.map((tab, index) => (
          <div
            key={tab.key}
            className={`inline-flex shrink-0 items-center rounded-md border text-sm ${active?.key === tab.key ? "border-teal-500 bg-teal-50 text-teal-900" : "border-transparent text-slate-600 hover:bg-slate-100"}`}
          >
            <button
              type="button"
              aria-label={`Open ${tab.label}`}
              aria-current={active?.key === tab.key ? "page" : undefined}
              onClick={() => void navigate({ to: tab.href, resetScroll: false })}
              className="min-h-10 px-3 font-medium"
            >
              {tab.label}
            </button>
            <button
              type="button"
              aria-label={`Close ${tab.label}`}
              className="grid min-h-10 min-w-10 place-items-center rounded-md hover:bg-red-50 hover:text-red-700"
              onClick={() => {
                const reason = store.closeReason(tab.key);
                if (reason) {
                  window.alert(reason);
                  return;
                }
                const confirmed =
                  !store.needsConfirmation(tab.key) ||
                  window.confirm("Close this tab and discard its unsaved changes?");
                if (!store.close(tab.key, confirmed)) return;
                if (active?.key === tab.key)
                  void navigate({
                    to: (tabs[index - 1] ?? tabs[index + 1])?.href ?? "/",
                    resetScroll: false,
                  });
              }}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </nav>
  );
}
