import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { isSuperadminRole } from "@/lib/user-roles";
import { accountOffice, accountAssignment, accountDesignation, accountProfileSelection, fieldOperationsIldAssignments } from "@/lib/account-profile";

export type PersonnelEntry = { userId: string; name: string; position: string; office: string; unit: string; accountRole?: string; accountStatus?: string };
export type PermitAdminSignatory = { userId: string; name: string; position: string; office: string; assignment: string; designation: string };

export function isApprovedAdminAccount(accountRole: unknown, accountStatus: unknown) {
  return accountRole === "admin" && (accountStatus === undefined || accountStatus === null || accountStatus === "Approved");
}

export function personnelDisplayName(person: Pick<PersonnelEntry, "name">) {
  return person.name;
}

export function personnelMatchesAccountScope(
  candidateOffice: string,
  candidateAssignment: string,
  office: string,
  assignment: string,
  options: { includeAdminAccounts?: boolean; accountRole?: unknown; accountStatus?: unknown } = {},
) {
  if (options.includeAdminAccounts && isApprovedAdminAccount(options.accountRole, options.accountStatus)) return true;
  const scope = accountProfileSelection({ office, assignment, profileFieldsVersion: 3 });
  const candidate = accountProfileSelection({ office: candidateOffice, assignment: candidateAssignment, profileFieldsVersion: 3 });
  if (!scope.office || candidate.office !== scope.office) return false;
  if (scope.office === "Field Operations Division (ILD)") {
    return fieldOperationsIldAssignments.includes(candidate.assignment as (typeof fieldOperationsIldAssignments)[number]);
  }
  return Boolean(scope.assignment && candidate.assignment === scope.assignment);
}

export function filterPersonnelForAccount(entries: PersonnelEntry[], office: string, assignment: string, options: { includeAdminAccounts?: boolean } = {}) {
  return entries.filter((person) => personnelMatchesAccountScope(person.office, person.unit, office, assignment, {
    ...options,
    accountRole: person.accountRole,
    accountStatus: person.accountStatus,
  }));
}

const personnelCacheDurationMs = 60_000;
const cachedPersonnel = new Map<boolean, { entries: PersonnelEntry[]; expiresAt: number }>();
const personnelRequests = new Map<boolean, Promise<PersonnelEntry[]>>();
let cachedPermitAdminSignatories: { entries: PermitAdminSignatory[]; expiresAt: number } | null = null;
let permitAdminSignatoriesRequest: Promise<PermitAdminSignatory[]> | null = null;

export async function loadPermitAdminSignatories(): Promise<PermitAdminSignatory[]> {
  if (!db) throw new Error("Firebase is not configured.");
  if (cachedPermitAdminSignatories && cachedPermitAdminSignatories.expiresAt > Date.now()) {
    return cachedPermitAdminSignatories.entries;
  }
  const pendingRequest = permitAdminSignatoriesRequest;
  if (pendingRequest) return pendingRequest;
  const firestore = db;
  const request = getDocs(collection(firestore, "users")).then((snapshot) => {
    const entries = snapshot.docs.flatMap((item) => {
      const data = item.data();
      if (data.accountRole !== "admin" || (data.accountStatus !== undefined && data.accountStatus !== "Approved")) return [];
      const profile = accountProfileSelection(data);
      const name = typeof data.name === "string" ? data.name.trim() : "";
      if (!name || !profile.office) return [];
      return [{
        userId: item.id,
        name,
        position: typeof data.position === "string" ? data.position.trim() : "",
        office: profile.office,
        assignment: profile.assignment,
        designation: accountDesignation(data.designation),
      }];
    }).sort((first, second) => first.name.localeCompare(second.name, "en", { sensitivity: "base" })
      || first.userId.localeCompare(second.userId));
    cachedPermitAdminSignatories = { entries, expiresAt: Date.now() + personnelCacheDurationMs };
    return entries;
  }).finally(() => {
    permitAdminSignatoriesRequest = null;
  });
  permitAdminSignatoriesRequest = request;
  return request;
}

// Personnel dropdowns are built from registered user accounts (users collection).
export async function loadPersonnel(options: { includeAllAccounts?: boolean } = {}): Promise<PersonnelEntry[]> {
  if (!db) throw new Error("Firebase is not configured.");
  const includeAllAccounts = options.includeAllAccounts ?? false;
  const cached = cachedPersonnel.get(includeAllAccounts);
  if (cached && cached.expiresAt > Date.now()) return cached.entries;
  let personnelRequest = personnelRequests.get(includeAllAccounts);
  if (!personnelRequest) {
    const firestore = db;
    personnelRequest = getDocs(collection(firestore, "users")).then((snapshot) => {
      const entries = snapshot.docs.filter((item) => includeAllAccounts || !isSuperadminRole(item.data().accountRole)).map((item) => {
        const data = item.data();
        return {
          userId: item.id,
          name: typeof data.name === "string" ? data.name.trim() : "",
          position: typeof data.position === "string" ? data.position.trim() : "",
          office: accountOffice(data) ?? "",
          unit: accountAssignment(data),
          accountRole: typeof data.accountRole === "string" ? data.accountRole : undefined,
          accountStatus: typeof data.accountStatus === "string" ? data.accountStatus : undefined,
        };
      }).filter((person) => person.name);
      const unique = new Map<string, PersonnelEntry>();
      const adminAccounts: PersonnelEntry[] = [];
      for (const entry of entries) {
        if (isApprovedAdminAccount(entry.accountRole, entry.accountStatus)) {
          adminAccounts.push(entry);
          continue;
        }
        const key = entry.name.toLowerCase().replace(/\s+/g, " ");
        const existing = unique.get(key);
        if (!existing || (!existing.position && entry.position) || (!existing.office && entry.office) || (!existing.unit && entry.unit)) unique.set(key, entry);
      }
      const result = [...unique.values(), ...adminAccounts].sort((first, second) => first.name.localeCompare(second.name, "en", { sensitivity: "base" })
        || first.userId.localeCompare(second.userId));
      cachedPersonnel.set(includeAllAccounts, { entries: result, expiresAt: Date.now() + personnelCacheDurationMs });
      return result;
    }).finally(() => {
      personnelRequests.delete(includeAllAccounts);
    });
    personnelRequests.set(includeAllAccounts, personnelRequest);
  }
  return personnelRequest;
}
