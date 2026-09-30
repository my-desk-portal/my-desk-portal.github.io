export function displayPermitNumber(permitNo: string) {
  return permitNo.replace(/^(?:AMIA|AGRISTAT|DRRM)-(?=\d{4}-\d{4,}(?:__|$))/, "");
}
