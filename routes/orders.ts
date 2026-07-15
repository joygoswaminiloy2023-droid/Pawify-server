// routes/orders.ts - Complete updated version with stock management
import express, { Response } from "express";
import { connectToDatabase, toObjectId } from "../lib/db.js";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth.js";

const router = express.Router();

// POST: CREATE ORDER (with stock decrease)
router.post("/", requireAuth("user"), async (req: AuthedRequest, res: Response) => {
  try {
    const db = await connectToDatabase();
    const { items, vendorId, shippingAddress } = req.body;

    if (!items?.length) {
      return res.status(400).json({ success: false, message: "No items in order." });
    }

    // ✅ Check and decrease stock for each item
    const stockUpdates = [];
    for (const item of items) {
      const product = await db.collection("Products").findOne({ 
        _id: toObjectId(item.productId) 
      });
      
      if (!product) {
        return res.status(404).json({ 
          success: false, 
          message: `Product "${item.name}" not found.` 
        });
      }
      
      if (product.stock < item.quantity) {
        return res.status(400).json({ 
          success: false, 
          message: `Not enough stock for "${item.name}". Available: ${product.stock}` 
        });
      }
      
      stockUpdates.push({
        productId: product._id,
        quantity: item.quantity,
        name: item.name,
        currentStock: product.stock,
        newStock: product.stock - item.quantity
      });
    }
    
    // Execute stock updates
    for (const update of stockUpdates) {
      await db.collection("Products").updateOne(
        { _id: update.productId },
        { 
          $inc: { stock: -update.quantity },
          $set: { updatedAt: new Date() }
        }
      );
      console.log(`Stock decreased for ${update.name}: ${update.currentStock} → ${update.newStock}`);
    }

    // Add delivered flag to each item
    const itemsWithDelivery = items.map((item: any) => ({
      ...item,
      delivered: false,
      deliveredAt: null
    }));

    const totalAmount = items.reduce((sum: number, i: any) => sum + i.price * i.quantity, 0);

    const order = {
      userId: toObjectId(req.user!.id),
      vendorId: toObjectId(vendorId),
      items: itemsWithDelivery,
      totalAmount,
      status: "pending",
      shippingAddress: shippingAddress || "",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db.collection("Orders").insertOne(order);
    res.status(201).json({ success: true, orderId: result.insertedId, totalAmount });
  } catch (error) {
    console.error("Create order error:", error);
    res.status(500).json({ success: false, message: "Failed to create order." });
  }
});

// GET: MY ORDERS
router.get("/my-orders", requireAuth("user"), async (req: AuthedRequest, res: Response) => {
  try {
    const db = await connectToDatabase();
    const orders = await db.collection("Orders")
      .find({ userId: toObjectId(req.user!.id) })
      .sort({ createdAt: -1 })
      .toArray();
    res.status(200).json({ success: true, data: orders });
  } catch (error) {
    console.error("Fetch orders error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch orders." });
  }
});

// GET: VENDOR ORDERS
router.get("/vendor-orders", requireAuth("vendor"), async (req: AuthedRequest, res: Response) => {
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
    res.status(200).json({ success: true, data: orders });
  } catch (error) {
    console.error("Fetch vendor orders error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch orders." });
  }
});

