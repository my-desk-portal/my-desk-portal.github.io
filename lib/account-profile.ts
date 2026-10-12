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
  "Agriculturist I",
  "Agriculturist II",
  "Chief Agriculturist",
  "Computer Programmer I",
  "Computer Programmer II",
  "Computer Programmer III",
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
  "Information Systems Analyst I",
  "Information Systems Analyst II",
  "Information Systems Analyst III",
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
  "Senior Agriculturist",
  "Supervising Agriculturist",
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
  "AGRISTAT Alternate",
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

export const fieldOperationsAssignments = [
  "4K",
  "AGRISTAT-AMIA-DRRM",
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
