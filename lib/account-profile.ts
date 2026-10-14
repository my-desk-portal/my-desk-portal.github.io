import { tevDivisions, type TevDivision } from "@/lib/mytev";

export type AccountProfileFields = {
  office?: unknown;
  assignment?: unknown;
  projectProgram?: unknown;
  unit?: unknown;
  profileFieldsVersion?: unknown;
};

export const accountOfficeOptions = [
  "Field Operations Division",
  "Regional Field Office",
] as const;

export const accountPositionOptions = [
  "Administrative Aide I",
  "Administrative Aide II",
  "Administrative Aide III",
  "Administrative Aide IV",
  "Administrative Aide V",
  "Administrative Aide VI",
  "Administrative Assistant I",
  "Administrative Assistant II",
  "Administrative Assistant III",
  "Administrative Assistant IV",
  "Administrative Assistant V",
  "Administrative Assistant VI",
  "Agricultural and Biosystems Engineer I",
  "Agricultural and Biosystems Engineer II",
  "Agricultural and Biosystems Engineer III",
  "Agricultural and Biosystems Engineer IV",
  "Agricultural and Biosystems Engineer V",
  "Agricultural Technician I",
  "Agricultural Technician II",
  "Agricultural Technologist",
  "Associate Project Officer I",
  "Associate Project Officer II",
  "Agriculturist I",
  "Agriculturist II",
  "Chief Agriculturist",
  "Community Development Officer I",
  "Community Development Officer II",
  "Community Development Officer III",
  "Computer Programmer I",
  "Computer Programmer II",
  "Computer Programmer III",
  "Data Controller I",
  "Data Controller II",
  "Data Controller III",
  "Data Controller IV",
  "Development Management Officer I",
  "Development Management Officer II",
  "Development Management Officer III",
  "Development Management Officer IV",
  "Development Management Officer V",
  "Engineer I",
  "Engineer II",
  "Engineer III",
  "Engineer IV",
  "Engineer V",
  "Information Officer I",
  "Information Officer II",
  "Information Officer III",
  "Information Systems Analyst I",
  "Information Systems Analyst II",
  "Information Systems Analyst III",
  "Piece Worker Warehouseman",
  "Project Development Officer I",
  "Project Development Officer II",
  "Project Development Officer III",
  "Project Development Officer IV",
  "Project Development Officer V",
  "Project Evaluation Officer I",
  "Project Evaluation Officer II",
  "Project Evaluation Officer III",
  "Project Evaluation Officer IV",
  "Project Evaluation Officer V",
  "Senior Administrative Assistant I",
  "Senior Administrative Assistant II",
  "Senior Administrative Assistant III",
  "Senior Administrative Assistant IV",
  "Senior Agriculturist",
  "Supervising Agriculturist",
  "Warehouseman",
] as const;

export const accountDesignationOptions = [
  "Chief",
  "OIC APCO - ADN / SAAD",
  "APCO - ADS Chief",
  "APCO - SDN Chief",
  "OIC APCO - SDS",
  "OIC APCO - PDI",
  "APCO - ADN Alternate",
  "APCO - ADS Alternate",
  "APCO - SDN Alternate",
  "APCO - SDS Alternate",
  "APCO - PDI Alternate",
  "SAAD Program Focal Person",
  "NUPAP Coordinator / ELCAC",
  "ELCAC Focal Person",
  "OAP Coordinator",
  "Livestock Program Coordinator",
  "Corn & Soybean Program Coordinator",
  "FOD Alternate / Rice Program Coordinator",
  "HVCD/CFIDP/IPM Program Coordinator",
  "Alternate Rice Program / Alternate AGRISTAT",
  "Alternate Corn Program",
  "Alternate Livestock Program",
  "Alternate HVCD Program",
  "AGRISTAT/DRRM/AMIA Project Leader",
  "Halal Project Leader & GAD",
  "F2C2",
  "Alternate OAP / 4K Program Coordinator",
  "RSBSA & Extension and Partnership",
  "DRRM Procurement & Budget Officer",
  "DRRM Procurement & Planning Officer",
  "DRRM Early Response & Recovery",
  "DRRM Rehabilitation & Recovery",
  "AMIA - Report Officer",
  "AMIA - Planning Officer",
  "AMIA - Comm. Point Person",
  "AMIA - Machineries and Infrastructure",
  "AMIA - ACAP Developer",
  "AMIA - Procurement Officer",
  "AMIA - Clerical Support Staff",
  "AMIA - ADN Focal Person",
  "AMIA - ADS Focal Person",
  "AMIA - SDN Focal Person",
  "AMIA - SDS Focal Person",
  "AMIA - PDI Focal Person",
  "RCMO - Data Analyst",
  "RCMO - Team Lead",
  "PCMO - ADN",
  "PCMO - ADS",
  "PCMO - SDN",
  "PCMO - PDI",
  "PCMO - SDS",
] as const;

export function accountDesignation(value: unknown) {
  if (typeof value !== "string") return "";
  const cleaned = value.trim();
  if (!cleaned) return "";
  if (accountDesignationOptions.some((option) => option === cleaned)) return cleaned;
  const values = [...new Set(value.split(";").map((designation) => designation.trim()).filter(Boolean))];
  if (values.includes("Chief")) return "Chief";
  return values.find((designation) => accountDesignationOptions.some((option) => option === designation)) ?? cleaned;
}

