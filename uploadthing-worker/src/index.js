import { createRouteHandler, createUploadthing, UploadThingError, UTApi } from "uploadthing/server";

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function createProfilePhotoRouter(firebaseApiKey) {
  const upload = createUploadthing();

  return {
    profilePhoto: upload({
      image: { maxFileSize: "4MB", maxFileCount: 1 },
    })
      .middleware(async ({ req, files }) => {
        const authorization = req.headers.get("authorization") ?? "";
        const [, idToken] = authorization.match(/^Bearer\s+(.+)$/i) ?? [];
        if (!idToken) throw new UploadThingError("Sign in to upload a profile photo.");

        if (files.length !== 1 || !allowedImageTypes.has(files[0].type)) {
          throw new UploadThingError("Choose a JPEG, PNG, or WebP profile photo.");
        }

        if (!firebaseApiKey) {
          throw new UploadThingError("Profile photo uploads are not configured.");
        }

        const response = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseApiKey)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ idToken }),
          },
        );

        if (!response.ok) throw new UploadThingError("Your sign-in session could not be verified.");
        const result = await response.json();
        const user = result.users?.[0];
        if (!user?.localId || user.disabled || user.emailVerified !== true) {
          throw new UploadThingError("A verified account is required to upload a profile photo.");
        }

        return { userId: user.localId };
      })
      .onUploadComplete(async ({ file }) => ({ photoURL: file.ufsUrl })),
  };
}

async function deletePreviousPhoto(request, env) {
  const [, idToken] = (request.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i) ?? [];
  if (!idToken || !env.FIREBASE_API_KEY) return new Response("Unauthorized", { status: 401 });

  const lookup = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken }) },
  );
  const user = lookup.ok ? (await lookup.json()).users?.[0] : null;
  if (!user?.localId || user.disabled) return new Response("Unauthorized", { status: 401 });

  const { previousUrl } = await request.json().catch(() => ({}));
  let key = "";
  try {
    const parsed = new URL(previousUrl);
    const match = parsed.pathname.match(/^\/f\/([\w.-]+)$/);
    if (match && /(^|\.)(ufs\.sh|utfs\.io)$/.test(parsed.hostname)) key = match[1];
  } catch {}
  if (!key) return new Response("Invalid photo URL", { status: 400 });

  await new UTApi({ token: env.UPLOADTHING_TOKEN }).deleteFiles(key);
  return new Response(null, { status: 204 });
}

function addCors(response, request) {
  const headers = new Headers(response.headers);
  const origin = request.headers.get("origin");
  headers.set("access-control-allow-origin", origin || "*");
  headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  headers.set(
    "access-control-allow-headers",
    request.headers.get("access-control-request-headers") || "authorization, content-type",
  );
  headers.set("access-control-max-age", "86400");
  headers.append("vary", "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    const isDelete = url.pathname === "/api/delete-photo";
    if (url.pathname !== "/api/uploadthing" && !isDelete) {
      return new Response("Not found", { status: 404 });
    }

    if (request.method === "OPTIONS") {
      return addCors(new Response(null, { status: 204 }), request);
    }
    if (isDelete) {
      if (request.method !== "POST") return addCors(new Response("Method not allowed", { status: 405 }), request);
      try {
        return addCors(await deletePreviousPhoto(request, env), request);
      } catch (error) {
        console.error(error);
        return addCors(new Response("Could not delete the photo", { status: 500 }), request);
      }
    }
    if (request.method !== "GET" && request.method !== "POST") {
      return addCors(new Response("Method not allowed", { status: 405 }), request);
    }

    try {
    const handlers = createRouteHandler({
      router: createProfilePhotoRouter(env.FIREBASE_API_KEY),
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

      return addCors(await handlers(request), request);
    } catch (error) {
      console.error(error);
      return addCors(new Response(String(error?.stack || error), { status: 500 }), request);
    }
  },
};
