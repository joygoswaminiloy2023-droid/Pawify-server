// routes/vendor.ts - COMPLETE FIXED VERSION
import express, { Request, Response } from "express";
import { connectToDatabase, toObjectId } from "../lib/db.js";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth.js";
import { getAuth } from "../lib/auth.js";

const router = express.Router();

// =========================================================================
// POST: APPLY TO BECOME A VENDOR
// =========================================================================
router.post("/apply", requireAuth("user"), async (req: AuthedRequest, res: Response) => {
  try {
    const db = await connectToDatabase();
    const { shopName, description, logo, banner } = req.body;

    if (!shopName || !description) {
      return res.status(400).json({ success: false, message: "Shop name and description are required." });
    }

    const existing = await db.collection("VendorApplications").findOne({
      userId: toObjectId(req.user!.id),
      status: "pending",
    });
    if (existing) {
      return res.status(400).json({ success: false, message: "You already have a pending application." });
    }

    const application = {
      userId: toObjectId(req.user!.id),
      shopName,
      description,
      logo: logo || "",
      banner: banner || "",
      status: "pending",
      rating: 0,
      totalSales: 0,
      createdAt: new Date(),
    };

    const result = await db.collection("VendorApplications").insertOne(application);
    res.status(201).json({ success: true, message: "Application submitted.", id: result.insertedId });
  } catch (error) {
    console.error("Vendor apply error:", error);
    res.status(500).json({ success: false, message: "Failed to submit application." });
  }
});

// =========================================================================
// GET: VENDOR APPLICATION STATUS (public - returns null if not authenticated)
// =========================================================================
router.get("/status", async (req: Request, res: Response) => {
  try {
    const db = await connectToDatabase();
    
    // Try to get the session to check if user is authenticated
    let userId;
    try {
      const auth = await getAuth();
      const session = await auth.api.getSession({
        headers: req.headers
      });
      
      if (!session || !session.user) {
        return res.status(200).json({
          success: true,
          data: {
            isVendor: false,
            hasPendingApplication: false,
            wasRejected: false,
            isAuthenticated: false,
            application: null
          }
        });
      }
      
      userId = session.user.id;
    } catch (error) {
      return res.status(200).json({
        success: true,
        data: {
          isVendor: false,
          hasPendingApplication: false,
          wasRejected: false,
          isAuthenticated: false,
          application: null
        }
      });
    }

    const userObjectId = toObjectId(userId);

    const vendor = await db.collection("Vendors").findOne({ userId: userObjectId });
    if (vendor) {
      return res.status(200).json({
        success: true,
        data: {
          isVendor: true,
          hasPendingApplication: false,
          wasRejected: false,
          isAuthenticated: true,
          vendorStatus: vendor.status,
          application: null,
        },
      });
    }

    const applications = await db.collection("VendorApplications")
      .find({ userId: userObjectId })
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray();

    if (!applications.length) {
      return res.status(200).json({
        success: true,
        data: {
          isVendor: false,
          hasPendingApplication: false,
          wasRejected: false,
          isAuthenticated: true,
          application: null
        },
      });
    }

    const latest = applications[0];

    if (latest.status === "approved") {
      return res.status(200).json({
        success: true,
        data: {
          isVendor: true,
          hasPendingApplication: false,
          wasRejected: false,
          isAuthenticated: true,
          application: latest
        },
      });
    }

    if (latest.status === "rejected") {
      return res.status(200).json({
        success: true,
        data: {
          isVendor: false,
          hasPendingApplication: false,
          wasRejected: true,
          isAuthenticated: true,
          application: latest
        },
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        isVendor: false,
        hasPendingApplication: true,
        wasRejected: false,
        isAuthenticated: true,
        application: latest
      },
    });
  } catch (error) {
    console.error("Vendor status check error:", error);
    res.status(200).json({
      success: true,
      data: {
        isVendor: false,
        hasPendingApplication: false,
        wasRejected: false,
        isAuthenticated: false,
        application: null
      }
    });
  }
});

// =========================================================================
// GET: MY VENDOR PROFILE
// =========================================================================
router.get("/me", requireAuth("vendor"), async (req: AuthedRequest, res: Response) => {
  try {
    const db = await connectToDatabase();
    const vendor = await db.collection("Vendors").findOne({ userId: toObjectId(req.user!.id) });
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor profile not found." });
    res.status(200).json({ success: true, data: vendor });
  } catch (error) {
    console.error("Fetch vendor profile error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch vendor profile." });
  }
});

// =========================================================================
// GET: VENDOR DASHBOARD STATS
// =========================================================================
router.get("/stats", requireAuth("vendor"), async (req: AuthedRequest, res: Response) => {
  try {
    const db = await connectToDatabase();
    const vendor = await db.collection("Vendors").findOne({ userId: toObjectId(req.user!.id) });
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found." });

    const vendorId = vendor._id;
    const products = await db.collection("Products").find({ vendorId }).toArray();
    const productIds = products.map(p => p._id);

    const [productCount, orders, totalRevenueAgg] = await Promise.all([
      db.collection("Products").countDocuments({ vendorId }),
      db.collection("Orders").find({ vendorId }).sort({ createdAt: -1 }).limit(10).toArray(),
      db.collection("Orders").aggregate([
        { $match: { vendorId, status: { $in: ["paid", "shipped", "delivered"] } } },
        { $group: { _id: null, total: { $sum: "$totalAmount" } } },
      ]).toArray(),
    ]);

    let reviewStats = { avgRating: 0, count: 0 };
    if (productIds.length > 0) {
      const stats = await db.collection("Reviews").aggregate([
        { $match: { productId: { $in: productIds } } },
        {
          $group: {
            _id: null,
            avgRating: { $avg: "$rating" },
            count: { $sum: 1 }
          }
        }
      ]).toArray();

      if (stats.length > 0) {
        reviewStats = {
          avgRating: stats[0].avgRating || 0,
          count: stats[0].count || 0
        };
      }
    }

    res.status(200).json({
      success: true,
      data: {
        productCount,
        recentOrders: orders,
        totalRevenue: totalRevenueAgg[0]?.total || 0,
        rating: Math.round(reviewStats.avgRating * 10) / 10,
        reviewCount: reviewStats.count,
        totalOrders: await db.collection("Orders").countDocuments({ vendorId }),
      },
    });
  } catch (error) {
    console.error("Vendor stats error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch stats." });
  }
});

