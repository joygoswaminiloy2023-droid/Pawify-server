// routes/reviews.ts - COMPLETE FIXED VERSION
import express, { Request, Response } from "express";
import { connectToDatabase, toObjectId } from "../lib/db.js";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth.js";

const router = express.Router();

// =========================================================================
// DEBUG: Test if routes are loaded
// =========================================================================
router.get("/test", (req: Request, res: Response) => {
  res.json({
    success: true,
    message: "Reviews routes are working! 🐾",
    timestamp: new Date().toISOString()
  });
});

// =========================================================================
// GET: ALL REVIEWS (public - for homepage)
// =========================================================================
router.get("/", async (req: Request, res: Response) => {
  try {
    console.log("📝 Fetching all reviews...");
    const db = await connectToDatabase();

    const reviews = await db.collection("Reviews")
      .find({})
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray();

    console.log(`📝 Found ${reviews.length} reviews`);

    if (!reviews || reviews.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        count: 0
      });
    }

    const reviewsWithProductNames = await Promise.all(
      reviews.map(async (review) => {
        try {
          const product = await db.collection("Products").findOne(
            { _id: review.productId },
            { projection: { name: 1, images: 1 } }
          );

          const user = await db.collection("user").findOne(
            { _id: review.userId },
            { projection: { name: 1, email: 1, image: 1 } }
          );

          return {
            ...review,
            productName: product?.name || "Unknown Product",
            productImage: product?.images?.[0] || null,
            userImage: user?.image || null,
            userName: user?.name || review.userName || "Anonymous",
          };
        } catch (err) {
          console.error("Error populating review data:", err);
          return {
            ...review,
            productName: "Unknown Product",
            productImage: null,
            userImage: null,
            userName: "Anonymous",
          };
        }
      })
    );

    res.status(200).json({
      success: true,
      data: reviewsWithProductNames,
      count: reviewsWithProductNames.length
    });
  } catch (error) {
    console.error("❌ Fetch all reviews error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch reviews."
    });
  }
});

// =========================================================================
// GET: Product Reviews (public)
// =========================================================================
router.get("/product/:productId", async (req: Request, res: Response) => {
  try {
    const productIdParam = req.params.productId;
    console.log(`📝 Fetching reviews for product: ${productIdParam}`);
    
    // Always return 200 with empty array for invalid IDs
    if (!productIdParam || productIdParam.length !== 24) {
      console.log(`⚠️ Invalid ObjectId format: ${productIdParam}`);
      return res.status(200).json({
        success: true,
        data: [],
        count: 0,
        message: "Invalid product ID format"
      });
    }

    const db = await connectToDatabase();
    
    let productId;
    try {
      productId = toObjectId(productIdParam);
    } catch (error) {
      return res.status(200).json({
        success: true,
        data: [],
        count: 0,
        message: "Invalid product ID"
      });
    }

    const reviews = await db.collection("Reviews")
      .find({ productId: productId })
      .sort({ createdAt: -1 })
      .toArray();

    console.log(`📝 Found ${reviews.length} reviews for product`);

    const reviewsWithUserNames = await Promise.all(
      reviews.map(async (review) => {
        try {
          const user = await db.collection("user").findOne(
            { _id: review.userId },
            { projection: { name: 1, email: 1, image: 1 } }
          );

          return {
            ...review,
            userName: user?.name || review.userName || "Anonymous",
            userImage: user?.image || null,
            userEmail: user?.email || null
          };
        } catch (err) {
          return {
            ...review,
            userName: "Anonymous",
            userImage: null,
            userEmail: null
          };
        }
      })
    );

    res.status(200).json({
      success: true,
      data: reviewsWithUserNames,
      count: reviewsWithUserNames.length
    });
  } catch (error) {
    console.error("❌ Fetch product reviews error:", error);
    // Always return 200 with empty array on error
    res.status(200).json({
      success: true,
      data: [],
      count: 0,
      message: "Error fetching reviews"
    });
  }
});

