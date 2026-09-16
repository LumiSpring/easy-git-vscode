export type DiffLine = { type: "equal" | "add" | "del"; text: string };

export function diffLines(from: string, to: string): DiffLine[] {
  const left = from === "" ? [] : from.split("\n");
  const right = to === "" ? [] : to.split("\n");
  const n = left.length;
  const m = right.length;
  if (!n && !m) {
    return [];
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      const row = dp[i];
      const next = dp[i + 1];
      if (!row || !next) {
        continue;
      }
      row[j] = left[i] === right[j] ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      out.push({ type: "equal", text: left[i] ?? "" });
      i += 1;
      j += 1;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      out.push({ type: "del", text: left[i++] ?? "" });
    } else {
      out.push({ type: "add", text: right[j++] ?? "" });
    }
  }
  while (i < n) {
    out.push({ type: "del", text: left[i++] ?? "" });
  }
  while (j < m) {
    out.push({ type: "add", text: right[j++] ?? "" });
  }
  return out;
}