// =========================================================================
// GET: VENDOR TRANSACTION HISTORY
// =========================================================================
router.get("/transactions", requireAuth("vendor"), async (req: AuthedRequest, res: Response) => {
  try {
    const db = await connectToDatabase();
    const vendor = await db.collection("Vendors").findOne({ userId: toObjectId(req.user!.id) });
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found." });

    const orders = await db.collection("Orders")
      .find({ vendorId: vendor._id, status: { $in: ["paid", "shipped", "delivered"] } })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({ success: true, data: orders });
  } catch (error) {
    console.error("Fetch transactions error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch transactions." });
  }
});

// =========================================================================
// PATCH: MARK ORDER AS DELIVERED
// =========================================================================
router.patch("/orders/:id/deliver", requireAuth("vendor"), async (req: AuthedRequest, res: Response) => {
  try {
    const db = await connectToDatabase();
    const vendor = await db.collection("Vendors").findOne({ userId: toObjectId(req.user!.id) });
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found." });

    const order = await db.collection("Orders").findOne({ _id: toObjectId(req.params.id) });
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });
    if (String(order.vendorId) !== String(vendor._id)) {
      return res.status(403).json({ success: false, message: "Not your order." });
    }
    if (order.status !== "paid" && order.status !== "shipped") {
      return res.status(400).json({ success: false, message: "Order must be paid before marking delivered." });
    }

    await db.collection("Orders").updateOne(
      { _id: toObjectId(req.params.id) },
      { $set: { status: "delivered", deliveredAt: new Date() } }
    );

    res.status(200).json({ success: true, message: "Order marked as delivered." });
  } catch (error) {
    console.error("Mark delivered error:", error);
    res.status(500).json({ success: false, message: "Failed to mark delivered." });
  }
});

// =========================================================================
// GET: VENDOR REVIEWS
// =========================================================================
router.get("/reviews", requireAuth("vendor"), async (req: AuthedRequest, res: Response) => {
  try {
    const db = await connectToDatabase();
    const vendor = await db.collection("Vendors").findOne({ userId: toObjectId(req.user!.id) });
    if (!vendor) {
      return res.status(404).json({ success: false, message: "Vendor not found." });
    }

    const products = await db.collection("Products")
      .find({ vendorId: vendor._id })
      .toArray();

    const productIds = products.map(p => p._id);

    if (productIds.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    const reviews = await db.collection("Reviews")
      .find({ productId: { $in: productIds } })
      .sort({ createdAt: -1 })
      .toArray();

    const reviewsWithDetails = await Promise.all(reviews.map(async (review) => {
      const product = products.find(p => p._id.toString() === review.productId.toString());
      const user = await db.collection("user").findOne(
        { _id: review.userId },
        { projection: { name: 1, email: 1 } }
      );

      return {
        ...review,
        productName: product?.name || "Unknown Product",
        productImage: product?.images?.[0] || null,
        userName: user?.name || review.userName || "Anonymous",
        userEmail: user?.email || review.userEmail || null
      };
    }));

    res.status(200).json({ success: true, data: reviewsWithDetails });
  } catch (error) {
    console.error("Fetch vendor reviews error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch reviews." });
  }
});

// =========================================================================
// GET: VENDOR ORDERS SUMMARY
// =========================================================================
router.get("/orders-summary", requireAuth("vendor"), async (req: AuthedRequest, res: Response) => {
  try {
    const db = await connectToDatabase();
    const vendor = await db.collection("Vendors").findOne({ userId: toObjectId(req.user!.id) });
    if (!vendor) {
      return res.status(404).json({ success: false, message: "Vendor not found." });
    }

    const orders = await db.collection("Orders")
      .find({ vendorId: vendor._id })
      .sort({ createdAt: -1 })
      .toArray();

    const summary = {
      total: orders.length,
      pending: orders.filter(o => o.status === "pending" || o.status === "paid").length,
      shipped: orders.filter(o => o.status === "shipped").length,
      delivered: orders.filter(o => o.status === "delivered").length,
      cancelled: orders.filter(o => o.status === "cancelled").length,
    };

    res.status(200).json({ success: true, data: summary });
  } catch (error) {
    console.error("Fetch orders summary error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch orders summary." });
  }
});

// =========================================================================
// GET: ALL PUBLIC VENDORS
// =========================================================================
router.get("/", async (req: Request, res: Response) => {
  try {
    const db = await connectToDatabase();
    const vendors = await db.collection("Vendors").find({ status: "approved" }).toArray();
    res.status(200).json({ success: true, data: vendors });
  } catch (error) {
    console.error("Fetch vendors error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch vendors." });
  }
});

export default router;