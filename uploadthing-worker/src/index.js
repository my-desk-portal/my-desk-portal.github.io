import { createRouteHandler, createUploadthing, UploadThingError } from "uploadthing/server";

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
    if (url.pathname !== "/api/uploadthing") {
      return new Response("Not found", { status: 404 });
    }

    if (request.method === "OPTIONS") {
      return addCors(new Response(null, { status: 204 }), request);
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
