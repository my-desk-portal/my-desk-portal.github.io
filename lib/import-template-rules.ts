export const importTemplateDateRange = {
  minimum: "2026-01-01",
  maximum: "2027-12-31",
} as const;

export const importTemplateTimeRange = {
  minimum: "05:00",
  maximum: "20:00",
} as const;

export function isWithinImportTemplateDateRange(value: string) {
  return value >= importTemplateDateRange.minimum && value <= importTemplateDateRange.maximum;
}

export function isWithinImportTemplateTimeRange(value: string) {
  return value >= importTemplateTimeRange.minimum && value <= importTemplateTimeRange.maximum;
}