// =========================================================================
// POST: SUBMIT REVIEW
// =========================================================================
router.post("/", requireAuth("user"), async (req: AuthedRequest, res: Response) => {
  try {
    const db = await connectToDatabase();
    const { productId, orderId, rating, comment } = req.body;

    if (!productId || !rating) {
      return res.status(400).json({ success: false, message: "Product and rating are required." });
    }

    const userId = toObjectId(req.user!.id);
    const productObjectId = toObjectId(productId);
    const orderObjectId = toObjectId(orderId);

    const order = await db.collection("Orders").findOne({
      _id: orderObjectId,
      userId
    });

    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found." });
    }

    if (order.status !== "delivered") {
      return res.status(403).json({ success: false, message: "You can only review delivered orders." });
    }

    const item = order.items.find(
      (i: any) => i.productId === productId || i.productId.toString() === productId
    );

    if (!item) {
      return res.status(404).json({ success: false, message: "Product not found in this order." });
    }

    if (!item.delivered) {
      return res.status(403).json({ success: false, message: "This item hasn't been delivered yet." });
    }

    const existing = await db.collection("Reviews").findOne({
      productId: productObjectId,
      userId,
      orderId: orderObjectId,
    });

    if (existing) {
      return res.status(400).json({ success: false, message: "You already reviewed this item." });
    }

    const user = await db.collection("user").findOne(
      { _id: userId },
      { projection: { name: 1, email: 1 } }
    );

    const review = {
      productId: productObjectId,
      userId,
      userName: user?.name || req.user!.email.split("@")[0],
      userEmail: user?.email || req.user!.email,
      orderId: orderObjectId,
      rating: Number(rating),
      comment: comment || "",
      createdAt: new Date(),
    };

    await db.collection("Reviews").insertOne(review);

    // Update product rating
    const allReviews = await db.collection("Reviews").find({ productId: productObjectId }).toArray();
    if (allReviews.length > 0) {
      const avg = allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length;
      await db.collection("Products").updateOne(
        { _id: productObjectId },
        { $set: { rating: Math.round(avg * 10) / 10 } }
      );
    }

    res.status(201).json({ success: true, message: "Review submitted successfully! 🐾" });
  } catch (error) {
    console.error("❌ Review error:", error);
    res.status(500).json({ success: false, message: "Failed to submit review." });
  }
});

// =========================================================================
// GET: MY REVIEWS (for users)
// =========================================================================
router.get("/my-reviews", requireAuth("user"), async (req: AuthedRequest, res: Response) => {
  try {
    const db = await connectToDatabase();
    const reviews = await db.collection("Reviews")
      .find({ userId: toObjectId(req.user!.id) })
      .sort({ createdAt: -1 })
      .toArray();
    res.status(200).json({ success: true, data: reviews });
  } catch (error) {
    console.error("❌ Fetch my reviews error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch reviews." });
  }
});

// =========================================================================
// GET: VENDOR REVIEWS (reviews left on the logged-in vendor's products)
// =========================================================================
router.get("/vendor/reviews", requireAuth("vendor"), async (req: AuthedRequest, res: Response) => {
  try {
    const db = await connectToDatabase();
    const userId = toObjectId(req.user!.id);

    // Find the vendor record tied to this logged-in user
    const vendor = await db.collection("Vendors").findOne({ userId });
    if (!vendor) {
      return res.status(404).json({ success: false, message: "Vendor profile not found." });
    }

    // Find all products belonging to this vendor
    const products = await db.collection("Products")
      .find({ vendorId: vendor._id })
      .project({ _id: 1, name: 1, images: 1 })
      .toArray();

    if (products.length === 0) {
      return res.status(200).json({ success: true, data: [], count: 0 });
    }

    const productIds = products.map((p) => p._id);
    const productMap = new Map(products.map((p) => [p._id.toString(), p]));

    const reviews = await db.collection("Reviews")
      .find({ productId: { $in: productIds } })
      .sort({ createdAt: -1 })
      .toArray();

    const reviewsWithProductInfo = reviews.map((review) => {
      const product = productMap.get(review.productId.toString());
      return {
        ...review,
        productName: product?.name || "Unknown Product",
        productImage: product?.images?.[0] || null,
      };
    });

    res.status(200).json({
      success: true,
      data: reviewsWithProductInfo,
      count: reviewsWithProductInfo.length,
    });
  } catch (error) {
    console.error("❌ Fetch vendor reviews error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch vendor reviews." });
  }
});

export default router;