export function hasAccountDesignation(value: unknown, designation: string) {
  return accountDesignation(value) === designation;
}

export const fieldOperationsCombinedAssignment = "AGRISTAT-AMIA-DRRM";

export const fieldOperationsAssignments = [
  "4K",
  "AGRISTAT",
  "AMIA",
  "DRRM",
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

export const regionalFieldOfficeAssignments = [
  ...tevDivisions,
  "Regional Executive Director",
  "RTD for Operations",
  "RTD for Research and Regulations",
].sort((first, second) => first.localeCompare(second));

export function assignmentsForOffice(office: string) {
  if (office === "Field Operations Division") return fieldOperationsAssignments;
  if (office === "Regional Field Office") return regionalFieldOfficeAssignments;
  return [] as const;
}

const divisionByLegacyAssignment: Record<string, string> = {
  AMIA: "Agribusiness and Marketing Assistance Division",
  AGRISTAT: "Planning, Monitoring and Evaluation Division",
  DRRM: "Disaster Risk Reduction and Management Division",
};

export function accountDivisionForApproval(office: string, assignment: string) {
  const selected = accountProfileSelection({ office, assignment, profileFieldsVersion: 3 });
  const normalizedOffice = selected.office ?? "";
  const normalizedAssignment = selected.assignment.trim().toUpperCase();
  if (normalizedOffice === "Regional Field Office") return assignment.trim();
  if (normalizedOffice === "Field Operations Division" && normalizedAssignment in divisionByLegacyAssignment) {
    return divisionByLegacyAssignment[normalizedAssignment] ?? "";
  }
  return divisionByLegacyAssignment[normalizedOffice.replace(/^FOD-/i, "").toUpperCase()] ?? normalizedOffice;
}

export function accountTevDivision(office: string, assignment: string): TevDivision | null {
  const normalizedOffice = office.trim();
  const normalizedAssignment = assignment.trim();
  if (normalizedOffice === "Regional Field Office" && tevDivisions.includes(normalizedAssignment as TevDivision)) {
    return normalizedAssignment as TevDivision;
  }
  if (
    normalizedOffice === "Field Operations Division"
    || /^FOD-/i.test(normalizedOffice)
    || ["AGRISTAT", "AMIA", "DRRM"].includes(normalizedOffice.toUpperCase())
  ) {
    return "Field Operations Division";
  }
  return tevDivisions.includes(normalizedAssignment as TevDivision) ? normalizedAssignment as TevDivision : null;
}

export function accountProfileSelection(profile: AccountProfileFields) {
  const storedOffice = accountOffice(profile) ?? "";
  const storedAssignment = accountAssignment(profile);

  const normalizedStoredOffice = storedOffice.trim();
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

  return { office: "", assignment: "" };
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

// Version 2 stored Office in `office` and Assignment under its former
// `projectProgram` field. Version 3 keeps the same values in clearly named fields.
export function accountOffice(profile: AccountProfileFields) {
  const version = typeof profile.profileFieldsVersion === "number" ? profile.profileFieldsVersion : 0;
  let office: string;
  if (version >= 2) {
    office = stringValue(profile.office) || stringValue(profile.projectProgram);
  } else {
    office = stringValue(profile.projectProgram)
      || stringValue(profile.unit)
      || stringValue(profile.office);
  }
  return canonicalFieldOperationsOffice(office) || null;
}

export function accountAssignment(profile: AccountProfileFields) {
  const version = typeof profile.profileFieldsVersion === "number" ? profile.profileFieldsVersion : 0;
  const assignment = version >= 3
    ? stringValue(profile.assignment)
    : version === 2
      ? stringValue(profile.projectProgram) || stringValue(profile.unit)
      : stringValue(profile.unit) || stringValue(profile.office) || stringValue(profile.projectProgram);
  if (assignment === fieldOperationsCombinedAssignment) return "";
  return fieldOperationsAssignmentAlias(assignment)
    || assignment
    || fieldOperationsAssignmentAlias(rawAccountOffice(profile));
}

function rawAccountOffice(profile: AccountProfileFields) {
  const version = typeof profile.profileFieldsVersion === "number" ? profile.profileFieldsVersion : 0;
  return version >= 2
    ? stringValue(profile.office) || stringValue(profile.projectProgram)
    : stringValue(profile.projectProgram) || stringValue(profile.unit) || stringValue(profile.office);
}

function canonicalFieldOperationsOffice(value: string) {
  const normalized = value.trim();
  return normalized === "Field Operations Division (ILD)"
    || normalized.toUpperCase() === "AGRISTAT"
    || normalized.toUpperCase() === "AMIA"
    || normalized.toUpperCase() === "DRRM"
    || /^FOD-/i.test(normalized)
    ? "Field Operations Division"
    : normalized;
}

function fieldOperationsAssignmentAlias(value: string) {
  const normalized = value.trim().toUpperCase();
  const assignment = normalized.startsWith("FOD-") ? normalized.slice(4) : normalized;
  return ["AGRISTAT", "AMIA", "DRRM"].find((option) => option === assignment) ?? "";
}

export function migratedAccountProfileFields(profile: AccountProfileFields) {
  return {
    office: accountOffice(profile),
    assignment: accountAssignment(profile),
    profileFieldsVersion: 3,
  };
}
