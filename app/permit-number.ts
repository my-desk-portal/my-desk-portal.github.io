export function displayPermitNumber(permitNo: string) {
  return permitNo.replace(/^(?:AMIA|AGRISTAT|DRRM)-(?=\d{4}-\d{4,}(?:__|$))/, "");
}

export function assignApprovedPermitNumbers(permits: { permitNo: string }[]) {
  const byYear = new Map<string, { originalNumber: string; sequence: number }[]>();

  permits.forEach(({ permitNo }) => {
    const originalNumber = displayPermitNumber(permitNo);
    const match = /^(\d{4})-(\d{4,})(?:__.*)?$/.exec(originalNumber);
    if (!match) return;
    const [, year, sequenceText] = match;
    const entries = byYear.get(year) ?? [];
    entries.push({ originalNumber, sequence: Number(sequenceText) });
    byYear.set(year, entries);
  });

  const assignedNumbers: Record<string, string> = {};
  byYear.forEach((entries, year) => {
    entries.sort((left, right) => left.sequence - right.sequence || left.originalNumber.localeCompare(right.originalNumber));
    entries.forEach(({ originalNumber }, index) => {
      assignedNumbers[originalNumber] = `${year}-${String(index + 1).padStart(4, "0")}`;
    });
  });
  return assignedNumbers;
}
