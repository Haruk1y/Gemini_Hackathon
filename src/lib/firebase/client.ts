import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const hasFirebaseClientConfig = Object.values(config).every(Boolean);

const clientApp = hasFirebaseClientConfig
  ? getApps().length
    ? getApp()
    : initializeApp(config as Required<typeof config>)
  : null;

if (!hasFirebaseClientConfig) {
  console.warn(
    "Firebase client config is missing. Set NEXT_PUBLIC_FIREBASE_* env vars to enable the app.",
  );
}

export const clientAuth = clientApp ? getAuth(clientApp) : null;
export const clientDb = clientApp ? getFirestore(clientApp) : null;
