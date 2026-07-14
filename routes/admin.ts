// routes/admin.ts - COMPLETE FIXED VERSION
import express, { Response } from "express";
import { connectToDatabase, toObjectId } from "../lib/db.js";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth.js";

const router = express.Router();

// ── DASHBOARD STATS ──────────────────────────────────────────────
router.get("/stats", requireAuth("admin"), async (req: AuthedRequest, res: Response) => {
  try {
    const db = await connectToDatabase();
    
    // Get review stats
    const reviewStats = await db.collection("Reviews").aggregate([
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          avgRating: { $avg: "$rating" }
        }
      }
    ]).toArray();

    const [userCount, vendorCount, productCount, orderCount, revenueAgg, pendingVendors] = await Promise.all([
      db.collection("user").countDocuments({ role: "user" }),
      db.collection("Vendors").countDocuments({ status: "approved" }),
      db.collection("Products").countDocuments({ approvalStatus: "approved" }),
      db.collection("Orders").countDocuments(),
      db.collection("Orders").aggregate([
        { $match: { status: { $in: ["paid", "shipped", "delivered"] } } },
        { $group: { _id: null, total: { $sum: "$totalAmount" } } },
      ]).toArray(),
      db.collection("VendorApplications").countDocuments({ status: "pending" }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        userCount,
        vendorCount,
        productCount,
        orderCount,
        totalRevenue: revenueAgg[0]?.total || 0,
        pendingVendors,
        reviewCount: reviewStats[0]?.count || 0,
        avgRating: reviewStats[0]?.avgRating ? Math.round(reviewStats[0].avgRating * 10) / 10 : 0,
      },
    });
  } catch (error) {
    console.error("Stats error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch stats." });
  }
});

// ── LIST VENDOR APPLICATIONS ─────────────────────────────────────
router.get("/vendor-applications", requireAuth("admin"), async (req: AuthedRequest, res: Response) => {
  try {
    const db = await connectToDatabase();
    const apps = await db.collection("VendorApplications").find({ status: "pending" }).toArray();
    res.status(200).json({ success: true, data: apps });
  } catch (error) {
    console.error("Fetch applications error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch applications." });
  }
});

// ── APPROVE VENDOR ──────────────────────────────────────────────
router.patch("/vendor-applications/:id/approve", requireAuth("admin"), async (req: AuthedRequest, res: Response) => {
  try {
    const db = await connectToDatabase();
    const appId = toObjectId(req.params.id);
    const application = await db.collection("VendorApplications").findOne({ _id: appId });

    if (!application) return res.status(404).json({ success: false, message: "Application not found." });

    const { _id, ...vendorData } = application;
    await db.collection("Vendors").insertOne({ ...vendorData, status: "approved", approvedAt: new Date() });
    await db.collection("VendorApplications").deleteOne({ _id: appId });
    await db.collection("user").updateOne(
      { _id: application.userId },
      { $set: { role: "vendor", updatedAt: new Date() } }
    );

    res.status(200).json({ success: true, message: "Vendor approved." });
  } catch (error) {
    console.error("Approve vendor error:", error);
    res.status(500).json({ success: false, message: "Failed to approve vendor." });
  }
});

// ── REJECT VENDOR APPLICATION ────────────────────────────────────
router.patch("/vendor-applications/:id/reject", requireAuth("admin"), async (req: AuthedRequest, res: Response) => {
  try {
    const db = await connectToDatabase();
    await db.collection("VendorApplications").updateOne(
      { _id: toObjectId(req.params.id) },
      { $set: { status: "rejected", rejectedAt: new Date() } }
    );
    res.status(200).json({ success: true, message: "Application rejected." });
  } catch (error) {
    console.error("Reject application error:", error);
    res.status(500).json({ success: false, message: "Failed to reject application." });
  }
});

// ── REVOKE VENDOR STATUS ─────────────────────────────────────────
router.patch("/vendors/:id/revoke", requireAuth("admin"), async (req: AuthedRequest, res: Response) => {
  try {
    const db = await connectToDatabase();
    const vendor = await db.collection("Vendors").findOne({ _id: toObjectId(req.params.id) });
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found." });

    await db.collection("Vendors").updateOne(
      { _id: vendor._id },
      { $set: { status: "revoked", revokedAt: new Date() } }
    );
    await db.collection("user").updateOne(
      { _id: vendor.userId },
      { $set: { role: "user", updatedAt: new Date() } }
    );
    await db.collection("Products").updateMany({ vendorId: vendor._id }, { $set: { isActive: false } });

    res.status(200).json({ success: true, message: "Vendor access revoked." });
  } catch (error) {
    console.error("Revoke vendor error:", error);
    res.status(500).json({ success: false, message: "Failed to revoke vendor." });
  }
});

