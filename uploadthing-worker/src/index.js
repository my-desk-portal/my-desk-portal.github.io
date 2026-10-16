import { createRouteHandler, createUploadthing, UploadThingError, UTApi } from "uploadthing/server";

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const cleaningTaskUnits = new Set(["AGRISTAT", "AMIA", "DRRM"]);
const cleaningTaskLeaderDesignation = "AGRISTAT/DRRM/AMIA Project Leader";

function firebaseIdToken(request) {
  const [, idToken] = (request.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i) ?? [];
  return idToken ?? "";
}

async function verifiedFirebaseUser(idToken, firebaseApiKey) {
  if (!idToken || !firebaseApiKey) return null;
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseApiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken }),
    },
  );
  if (!response.ok) return null;
  const user = (await response.json()).users?.[0];
  if (!user?.localId || user.disabled || user.emailVerified !== true) return null;
  return user;
}

async function getFirestoreDocument(env, idToken, collectionName, documentId) {
  const projectId = env.FIREBASE_PROJECT_ID;
  const databaseId = env.FIREBASE_DATABASE_ID || "(default)";
  if (!projectId) throw new Error("Firebase project is not configured on the UploadThing Worker.");
  const path = [collectionName, documentId].map(encodeURIComponent).join("/");
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents/${path}`,
    { headers: { Authorization: `Bearer ${idToken}` } },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("The Firebase account or Cleaning Task assignment could not be checked.");
  const document = await response.json();
  return Object.fromEntries(Object.entries(document.fields ?? {}).map(([key, value]) => [key, firestoreValue(value)]));
}

function firestoreValue(value) {
  if (Object.hasOwn(value, "stringValue")) return value.stringValue;
  if (Object.hasOwn(value, "booleanValue")) return value.booleanValue;
  if (Object.hasOwn(value, "integerValue")) return Number(value.integerValue);
  if (Object.hasOwn(value, "doubleValue")) return value.doubleValue;
  if (Object.hasOwn(value, "timestampValue")) return new Date(value.timestampValue);
  if (Object.hasOwn(value, "nullValue")) return null;
  if (value.mapValue) return Object.fromEntries(Object.entries(value.mapValue.fields ?? {}).map(([key, item]) => [key, firestoreValue(item)]));
  if (value.arrayValue) return (value.arrayValue.values ?? []).map(firestoreValue);
  return undefined;
}

function normalizeUnit(value) {
  const unit = typeof value === "string" ? value.trim() : "";
  if (unit === "FOD-AGRISTAT") return "AGRISTAT";
  if (unit === "FOD-AMIA") return "AMIA";
  if (unit === "FOD-DRRM") return "DRRM";
  return unit;
}

function profileUnit(profile) {
  if (profile.profileFieldsVersion >= 4) return normalizeUnit(profile.unit || profile.division);
  return normalizeUnit(profile.assignment || profile.projectProgram || profile.unit || profile.office || "");
}

function isEligibleCleaningTaskProfile(profile) {
  if (!profile || (profile.accountStatus ?? "Approved") !== "Approved") return false;
  const role = profile.accountRole;
  return ((role === "regular" || role === "user") && cleaningTaskUnits.has(profileUnit(profile)))
    || (role === "admin" && profile.designation?.trim() === cleaningTaskLeaderDesignation);
}

function manilaCurrentWeekStart(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const dateParts = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const date = new Date(Date.UTC(Number(dateParts.year), Number(dateParts.month) - 1, Number(dateParts.day)));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function createUploadRouter(env) {
  const upload = createUploadthing();
  return {
    profilePhoto: upload({
      image: { maxFileSize: "4MB", maxFileCount: 1 },
    })
      .middleware(async ({ req, files }) => {
        const user = await verifiedFirebaseUser(firebaseIdToken(req), env.FIREBASE_API_KEY);
        if (!user) throw new UploadThingError("A verified account is required to upload a profile photo.");
        if (files.length !== 1 || !allowedImageTypes.has(files[0].type)) {
          throw new UploadThingError("Choose a JPEG, PNG, or WebP profile photo.");
        }
        return { userId: user.localId };
      })
      .onUploadComplete(async ({ file }) => ({ photoURL: file.ufsUrl })),

    cleaningTaskImage: upload({
      blob: { maxFileSize: "32MB", maxFileCount: 1 },
    })
      .middleware(async ({ req, files }) => {
        const idToken = firebaseIdToken(req);
        const user = await verifiedFirebaseUser(idToken, env.FIREBASE_API_KEY);
        if (!user) throw new UploadThingError("A verified account is required to upload a Cleaning Task image.");
        if (files.length !== 1 || !allowedImageTypes.has(files[0].type)) {
          throw new UploadThingError("Choose a JPEG, PNG, or WebP Cleaning Task image.");
        }

        const profile = await getFirestoreDocument(env, idToken, "users", user.localId);
        if (!isEligibleCleaningTaskProfile(profile)) {
          throw new UploadThingError("Cleaning Task uploads are available only to an eligible Regular account or the AGRISTAT/DRRM/AMIA Project Leader Admin.");
        }

        const unit = profileUnit(profile);
        const weekStart = manilaCurrentWeekStart();
        const assignment = await getFirestoreDocument(env, idToken, "cleaningTaskAssignments", weekStart);
        const now = Date.now();
        if (!assignment || assignment.unit !== unit
          || !(assignment.startAt instanceof Date) || !(assignment.endAt instanceof Date)
          || now < assignment.startAt.getTime() || now >= assignment.endAt.getTime()) {
          throw new UploadThingError("Your Unit / Program / Project is not assigned for the current work week.");
        }

        return { userId: user.localId, unit, weekStart };
      })
      .onUploadComplete(async ({ file }) => ({ imageURL: file.ufsUrl, fileKey: file.key })),
  };
}

async function deletePreviousProfilePhoto(request, env) {
  const idToken = firebaseIdToken(request);
  const user = await verifiedFirebaseUser(idToken, env.FIREBASE_API_KEY);
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { previousUrl } = await request.json().catch(() => ({}));
  const key = uploadThingFileKey(previousUrl);
  if (!key) return new Response("Invalid photo URL", { status: 400 });
  await new UTApi({ token: env.UPLOADTHING_TOKEN }).deleteFiles(key);
  return new Response(null, { status: 204 });
}

function uploadThingFileKey(value) {
  try {
    const parsed = new URL(value);
    const match = parsed.pathname.match(/^\/f\/([\w.-]+)$/);
    if (match && /(^|\.)(ufs\.sh|utfs\.io)$/.test(parsed.hostname)) return match[1];
  } catch {}
  return "";
}

async function deletePreviousCleaningTaskImage(request, env) {
  const idToken = firebaseIdToken(request);
  const user = await verifiedFirebaseUser(idToken, env.FIREBASE_API_KEY);
  if (!user) return new Response("Unauthorized", { status: 401 });
  const profile = await getFirestoreDocument(env, idToken, "users", user.localId);
  if (!isEligibleCleaningTaskProfile(profile)) return new Response("Forbidden", { status: 403 });

  const { unit, fileKey } = await request.json().catch(() => ({}));
  if (!cleaningTaskUnits.has(unit) || typeof fileKey !== "string" || !/^[\w.-]{1,128}$/.test(fileKey)) {
    return new Response("Invalid Cleaning Task image", { status: 400 });
  }
  const image = await getFirestoreDocument(env, idToken, "cleaningTaskImages", unit);
  if (!image || image.uploaderId !== user.localId || image.previousFileKey !== fileKey) {
    return new Response("The previous image does not belong to this Cleaning Task replacement", { status: 403 });
  }
  await new UTApi({ token: env.UPLOADTHING_TOKEN }).deleteFiles(fileKey);
  return new Response(null, { status: 204 });
}

async function handleUploadThing(request, env, context, url) {
  const handlers = createRouteHandler({
    router: createUploadRouter(env),
    config: {
      token: env.UPLOADTHING_TOKEN,
      isDev: env.ENVIRONMENT === "development" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
      fetch: (target, init) => {
        if (init && "cache" in init) delete init.cache;
        return fetch(target, init);
      },
      handleDaemonPromise: (promise) => context.waitUntil(promise),
    },
  });
  return handlers(request);
}

function addCors(response, request) {
  const headers = new Headers(response.headers);
  const origin = request.headers.get("origin");
  headers.set("access-control-allow-origin", origin || "*");
  headers.set("access-control-methods", "GET, POST, OPTIONS");
  headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  headers.set(
    "access-control-allow-headers",
    request.headers.get("access-control-request-headers") || "authorization, content-type",
  );
  headers.set("access-control-max-age", "86400");
  headers.append("vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    const isProfilePhotoDelete = url.pathname === "/api/delete-photo";
    const isCleaningTaskDelete = url.pathname === "/api/delete-cleaning-task-image";

    if (!["/api/uploadthing", "/api/delete-photo", "/api/delete-cleaning-task-image"].includes(url.pathname)) {
      return new Response("Not found", { status: 404 });
    }
    if (request.method === "OPTIONS") return addCors(new Response(null, { status: 204 }), request);

    try {
      let response;
      if (isProfilePhotoDelete || isCleaningTaskDelete) {
        if (request.method !== "POST") response = new Response("Method not allowed", { status: 405 });
        else if (isProfilePhotoDelete) response = await deletePreviousProfilePhoto(request, env);
        else response = await deletePreviousCleaningTaskImage(request, env);
      } else if (request.method !== "GET" && request.method !== "POST") {
        response = new Response("Method not allowed", { status: 405 });
      } else {
        response = await handleUploadThing(request, env, context, url);
      }
      return addCors(response, request);
    } catch (error) {
      console.error(error);
      return addCors(new Response("The request could not be completed", { status: 500 }), request);
    }
  },
};
