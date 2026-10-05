import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { isSuperadminRole } from "@/lib/user-roles";

export type PersonnelEntry = { userId: string; name: string; position: string; unit: string };

// Personnel dropdowns are built from registered user accounts (users collection).
export async function loadPersonnel(): Promise<PersonnelEntry[]> {
  if (!db) throw new Error("Firebase is not configured.");
  const snapshot = await getDocs(collection(db, "users"));
  const entries = snapshot.docs.filter((item) => !isSuperadminRole(item.data().accountRole)).map((item) => {
    const data = item.data();
    return {
      userId: item.id,
      name: typeof data.name === "string" ? data.name.trim() : "",
      position: typeof data.position === "string" ? data.position.trim() : "",
      unit: typeof data.unit === "string" ? data.unit.trim() : "",
    };
  }).filter((person) => person.name);
  // Several accounts may share one name; keep a single entry, preferring the one with more details.
  const unique = new Map<string, PersonnelEntry>();
  for (const entry of entries) {
    const key = entry.name.toLowerCase().replace(/\s+/g, ' ');
    const existing = unique.get(key);
    if (!existing || (!existing.position && entry.position) || (!existing.unit && entry.unit)) unique.set(key, entry);
  }
  return [...unique.values()].sort((first, second) => first.name.localeCompare(second.name, "en", { sensitivity: "base" }));
}
