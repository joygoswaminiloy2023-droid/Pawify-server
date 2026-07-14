import "dotenv/config";   // ⬅️ side-effect import, must be the very first import line

import express from "express";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import { connectToDatabase } from "./lib/db.js";
import { getAuth } from "./lib/auth.js";

// Import routes
import vendorRoutes from "./routes/vendor.js";
import productRoutes from "./routes/products.js";
import orderRoutes from "./routes/orders.js";
import adminRoutes from "./routes/admin.js";
import paymentRoutes from "./routes/payments.js";
import userRoutes from "./routes/users.js";
import reviewRoutes from "./routes/reviews.js";

const app = express();
const PORT = process.env.PORT || 5000;

// ─── CORS ──────────────────────────────────────────────────────────
const allowedOrigins = [
  "http://localhost:3000",
  "https://pawify-kappa.vercel.app",
  process.env.CLIENT_URL, // kept for staging/flexibility
].filter(Boolean) as string[];

app.use(cors({
  origin: allowedOrigins,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  credentials: true,
  optionsSuccessStatus: 204
}));

// ─── ROOT ROUTE ──────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Welcome to Pawify API 🐾",
    version: "1.0.0",
    status: "Server is running",
    endpoints: {
      health: "/api/health",
      auth: "/api/auth",
      vendor: "/api/vendor",
      products: "/api/products",
      orders: "/api/orders",
      admin: "/api/admin",
      payments: "/api/payments",
      users: "/api/users",
      reviews: "/api/reviews"
    }
  });
});

// ─── HEALTH CHECK ──────────────────────────────────────────────
app.get("/api/health", async (req, res) => {
  try {
    const db = await connectToDatabase();
    await db.command({ ping: 1 });
    res.json({
      success: true,
      status: "healthy",
      message: "Server and database are running",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Health check failed:", error);
    res.status(500).json({
      success: false,
      status: "unhealthy",
      message: "Database connection failed"
    });
  }
});

import publicStatsRoutes from "./routes/publicStats.js";
// ...
app.use("/api/stats", publicStatsRoutes);

// ─── BETTER AUTH ─────────────────────────────────────────────────
let authHandler: any = null;

app.all("/api/auth/*", async (req, res) => {
  try {
    if (!authHandler) {
      const auth = await getAuth();
      if (!auth) {
        return res.status(500).json({ success: false, message: "Auth not initialized." });
      }
      authHandler = toNodeHandler(auth);
    }
    return authHandler(req, res);
  } catch (error) {
    console.error("Auth handler error:", error);
    res.status(500).json({ success: false, message: "Auth handler failed" });
  }
});

// ─── JWT ENDPOINT ──────────────────────────────────────────────
app.get("/api/auth/jwt", async (req, res) => {
  try {
    const auth = await getAuth();
    const session = await auth.api.getSession({
      headers: req.headers
    });

    if (!session) {
      return res.status(200).json({
        success: true,
        token: null,
        user: null,
        authenticated: false
      });
    }

    res.status(200).json({
      success: true,
      token: session.session?.token || null,
      user: session.user,
      authenticated: true
    });
  } catch (error) {
    console.error("JWT fetch error:", error);
    res.status(200).json({
      success: true,
      token: null,
      user: null,
      authenticated: false,
      error: "Error fetching token"
    });
  }
});

// ─── JSON PARSER ─────────────────────────────────────────────────
app.use(express.json());

// ─── ROUTES ─────────────────────────────────────────────────────
app.use("/api/vendor", vendorRoutes);
app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/users", userRoutes);
app.use("/api/reviews", reviewRoutes);

console.log(" All routes loaded successfully");

// ─── 404 HANDLER ────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`
  });
});

// ─── ERROR HANDLER ──────────────────────────────────────────────
app.use((err: any, req: any, res: any, next: any) => {
  console.error("Server error:", err);
  res.status(500).json({
    success: false,
    message: "Internal Server Error",
    error: process.env.NODE_ENV === "development" ? err.message : undefined
  });
});

// ─── LOCAL DEV ONLY: start a real listener ───────────────────────
// Vercel imports the default export below and invokes it per-request;
// it never needs (and should never run) a persistent app.listen().
// process.env.VERCEL is automatically set to "1" on Vercel's runtime.
if (!process.env.VERCEL) {
  console.log(` Starting server on port ${PORT}...`);

  connectToDatabase()
    .then(() => {
      console.log("✅ Database connected successfully");
      app.listen(PORT, () => {
        console.log(`\n Pawify Server running on:`);
        console.log(`    http://localhost:${PORT}`);
        console.log(`     Health: http://localhost:${PORT}/api/health`);
        console.log(`    Auth: http://localhost:${PORT}/api/auth`);
        console.log(`\n Server is ready!\n`);
      });
    })
    .catch((err) => {
      console.error(" Database connection failed:", err);
      // Server still starts even without DB
      app.listen(PORT, () => {
        console.log(`  Server running WITHOUT database on port ${PORT}`);
        console.log(` http://localhost:${PORT}`);
      });
    });
}

// ─── EXPORT FOR VERCEL ─────────────────────────────────────────
export default app;