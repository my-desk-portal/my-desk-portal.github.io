import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { isSuperadminRole } from "@/lib/user-roles";

export type PersonnelEntry = { userId: string; name: string; position: string; unit: string };

const personnelCacheDurationMs = 60_000;
let cachedPersonnel: { entries: PersonnelEntry[]; expiresAt: number } | null = null;
let personnelRequest: Promise<PersonnelEntry[]> | null = null;

// Personnel dropdowns are built from registered user accounts (users collection).
export async function loadPersonnel(): Promise<PersonnelEntry[]> {
  if (!db) throw new Error("Firebase is not configured.");
  if (cachedPersonnel && cachedPersonnel.expiresAt > Date.now()) return cachedPersonnel.entries;
  if (!personnelRequest) {
    const firestore = db;
    personnelRequest = getDocs(collection(firestore, "users")).then((snapshot) => {
      const entries = snapshot.docs.filter((item) => !isSuperadminRole(item.data().accountRole)).map((item) => {
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
      cachedPersonnel = { entries: result, expiresAt: Date.now() + personnelCacheDurationMs };
      return result;
    }).finally(() => {
      personnelRequest = null;
    });
  }
  return personnelRequest;
}
