import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { isSuperadminRole } from "@/lib/user-roles";

export type PersonnelEntry = { userId: string; name: string; position: string; unit: string };

const personnelCacheDurationMs = 60_000;
const cachedPersonnel = new Map<boolean, { entries: PersonnelEntry[]; expiresAt: number }>();
const personnelRequests = new Map<boolean, Promise<PersonnelEntry[]>>();

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
          unit: typeof data.unit === "string" ? data.unit.trim() : "",
        };
      }).filter((person) => person.name);
      const unique = new Map<string, PersonnelEntry>();
      for (const entry of entries) {
        const key = entry.name.toLowerCase().replace(/\s+/g, " ");
        const existing = unique.get(key);
        if (!existing || (!existing.position && entry.position) || (!existing.unit && entry.unit)) unique.set(key, entry);
      }
      const result = [...unique.values()].sort((first, second) => first.name.localeCompare(second.name, "en", { sensitivity: "base" }));
      cachedPersonnel.set(includeAllAccounts, { entries: result, expiresAt: Date.now() + personnelCacheDurationMs });
      return result;
    }).finally(() => {
      personnelRequests.delete(includeAllAccounts);
    });
    personnelRequests.set(includeAllAccounts, personnelRequest);
  }
  return personnelRequest;
}
