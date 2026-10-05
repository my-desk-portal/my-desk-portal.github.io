import { collection, doc, getDocs, query, serverTimestamp, where, type Firestore } from "firebase/firestore";

export type DocumentNotificationType = "Special Order" | "Notice to Attend" | "Permit Slip" | "Travel Order";
export type DocumentNotificationSchedule = { dateFrom: string; dateTo: string; venue: string };

export type DocumentNotification = {
  id: string;
  recipientId: string;
  ownerId: string;
  documentId: string;
  documentType: DocumentNotificationType;
  activityTitle?: string;
  dateFrom?: string;
  dateTo?: string;
  venue?: string;
  schedules?: DocumentNotificationSchedule[];
  date?: string;
  purpose?: string;
  departureDate?: string;
  returnDate?: string;
  placeOfTravel?: string;
  read: boolean;
  createdAt?: unknown;
};

export type DocumentNotificationDraft = Omit<DocumentNotification, "id" | "read" | "createdAt">;

export function makeDocumentNotification(firestore: Firestore, draft: DocumentNotificationDraft) {
  return {
    reference: doc(collection(firestore, "documentNotifications")),
    data: { ...draft, read: false, createdAt: serverTimestamp() },
  };
}

export async function getDocumentNotificationReferences(firestore: Firestore, ownerId: string, documentId: string) {
  const snapshot = await getDocs(query(
    collection(firestore, "documentNotifications"),
    where("ownerId", "==", ownerId),
    where("documentId", "==", documentId),
  ));
  return snapshot.docs.map((notification) => notification.ref);
}
