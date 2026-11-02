import Link from "next/link";
import type { ReactNode } from "react";
import { rub } from "@/server/money";
import { label } from "@/server/domain/labels";

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><h1 className="text-xl font-semibold sm:text-2xl">{title}</h1>{subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}</div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, actions, className = "" }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && <div className="mb-3 flex flex-wrap items-center justify-between gap-2">{title && <h2 className="text-base font-semibold">{title}</h2>}{actions}</div>}
      {children}
    </section>
  );
}

const TONE: Record<string, string> = {
  ok: "bg-ok-soft text-ok border-ok/30", warn: "bg-warn-soft text-warn border-warn/30", bad: "bg-bad-soft text-bad border-bad/30", info: "bg-accent-soft text-accent border-accent/30", muted: "bg-bg text-muted border-line",
};
const ICON: Record<string, string> = { ok: "✓", warn: "!", bad: "✕", info: "•", muted: "○" };
const toneFor = (v: string) => {
  if (/^(COMPLETED|CONCLUDED|ACTIVE|PAID|SUCCEEDED|VERIFIED|PUBLISHED|CLEAN|APPROVED|MET|RECEIVED|CONFIRMED|SENT|RESOLVED|DONE)$/.test(v)) return "ok";
  if (/^(NEEDS_INFO|NEEDS_DATA|PAST_DUE|GRACE|UNKNOWN|PENDING|QUARANTINE|SPECIALIST_REVIEW|DISPUTED|AWAITING_CARRIER|PENDING_START|RESERVED|TRIAL|WAITING_INFO|HIGH|DRAFT_SAVED)$/.test(v)) return "warn";
  if (/^(CANCELLED|FAILED|REJECTED|EXPIRED|WITHDRAWN|RESTRICTED|ENDED|TERMINATED|REVOKED|BLOCKED|NOT_MET|CRITICAL|DEAD|REVERSED)$/.test(v)) return "bad";
  if (/^(DRAFT|REPLACED|ARCHIVED|SCHEDULED)$/.test(v)) return "muted";
  return "info";
};

/** Статус: текст + значок (не только цвет) — AC31. */
export function Status({ group, value, text }: { group?: string; value: string | null | undefined; text?: string }) {
  const v = value ?? "—";
  const tone = toneFor(v);
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${TONE[tone]}`}><span aria-hidden>{ICON[tone]}</span>{text ?? (group ? label(group, v) : v)}</span>;
}

export const Money = ({ kop, className = "" }: { kop: number | null | undefined; className?: string }) => <span className={`num ${className}`}>{rub(kop)}</span>;

export function fmtDate(d: Date | string | null | undefined, withTime = false, tz = "Europe/Moscow") {
  if (!d) return "—";
  const x = typeof d === "string" ? new Date(d) : d;
  return x.toLocaleString("ru-RU", withTime ? { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" } : { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric" });
}

export function KV({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
      {items.map(([k, v], i) => (<div key={i} className="contents"><dt className="text-muted">{k}</dt><dd className="mb-1 break-words sm:mb-0">{v}</dd></div>))}
    </dl>
  );
}

export function Empty({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line bg-white p-6 text-center"><p className="font-medium">{title}</p>{text && <p className="mt-1 text-sm text-muted">{text}</p>}{action && <div className="mt-3">{action}</div>}</div>;
}

export function Alert({ tone = "info", title, children }: { tone?: "info" | "warn" | "bad" | "ok"; title?: string; children: ReactNode }) {
  return <div role={tone === "bad" ? "alert" : "status"} className={`rounded-md border px-3 py-2 text-sm ${TONE[tone]}`}>{title && <p className="font-semibold">{ICON[tone]} {title}</p>}<div className={title ? "mt-1" : ""}>{children}</div></div>;
}

export function DemoNote({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-xs text-warn">Демонстрация: {children}</p>;
}

export function LinkBtn({ href, children, variant = "secondary" }: { href: string; children: ReactNode; variant?: "primary" | "secondary" }) {
  return <Link href={href} className={`btn btn-${variant} no-underline hover:no-underline`}>{children}</Link>;
}

export function Table({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty?: string }) {
  if (!rows.length) return <Empty title={empty ?? "Пока пусто"} />;
  return (
    <div className="overflow-x-auto"><table className="tbl tbl-stack">
      <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} data-label={head[j]}>{c}</td>)}</tr>)}</tbody>
    </table></div>
  );
}
