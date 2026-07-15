import { MongoClient, Db, ObjectId } from "mongodb";

let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;

export async function connectToDatabase(): Promise<Db> {
    if (cachedDb) {
        return cachedDb;
    }

    const uri = process.env.MONGODB_URI;
    if (!uri) {
        throw new Error("MONGODB_URI is not defined in environment variables");
    }

    try {
        const client = new MongoClient(uri);
        await client.connect();

        const db = client.db(process.env.DB_NAME || "pawify");

        cachedClient = client;
        cachedDb = db;

        console.log(`Connected to MongoDB (database: ${db.databaseName})`);
        return db;
    } catch (error) {
        console.error(" Failed to connect to MongoDB:", error);
        throw error;
    }
}

export function toObjectId(id: string | ObjectId): ObjectId {
    if (id instanceof ObjectId) return id;
    if (typeof id === "string" && ObjectId.isValid(id)) {
        return new ObjectId(id);
    }

    return new ObjectId();
}

export async function closeDatabaseConnection(): Promise<void> {
    if (cachedClient) {
        await cachedClient.close();
        cachedClient = null;
        cachedDb = null;
        console.log(" MongoDB connection closed");
    }
}