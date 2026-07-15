import express, { Response } from "express";
import { connectToDatabase, toObjectId } from "../lib/db.js";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth.js";

const router = express.Router();

// GET: ALL PRODUCTS (public — only approved + active)
router.get("/", async (req, res) => {
  try {
    const db = await connectToDatabase();
    const { category, petType, search, minPrice, maxPrice } = req.query;

    const filter: any = { isActive: true, approvalStatus: "approved" };
    if (category) filter.category = category;
    if (petType) filter.petType = petType;
    if (search) filter.name = { $regex: search as string, $options: "i" };
    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = Number(minPrice);
      if (maxPrice) filter.price.$lte = Number(maxPrice);
    }

    const products = await db.collection("Products").find(filter).sort({ createdAt: -1 }).toArray();
    res.status(200).json({ success: true, data: products });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch products." });
  }
});

// GET: SINGLE PRODUCT (public)
router.get("/:id", async (req, res) => {
  try {
    const db = await connectToDatabase();
    const product = await db.collection("Products").findOne({ _id: toObjectId(req.params.id) });
    if (!product) return res.status(404).json({ success: false, message: "Product not found." });
    res.status(200).json({ success: true, data: product });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch product." });
  }
});

// GET: PRODUCT REVIEWS (public)
router.get("/:id/reviews", async (req, res) => {
  try {
    const db = await connectToDatabase();
    const reviews = await db.collection("Reviews")
      .find({ productId: toObjectId(req.params.id) })
      .sort({ createdAt: -1 })
      .toArray();
    res.status(200).json({ success: true, data: reviews });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch reviews." });
  }
});

// GET: MY PRODUCTS (vendor — all statuses, own products only)
router.get("/vendor/mine", requireAuth("vendor"), async (req: AuthedRequest, res: Response) => {
  try {
    const db = await connectToDatabase();
    const vendor = await db.collection("Vendors").findOne({ userId: toObjectId(req.user!.id) });
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found." });

    const products = await db.collection("Products").find({ vendorId: vendor._id }).sort({ createdAt: -1 }).toArray();
    res.status(200).json({ success: true, data: products });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch your products." });
  }
});

// POST: CREATE PRODUCT (vendor only — goes to "pending" for admin approval)
router.post("/", requireAuth("vendor"), async (req: AuthedRequest, res: Response) => {
  try {
    const db = await connectToDatabase();
    const vendor = await db.collection("Vendors").findOne({ userId: toObjectId(req.user!.id) });
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor profile not found." });

    const { name, category, petType, description, price, stock, images } = req.body;
    if (!name || !price || !category) {
      return res.status(400).json({ success: false, message: "Name, category, and price are required." });
    }

    const product = {
      vendorId: vendor._id,
      name,
      category,
      petType: petType || "",
      description: description || "",
      price: Number(price),
      stock: Number(stock) || 0,
      images: images || [],
      isActive: true,
      approvalStatus: "pending",
      createdAt: new Date(),
    };

    const result = await db.collection("Products").insertOne(product);
    res.status(201).json({ success: true, message: "Product submitted for admin approval.", id: result.insertedId });
  } catch (error) {
    console.error("Create product error:", error);
    res.status(500).json({ success: false, message: "Failed to create product." });
  }
});

// PATCH: UPDATE PRODUCT (vendor only, own product — re-enters pending if key fields change)
router.patch("/:id", requireAuth("vendor"), async (req: AuthedRequest, res: Response) => {
  try {
    const db = await connectToDatabase();
    const vendor = await db.collection("Vendors").findOne({ userId: toObjectId(req.user!.id) });
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found." });

    const productId = toObjectId(req.params.id);
    const product = await db.collection("Products").findOne({ _id: productId });
    if (!product) return res.status(404).json({ success: false, message: "Product not found." });
    if (String(product.vendorId) !== String(vendor._id)) {
      return res.status(403).json({ success: false, message: "Not your product." });
    }

    const updates = { ...req.body, approvalStatus: "pending", updatedAt: new Date() };
    delete updates._id;
    delete updates.vendorId;

    await db.collection("Products").updateOne({ _id: productId }, { $set: updates });
    res.status(200).json({ success: true, message: "Product updated, pending re-approval." });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to update product." });
  }
});

// DELETE: REMOVE PRODUCT
router.delete("/:id", requireAuth("vendor"), async (req: AuthedRequest, res: Response) => {
  try {
    const db = await connectToDatabase();
    const vendor = await db.collection("Vendors").findOne({ userId: toObjectId(req.user!.id) });
    const product = await db.collection("Products").findOne({ _id: toObjectId(req.params.id) });

    if (!product) return res.status(404).json({ success: false, message: "Product not found." });
    if (String(product.vendorId) !== String(vendor?._id)) {
      return res.status(403).json({ success: false, message: "Not your product." });
    }

    await db.collection("Products").deleteOne({ _id: toObjectId(req.params.id) });
    res.status(200).json({ success: true, message: "Product deleted." });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to delete product." });
  }
});

export default router;