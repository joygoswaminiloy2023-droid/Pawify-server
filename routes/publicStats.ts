// routes/publicStats.ts
import express, { Request, Response } from "express";
import { connectToDatabase } from "../lib/db.js";

const router = express.Router();

// ── PUBLIC PLATFORM STATS ────────────────────────────────────────
// No auth required — only exposes safe aggregate counts for
// display on the public homepage. Do NOT add anything sensitive
// here (emails, revenue, order details, etc.) since this is public.
router.get("/", async (req: Request, res: Response) => {
  try {
    const db = await connectToDatabase();

    const [userCount, vendorCount, productCount, reviewStats] = await Promise.all([
      db.collection("user").countDocuments({ role: "user" }),
      db.collection("Vendors").countDocuments({ status: "approved" }),
      db.collection("Products").countDocuments({ approvalStatus: "approved" }),
      db.collection("Reviews").aggregate([
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            avgRating: { $avg: "$rating" },
          },
        },
      ]).toArray(),
    ]);

    res.status(200).json({
      success: true,
      data: {
        userCount,
        vendorCount,
        productCount,
        reviewCount: reviewStats[0]?.count || 0,
        avgRating: reviewStats[0]?.avgRating
          ? Math.round(reviewStats[0].avgRating * 10) / 10
          : 0,
      },
    });
  } catch (error) {
    console.error("Public stats error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch stats." });
  }
});

export default router;