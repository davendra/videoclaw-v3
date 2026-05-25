export type DueRisk = 'none' | 'soon' | 'overdue';

export function deriveDueRisk(
  dueDate: string | null | undefined,
  now: Date = new Date(),
): DueRisk {
  if (!dueDate) return 'none';
  const parsed = new Date(`${dueDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return 'none';

  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const msPerDay = 24 * 60 * 60 * 1000;
  const deltaDays = Math.floor((parsed.getTime() - today.getTime()) / msPerDay);

  if (deltaDays < 0) return 'overdue';
  if (deltaDays <= 7) return 'soon';
  return 'none';
}