// PATCH: VENDOR MARKS SPECIFIC ITEM AS DELIVERED
router.patch("/:orderId/deliver-item", requireAuth("vendor"), async (req: AuthedRequest, res: Response) => {
  try {
    const db = await connectToDatabase();
    const { orderId } = req.params;
    const { productId } = req.body;

    if (!productId) {
      return res.status(400).json({ success: false, message: "Product ID is required." });
    }

    const vendor = await db.collection("Vendors").findOne({ userId: toObjectId(req.user!.id) });
    if (!vendor) {
      return res.status(404).json({ success: false, message: "Vendor not found." });
    }

    const order = await db.collection("Orders").findOne({
      _id: toObjectId(orderId),
      vendorId: vendor._id
    });

    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found or not yours." });
    }

    const itemIndex = order.items.findIndex(
      (item: any) => item.productId === productId || item.productId.toString() === productId
    );

    if (itemIndex === -1) {
      return res.status(404).json({ success: false, message: "Product not found in this order." });
    }

    if (order.items[itemIndex].delivered) {
      return res.status(400).json({ success: false, message: "Item already marked as delivered." });
    }

    await db.collection("Orders").updateOne(
      { _id: toObjectId(orderId) },
      { 
        $set: { 
          [`items.${itemIndex}.delivered`]: true,
          [`items.${itemIndex}.deliveredAt`]: new Date(),
          updatedAt: new Date()
        } 
      }
    );

    const updatedOrder = await db.collection("Orders").findOne({ _id: toObjectId(orderId) });
    const allDelivered = updatedOrder?.items.every((item: any) => item.delivered === true);

    if (allDelivered && updatedOrder?.status !== "delivered") {
      await db.collection("Orders").updateOne(
        { _id: toObjectId(orderId) },
        { $set: { status: "delivered", deliveredAt: new Date() } }
      );
    } else if (updatedOrder?.status === "pending" || updatedOrder?.status === "paid") {
      const anyDelivered = updatedOrder?.items.some((item: any) => item.delivered === true);
      if (anyDelivered && updatedOrder?.status !== "shipped") {
        await db.collection("Orders").updateOne(
          { _id: toObjectId(orderId) },
          { $set: { status: "shipped" } }
        );
      }
    }

    res.status(200).json({ 
      success: true, 
      message: "Item marked as delivered successfully.",
      allDelivered: allDelivered
    });
  } catch (error) {
    console.error("Deliver item error:", error);
    res.status(500).json({ success: false, message: "Failed to mark item as delivered." });
  }
});

// DELETE/CANCEL: USER CANCELS OWN ORDER (with stock restore)
router.delete("/:id", requireAuth("user"), async (req: AuthedRequest, res: Response) => {
  try {
    const db = await connectToDatabase();
    const order = await db.collection("Orders").findOne({
      _id: toObjectId(req.params.id),
      userId: toObjectId(req.user!.id),
    });

    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found." });
    }
    
    if (!["pending", "paid"].includes(order.status)) {
      return res.status(400).json({ success: false, message: "This order can no longer be cancelled." });
    }

    // ✅ Restore stock for cancelled order
    for (const item of order.items) {
      await db.collection("Products").updateOne(
        { _id: toObjectId(item.productId) },
        { 
          $inc: { stock: item.quantity },
          $set: { updatedAt: new Date() }
        }
      );
      console.log(`Stock restored for ${item.name}: +${item.quantity}`);
    }

    await db.collection("Orders").updateOne(
      { _id: toObjectId(req.params.id) },
      { 
        $set: { 
          status: "cancelled", 
          cancelledAt: new Date(),
          updatedAt: new Date()
        } 
      }
    );

    res.status(200).json({ success: true, message: "Order cancelled and stock restored." });
  } catch (error) {
    console.error("Cancel order error:", error);
    res.status(500).json({ success: false, message: "Failed to cancel order." });
  }
});

// GET: CHECK IF ITEM CAN BE REVIEWED
router.get("/:orderId/review-eligibility/:productId", requireAuth("user"), async (req: AuthedRequest, res: Response) => {
  try {
    const db = await connectToDatabase();
    const { orderId, productId } = req.params;
    const userId = toObjectId(req.user!.id);

    const order = await db.collection("Orders").findOne({
      _id: toObjectId(orderId),
      userId
    });

    if (!order) {
      return res.status(200).json({ success: true, eligible: false, message: "Order not found." });
    }

    if (order.status !== "delivered") {
      return res.status(200).json({ success: true, eligible: false, message: "Order not delivered yet." });
    }

    const item = order.items.find(
      (i: any) => i.productId === productId || i.productId.toString() === productId
    );

    if (!item) {
      return res.status(200).json({ success: true, eligible: false, message: "Product not found in order." });
    }

    if (!item.delivered) {
      return res.status(200).json({ success: true, eligible: false, message: "This item hasn't been delivered yet." });
    }

    const existingReview = await db.collection("Reviews").findOne({
      productId: toObjectId(productId),
      userId,
      orderId: toObjectId(orderId)
    });

    res.status(200).json({ 
      success: true, 
      eligible: !existingReview,
      reviewed: !!existingReview
    });
  } catch (error) {
    console.error("Review eligibility error:", error);
    res.status(500).json({ success: false, message: "Failed to check eligibility." });
  }
});

// GET: SINGLE ORDER
router.get("/:id", requireAuth("user"), async (req: AuthedRequest, res: Response) => {
  try {
    const db = await connectToDatabase();
    const order = await db.collection("Orders").findOne({
      _id: toObjectId(req.params.id),
      userId: toObjectId(req.user!.id),
    });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found." });
    }
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    console.error("Fetch single order error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch order." });
  }
});

export default router;