// ── USER MANAGEMENT ──────────────────────────────────────────────
router.patch("/users/:id/status", requireAuth("admin"), async (req: AuthedRequest, res: Response) => {
  try {
    const { status } = req.body;
    if (!["active", "restricted", "banned"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status." });
    }

    const db = await connectToDatabase();
    const result = await db.collection("user").updateOne(
      { _id: toObjectId(req.params.id) },
      { $set: { status, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) return res.status(404).json({ success: false, message: "User not found." });
    res.status(200).json({ success: true, message: `User status updated to ${status}.` });
  } catch (error) {
    console.error("Update user status error:", error);
    res.status(500).json({ success: false, message: "Failed to update user status." });
  }
});

// ── LIST ALL USERS ───────────────────────────────────────────────
router.get("/users", requireAuth("admin"), async (req: AuthedRequest, res: Response) => {
  try {
    const db = await connectToDatabase();
    const users = await db.collection("user").find({}).project({ password: 0 }).toArray();
    res.status(200).json({ success: true, data: users });
  } catch (error) {
    console.error("Fetch users error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch users." });
  }
});

// ── ALL ORDERS ────────────────────────────────────────────────────
router.get("/orders", requireAuth("admin"), async (req: AuthedRequest, res: Response) => {
  try {
    const db = await connectToDatabase();
    const orders = await db.collection("Orders").find({}).sort({ createdAt: -1 }).toArray();
    res.status(200).json({ success: true, data: orders });
  } catch (error) {
    console.error("Fetch orders error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch orders." });
  }
});

// ── LIST PENDING PRODUCTS ────────────────────────────────────────
router.get("/products/pending", requireAuth("admin"), async (req: AuthedRequest, res: Response) => {
  try {
    const db = await connectToDatabase();
    const products = await db.collection("Products").find({ approvalStatus: "pending" }).toArray();
    res.status(200).json({ success: true, data: products });
  } catch (error) {
    console.error("Fetch pending products error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch pending products." });
  }
});

// ── APPROVE PRODUCT ──────────────────────────────────────────────
router.patch("/products/:id/approve", requireAuth("admin"), async (req: AuthedRequest, res: Response) => {
  try {
    const db = await connectToDatabase();
    await db.collection("Products").updateOne(
      { _id: toObjectId(req.params.id) },
      { $set: { approvalStatus: "approved", approvedAt: new Date() } }
    );
    res.status(200).json({ success: true, message: "Product approved." });
  } catch (error) {
    console.error("Approve product error:", error);
    res.status(500).json({ success: false, message: "Failed to approve product." });
  }
});

// ── REJECT PRODUCT ───────────────────────────────────────────────
router.patch("/products/:id/reject", requireAuth("admin"), async (req: AuthedRequest, res: Response) => {
  try {
    const db = await connectToDatabase();
    await db.collection("Products").updateOne(
      { _id: toObjectId(req.params.id) },
      { $set: { approvalStatus: "rejected", isActive: false, rejectedAt: new Date() } }
    );
    res.status(200).json({ success: true, message: "Product rejected." });
  } catch (error) {
    console.error("Reject product error:", error);
    res.status(500).json({ success: false, message: "Failed to reject product." });
  }
});

// ── ALL TRANSACTIONS ──────────────────────────────────────────────
router.get("/transactions", requireAuth("admin"), async (req: AuthedRequest, res: Response) => {
  try {
    const db = await connectToDatabase();
    const payments = await db.collection("Payments").find({}).sort({ createdAt: -1 }).toArray();
    res.status(200).json({ success: true, data: payments });
  } catch (error) {
    console.error("Fetch transactions error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch transactions." });
  }
});

// ── ANALYTICS ──────────────────────────────────────────────────────
router.get("/analytics", requireAuth("admin"), async (req: AuthedRequest, res: Response) => {
  try {
    const db = await connectToDatabase();

    const salesByDay = await db.collection("Orders").aggregate([
      { $match: { status: { $in: ["paid", "shipped", "delivered"] } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          total: { $sum: "$totalAmount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $limit: 30 },
    ]).toArray();

    const topProducts = await db.collection("Orders").aggregate([
      { $match: { status: { $in: ["paid", "shipped", "delivered"] } } },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.name",
          totalSold: { $sum: "$items.quantity" },
          revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
        },
      },
      { $sort: { totalSold: -1 } },
      { $limit: 5 },
    ]).toArray();

    const categoryBreakdown = await db.collection("Products").aggregate([
      { $match: { approvalStatus: "approved" } },
      { $group: { _id: "$category", count: { $sum: 1 } } },
    ]).toArray();

    // FIXED: Most Reviewed Products with proper lookup
    const mostReviewed = await db.collection("Reviews").aggregate([
      {
        $group: {
          _id: "$productId",
          reviewCount: { $sum: 1 },
          avgRating: { $avg: "$rating" }
        }
      },
      { $sort: { reviewCount: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: "Products",
          localField: "_id",
          foreignField: "_id",
          as: "product"
        }
      },
      {
        $project: {
          _id: 1,
          reviewCount: 1,
          avgRating: 1,
          product: { $arrayElemAt: ["$product", 0] }
        }
      }
    ]).toArray();

    res.status(200).json({
      success: true,
      data: {
        salesByDay,
        topProducts,
        categoryBreakdown,
        mostReviewed: mostReviewed || [],
      },
    });
  } catch (error) {
    console.error("Analytics error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch analytics." });
  }
});

export default router;