import { cn } from "@/lib/cn";

export function EmptyState({
  title,
  description,
  className,
}: {
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-card border border-dashed border-border bg-white p-8 text-center shadow-card",
        className,
      )}
    >
      <h2 className="font-heading text-[17px] font-semibold text-heading">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-muted">{description}</p>
    </div>
  );
}

export function PageHeader({
  kicker,
  title,
  description,
}: {
  kicker?: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-6">
      {kicker ? (
        <p className="mb-1 text-[12px] font-semibold text-primary">{kicker}</p>
      ) : null}
      <h1 className="font-heading text-[32px] font-bold tracking-tight text-heading">{title}</h1>
      {description ? <p className="mt-1 text-[14px] text-muted">{description}</p> : null}
    </div>
  );
}
