# Permit Desk

A Next.js + Firebase permit-slip portal with email authentication, per-user permit records, automatic permit numbering, and A4 print output.

The Firebase client uses the named Firestore database `ps-taguibo`.

## Run locally

1. Create a Firebase project and enable **Authentication > Email/Password** and **Firestore Database**.
2. Register a Web app in Firebase.
3. Copy `.env.example` to `.env.local` and fill in the Web app credentials.
4. Deploy the rules and index to the named database:

```bash
npx firebase-tools login
npx firebase-tools use ps-taguibo
npx firebase-tools deploy --only firestore
```

The included `firebase.json` targets the `ps-taguibo` database. If you use the Firebase Console instead, publish the contents of `firestore.rules` under the `ps-taguibo` database, not only under `(default)`.
5. Install and run:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Permit numbers increment independently by unit and year in the format `AMIA-2026-0001` or `AGRISTAT-2026-0001`. The number is assigned in a Firestore transaction so simultaneous submissions do not reuse a number.

## Host on Vercel

From this folder, run:

```bash
npx vercel login
npx vercel --prod
```

When Vercel asks for project settings, accept the detected Next.js defaults. In the Vercel project settings, add these environment variables for **Production**:

```text
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID=ps-taguibo
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
```

Copy the values from the local `.env` file. After saving the variables, redeploy with `npx vercel --prod`. Make sure the `ps-taguibo` Firestore rules and index are deployed before testing the hosted site.

## Host directly with GitHub Pages

This repository includes `.github/workflows/deploy-pages.yml`. In GitHub, add these repository secrets under **Settings > Secrets and variables > Actions**:

```text
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
```

Enable **Settings > Pages > Source: GitHub Actions**. Pushes to `master` then publish the app at:

`https://jerosales00.github.io/permit-slip-portal/`
