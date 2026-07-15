import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { connectToDatabase } from "./db.js";

let authInstance: any = null;

export async function getAuth() {
    if (authInstance) return authInstance;

    try {
        const db = await connectToDatabase();

        // Ensure all required collections exist
        const collections = await db.listCollections().toArray();
        const collectionNames = collections.map(c => c.name);

        // Create missing collections
        const requiredCollections = ['user', 'account', 'session', 'verification'];
        for (const coll of requiredCollections) {
            if (!collectionNames.includes(coll)) {
                console.log(`📝 Creating '${coll}' collection...`);
                await db.createCollection(coll);
            }
        }

        const baseURL = process.env.BETTER_AUTH_URL ||
                       (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` :
                       process.env.NODE_ENV === "production" ? undefined :
                       "http://localhost:5000");

        authInstance = betterAuth({
            secret: process.env.BETTER_AUTH_SECRET || "your-secret-key-change-in-production",
            baseURL: baseURL,
            emailAndPassword: {
                enabled: true,
            },
            socialProviders: {
                google: {
                    clientId: process.env.GOOGLE_CLIENT_ID!,
                    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
                    scope: ["email", "profile"],
                },
            },
            user: {
                additionalFields: {
                    role: {
                        type: "string",
                        defaultValue: "user",
                        input: false,
                    },
                    status: {
                        type: "string",
                        defaultValue: "active",
                        input: false,
                    },
                },
            },
            trustedOrigins: [
                "http://localhost:3000",
                "https://pawify-kappa.vercel.app",   // ⬅️ hardcoded, always trusted
                process.env.CLIENT_URL,
                "http://localhost:5000",
                ...(process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : [])
            ].filter(Boolean),
            // This is critical for OAuth to work — links a Google sign-in
            // to an existing account that shares the same verified email.
            account: {
                accountLinking: {
                    enabled: true,
                    trustedProviders: ["google"],
                },
            },
            // MongoDB adapter already defaults to the standard collection
            // names (user, account, session, verification) — no per-model
            // config is needed or supported here.
            database: mongodbAdapter(db),
            // Required for cross-site OAuth: pawify-server.vercel.app and
            // pawify-kappa.vercel.app are on different subdomains of the
            // public vercel.app suffix, so browsers treat them as separate
            // sites. The OAuth "state" cookie needs SameSite=None; Secure
            // to survive the redirect back from Google, otherwise it gets
            // dropped and the callback fails with state_mismatch.
            advanced: {
                defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
        partitioned: true,
                },
            },
        });

        console.log("✅ Auth initialized successfully");
        console.log("📊 Collections available:", collectionNames);
        return authInstance;
    } catch (error) {
        console.error("❌ Failed to initialize auth:", error);
        throw error;
    }
}