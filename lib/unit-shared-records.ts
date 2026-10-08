import { collection, getDocs, query, where, writeBatch, type Firestore } from "firebase/firestore";

type UnitOwnedRecord = { id: string; ownerId: string; ownerUnit?: string };

export async function loadUnitSharedRecords<T extends UnitOwnedRecord>(firestore: Firestore, collectionName: string, userId: string, unit: string | null): Promise<T[]> {
  const records = collection(firestore, collectionName);
  const ownSnapshot = await getDocs(query(records, where("ownerId", "==", userId)));

  if (unit) {
    const recordsToTag = ownSnapshot.docs.filter((item) => typeof item.data().ownerUnit !== "string");
    for (let offset = 0; offset < recordsToTag.length; offset += 450) {
      const batch = writeBatch(firestore);
      recordsToTag.slice(offset, offset + 450).forEach((item) => batch.update(item.ref, { ownerUnit: unit }));
      try {
        await batch.commit();
      } catch (error) {
        // Legacy records stay readable even when their ownerUnit backfill is rejected.
        if ((error as { code?: string }).code !== "permission-denied") throw error;
      }
    }
  }

  let sharedSnapshot = null;
  if (unit) {
    try {
      sharedSnapshot = await getDocs(query(records, where("ownerUnit", "==", unit)));
    } catch (error) {
      if ((error as { code?: string }).code !== "permission-denied") throw error;
    }
  }
  const byId = new Map<string, T>();
  ownSnapshot.docs.forEach((item) => byId.set(item.id, { id: item.id, ...item.data(), ...(unit && typeof item.data().ownerUnit !== "string" ? { ownerUnit: unit } : {}) } as T));
  sharedSnapshot?.docs.forEach((item) => byId.set(item.id, { id: item.id, ...item.data() } as T));
  return [...byId.values()];
}
