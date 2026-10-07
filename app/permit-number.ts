export function displayPermitNumber(permitNo: string | null | undefined) {
  if (typeof permitNo !== "string") return "";
  return permitNo.replace(/^(?:AMIA|AGRISTAT|DRRM)-(?=\d{4}-\d{4,}(?:__|$))/, "");
}

export function permitNumberYear(permitNo: string | null | undefined, permitDate?: string) {
  const permitNumberMatch = /^(\d{4})-\d{4,}(?:__.*)?$/.exec(displayPermitNumber(permitNo));
  const permitDateMatch = /^(\d{4})-\d{2}-\d{2}$/.exec(permitDate ?? "");
  return permitNumberMatch?.[1] ?? permitDateMatch?.[1] ?? String(new Date().getFullYear());
}

export function highestApprovedPermitSequence(permitNumbers: Record<string, string>, year: string) {
  return Object.values(permitNumbers).reduce((highest, permitNo) => {
    const match = /^(\d{4})-(\d{4,})$/.exec(permitNo);
    return match?.[1] === year ? Math.max(highest, Number(match[2])) : highest;
  }, 0);
}

export function assignApprovedPermitNumbers(permits: { permitNo: string; approvedPermitNo?: string }[]) {
  const byYear = new Map<string, { originalNumber: string; sequence: number; approvedPermitNo?: string }[]>();

  permits.forEach(({ permitNo, approvedPermitNo }) => {
    const originalNumber = displayPermitNumber(permitNo);
    const match = /^(\d{4})-(\d{4,})(?:__.*)?$/.exec(originalNumber);
    if (!match) return;
    const [, year, sequenceText] = match;
    const entries = byYear.get(year) ?? [];
    const approvedMatch = /^(\d{4})-(\d{4,})$/.exec(displayPermitNumber(approvedPermitNo));
    entries.push({
      originalNumber,
      sequence: Number(sequenceText),
      approvedPermitNo: approvedMatch?.[1] === year ? `${year}-${String(Number(approvedMatch[2])).padStart(4, "0")}` : undefined,
    });
    byYear.set(year, entries);
  });

  const assignedNumbers: Record<string, string> = {};
  byYear.forEach((entries, year) => {
    entries.sort((left, right) => left.sequence - right.sequence || left.originalNumber.localeCompare(right.originalNumber));
    const usedSequences = new Set<number>();
    entries.forEach(({ originalNumber, approvedPermitNo }) => {
      if (!approvedPermitNo) return;
      assignedNumbers[originalNumber] = approvedPermitNo;
      usedSequences.add(Number(approvedPermitNo.slice(5)));
    });
    let nextSequence = 1;
    entries.forEach(({ originalNumber, approvedPermitNo }) => {
      if (approvedPermitNo) return;
      while (usedSequences.has(nextSequence)) nextSequence += 1;
      assignedNumbers[originalNumber] = `${year}-${String(nextSequence).padStart(4, "0")}`;
      usedSequences.add(nextSequence);
      nextSequence += 1;
    });
  });
  return assignedNumbers;
}
