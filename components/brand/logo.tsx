import { cn } from "@/lib/cn";

type LogoProps = {
  subtitle?: string;
  stacked?: boolean;
  className?: string;
  markClassName?: string;
};

export function ToothMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={cn("h-5 w-5", className)}
    >
      <path
        d="M12 3.2c2.1 0 3.7 1.15 4.55 2.2.7.86 1.2 1.95 1.55 2.85.28.72.1 1.5-.4 2.08-.42.48-1.02.77-1.65.77-.7 0-1.18-.28-1.55-.7-.3-.34-.5-.8-.7-1.28-.18.48-.4.94-.7 1.28-.37.42-.85.7-1.55.7s-1.18-.28-1.55-.7c-.3-.34-.52-.8-.7-1.28-.2.48-.4.94-.7 1.28-.37.42-.85.7-1.55.7-.63 0-1.23-.29-1.65-.77-.5-.58-.68-1.36-.4-2.08.35-.9.85-2 1.55-2.85C8.3 4.35 9.9 3.2 12 3.2Z"
        fill="currentColor"
      />
      <path
        d="M8.2 12.4c.55 1.85 1.15 4.2 1.7 5.55.3.72.9 1.2 1.55.95.5-.2.7-.75.55-1.35-.25-1.05-.2-2.4.05-3.15.3.9.7 2.05.55 3.15-.1.7.2 1.25.7 1.4.7.22 1.28-.3 1.55-1.05.5-1.3 1.05-3.55 1.55-5.4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export function Logo({ subtitle, stacked = true, className, markClassName }: LogoProps) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-primary text-white",
          markClassName,
        )}
      >
        <ToothMark className="h-[22px] w-[22px]" />
      </span>
      <span className={cn("leading-tight", stacked ? "" : "flex items-baseline gap-1.5")}>
        <span className="block font-heading text-[17px] font-bold tracking-tight text-primary">
          SmartCare
        </span>
        {subtitle ? (
          <span className="block text-[11px] font-medium leading-tight text-muted">
            {subtitle}
          </span>
        ) : null}
      </span>
    </div>
  );
}
