import { tevDivisions } from "@/lib/mytev";

export type AccountProfileFields = {
  office?: unknown;
  assignment?: unknown;
  projectProgram?: unknown;
  unit?: unknown;
  profileFieldsVersion?: unknown;
};

export const accountOfficeOptions = [
  "Field Operations Division",
  "Field Operations Division (ILD)",
  "Regional Field Office",
] as const;

export const fieldOperationsAssignments = [
  "4K",
  "APCO - ADN",
  "APCO - ADS",
  "APCO - PDI",
  "APCO - SDN",
  "APCO - SDS",
  "Corn Program",
  "ELCAC",
  "Extension and Partnership",
  "F2C2",
  "GAD",
  "HVCDP Program",
  "Livestock Program",
  "NUPAP",
  "Organic Agriculture Program",
  "Rice Program",
  "RSBSA",
  "SAAD",
] as const;

export const fieldOperationsIldAssignments = ["AGRISTAT", "AMIA", "DRRM"] as const;

export const regionalFieldOfficeAssignments = [...tevDivisions].sort((first, second) => first.localeCompare(second));

export function assignmentsForOffice(office: string) {
  if (office === "Field Operations Division") return fieldOperationsAssignments;
  if (office === "Field Operations Division (ILD)") return fieldOperationsIldAssignments;
  if (office === "Regional Field Office") return regionalFieldOfficeAssignments;
  return [] as const;
}

const divisionByLegacyAssignment: Record<string, string> = {
  AMIA: "Agribusiness and Marketing Assistance Division",
  AGRISTAT: "Planning, Monitoring and Evaluation Division",
  DRRM: "Disaster Risk Reduction and Management Division",
};

export function accountDivisionForApproval(office: string, assignment: string) {
  const normalizedOffice = office.trim();
  const normalizedAssignment = assignment.trim().toUpperCase();
  if (normalizedOffice === "Regional Field Office") return assignment.trim();
  if (normalizedOffice === "Field Operations Division (ILD)"
    || (normalizedOffice === "Field Operations Division" && normalizedAssignment in divisionByLegacyAssignment)) {
    return divisionByLegacyAssignment[normalizedAssignment] ?? "";
  }
  return divisionByLegacyAssignment[normalizedOffice.replace(/^FOD-/i, "").toUpperCase()] ?? normalizedOffice;
}

export function accountProfileSelection(profile: AccountProfileFields) {
  const storedOffice = accountOffice(profile) ?? "";
  const storedAssignment = accountAssignment(profile);

  const normalizedStoredOffice = storedOffice.trim();
  const storedAssignmentUpper = storedAssignment?.toUpperCase() ?? "";
  const isLegacyIldOffice = /^FOD-(AGRISTAT|AMIA|DRRM)$/i.test(normalizedStoredOffice)
    || ["AGRISTAT", "AMIA", "DRRM"].includes(normalizedStoredOffice.toUpperCase())
    || (normalizedStoredOffice === "Field Operations Division" && Boolean(divisionByLegacyAssignment[storedAssignmentUpper]));
  if (isLegacyIldOffice) {
    const assignment = divisionByLegacyAssignment[storedAssignmentUpper]
      ? storedAssignmentUpper
      : divisionByLegacyAssignment[normalizedStoredOffice.replace(/^FOD-/i, "").toUpperCase()]
        ? normalizedStoredOffice.replace(/^FOD-/i, "").toUpperCase()
        : "";
    return { office: "Field Operations Division (ILD)", assignment };
  }

  if (accountOfficeOptions.includes(storedOffice as (typeof accountOfficeOptions)[number])) {
    const validAssignments = assignmentsForOffice(storedOffice);
    return {
      office: storedOffice,
      assignment: validAssignments.some((option) => option === storedAssignment) ? storedAssignment : "",
    };
  }

  if (regionalFieldOfficeAssignments.includes(normalizedStoredOffice as (typeof regionalFieldOfficeAssignments)[number])) {
    return {
      office: "Regional Field Office",
      assignment: regionalFieldOfficeAssignments.includes(storedAssignment as (typeof regionalFieldOfficeAssignments)[number])
        ? storedAssignment
        : normalizedStoredOffice,
    };
  }

  if (/^FOD-/i.test(normalizedStoredOffice)) {
    return {
      office: "Field Operations Division",
      assignment: fieldOperationsAssignments.includes(storedAssignment as (typeof fieldOperationsAssignments)[number])
        ? storedAssignment
        : "",
    };
  }

  return { office: "", assignment: "" };
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

// Version 2 stored Office in `office` and Assignment under its former
// `projectProgram` field. Version 3 keeps the same values in clearly named fields.
export function accountOffice(profile: AccountProfileFields) {
  const version = typeof profile.profileFieldsVersion === "number" ? profile.profileFieldsVersion : 0;
  if (version >= 2) {
    return stringValue(profile.office) || stringValue(profile.projectProgram) || null;
  }
  return stringValue(profile.projectProgram)
    || stringValue(profile.unit)
    || stringValue(profile.office)
    || null;
}

export function accountAssignment(profile: AccountProfileFields) {
  const version = typeof profile.profileFieldsVersion === "number" ? profile.profileFieldsVersion : 0;
  if (version >= 3) return stringValue(profile.assignment);
  if (version === 2) return stringValue(profile.projectProgram) || stringValue(profile.unit);
  return stringValue(profile.unit) || stringValue(profile.office) || stringValue(profile.projectProgram);
}

export function migratedAccountProfileFields(profile: AccountProfileFields) {
  return {
    office: accountOffice(profile),
    assignment: accountAssignment(profile),
    profileFieldsVersion: 3,
  };
}
