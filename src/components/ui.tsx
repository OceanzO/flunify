import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/format";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 animate-fade-up md:flex-row md:items-end md:justify-between">
      <div>
        {eyebrow && <p className="mb-1 text-xs font-bold tracking-[0.14em] text-brand uppercase">{eyebrow}</p>}
        <h1 className="text-2xl font-extrabold tracking-tight text-navy md:text-3xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

type Tone = "brand" | "success" | "warning" | "navy";

const TONES: Record<Tone, string> = {
  brand: "bg-brand-light text-brand",
  success: "bg-success-light text-success",
  warning: "bg-warning-light text-warning",
  navy: "bg-navy/10 text-navy",
};

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "brand",
  delay = 0,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: Tone;
  delay?: number;
}) {
  return (
    <div
      className="card group p-5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lift animate-fade-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-muted">{label}</p>
        <span className={cn("grid h-10 w-10 place-items-center rounded-xl transition-transform group-hover:scale-110", TONES[tone])}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <p className="mt-3 text-3xl font-extrabold tracking-tight text-navy">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Badge({ children, tone = "brand", className }: { children: ReactNode; tone?: Tone | "danger" | "muted"; className?: string }) {
  const styles: Record<string, string> = {
    ...TONES,
    danger: "bg-danger-light text-danger",
    muted: "bg-canvas text-muted border border-line",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", styles[tone], className)}>
      {children}
    </span>
  );
}

export function SectionCard({
  icon: Icon,
  step,
  title,
  description,
  children,
  className,
}: {
  icon: LucideIcon;
  step?: number;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("card p-4 sm:p-5 animate-fade-up", className)}>
      <div className="mb-3.5 flex items-start gap-2.5">
        <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-light text-brand">
          <Icon className="h-4 w-4" />
          {step !== undefined && (
            <span className="absolute -top-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-navy text-[9px] font-bold text-white">
              {step}
            </span>
          )}
        </span>
        <div>
          <h2 className="text-sm font-bold text-navy leading-snug">{title}</h2>
          {description && <p className="text-xs text-muted leading-tight mt-0.5">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 flex items-start gap-1 text-xs font-medium text-danger">
      <span aria-hidden="true">⚠</span>
      {message}
    </p>
  );
}

export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-brand-light text-brand">
        <Icon className="h-7 w-7" />
      </span>
      <p className="font-bold text-navy">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-line/70", className)} />;
}
