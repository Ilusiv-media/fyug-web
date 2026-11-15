// The step list the page shows and the text report built from it.

export type Status = "pass" | "fail" | "info" | "skip";

export type Result = {
  id: string;
  title: string;
  status: Status;
  detail: string;
  ms?: number;
};

export type Violation = {
  directive: string;
  blocked: string;
  policy: string;
};

const results: Result[] = [];
const violations: Violation[] = [];
const listeners: Array<() => void> = [];

export function onChange(listener: () => void): void {
  listeners.push(listener);
}

function changed(): void {
  for (const listener of listeners) listener();
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/** Records a result, replacing an earlier one with the same id. */
export function record(result: Result): void {
  const at = results.findIndex((r) => r.id === result.id);
  if (at >= 0) results[at] = result;
  else results.push(result);
  changed();
}

/** Runs `fn` as a step: its return value is the detail, a throw is a fail. */
export async function step(
  id: string,
  title: string,
  fn: () => Promise<string | { status: Status; detail: string }>,
): Promise<boolean> {
  const started = performance.now();
  try {
    const out = await fn();
    const { status, detail } =
      typeof out === "string" ? { status: "pass" as Status, detail: out } : out;
    record({ id, title, status, detail, ms: performance.now() - started });
    return status !== "fail";
  } catch (error) {
    record({
      id,
      title,
      status: "fail",
      detail: describeError(error),
      ms: performance.now() - started,
    });
    return false;
  }
}

export function allResults(): readonly Result[] {
  return results;
}

export function watchViolations(): void {
  document.addEventListener("securitypolicyviolation", (event) => {
    violations.push({
      directive: event.effectiveDirective,
      blocked: event.blockedURI,
      policy: event.originalPolicy,
    });
    changed();
  });
}

export function allViolations(): readonly Violation[] {
  return violations;
}

export function reportText(header: string[]): string {
  const lines = [...header, ""];
  for (const r of results) {
    const time = r.ms === undefined ? "" : ` (${Math.round(r.ms)} ms)`;
    lines.push(`[${r.status.toUpperCase()}] ${r.id}: ${r.title}${time}`);
    for (const detail of r.detail.split("\n")) lines.push(`    ${detail}`);
  }
  const seen = new Set<string>();
  const unique = violations.filter((v) => {
    const key = `${v.directive} ${v.blocked}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  lines.push("", `CSP violations seen by the page: ${unique.length}`);
  for (const v of unique) lines.push(`    ${v.directive} blocked ${v.blocked}`);
  if (violations.length > 0) {
    lines.push("Policy as reported by the first violation:");
    lines.push(`    ${violations[0].policy}`);
  }
  return lines.join("\n");
}
