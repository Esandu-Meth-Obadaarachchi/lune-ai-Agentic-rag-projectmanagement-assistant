/**
 * Mint a Firebase ID token for local testing.
 *
 * The app only accepts a real ID token, and a Google sign-in needs a browser.
 * This takes the path the browser would: the Admin SDK signs a custom token for
 * an existing uid, then the Identity Toolkit REST endpoint exchanges it for the
 * ID token the API routes verify. Prints the token, nothing else, so it can be
 * captured into a shell variable.
 */
import admin from "firebase-admin";

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});

const email = process.argv[2];
const list = await admin.auth().listUsers(50);
const user = email
  ? list.users.find((u) => u.email === email)
  : list.users[0];
if (!user) {
  console.error("No matching user. Known:", list.users.map((u) => u.email).join(", "));
  process.exit(1);
}

const custom = await admin.auth().createCustomToken(user.uid);
const res = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  }
);
const json = await res.json();
if (!json.idToken) {
  console.error("Exchange failed:", JSON.stringify(json));
  process.exit(1);
}
console.error(`signed in as ${user.email} (${user.uid})`);
console.log(json.idToken);
