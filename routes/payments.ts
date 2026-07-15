// routes/payments.ts
import express, { Response } from "express";
import Stripe from "stripe";
import { connectToDatabase, toObjectId } from "../lib/db.js";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth.js";

const router = express.Router();
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

// POST: CREATE CHECKOUT SESSION
router.post("/create-checkout-session", requireAuth("user"), async (req: AuthedRequest, res: Response) => {
  try {
    if (!stripe) return res.status(500).json({ success: false, message: "Stripe not configured." });

    const db = await connectToDatabase();
    const { orderId } = req.body;
    const order = await db.collection("Orders").findOne({ _id: toObjectId(orderId) });
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: order.items.map((item: any) => ({
        price_data: {
          currency: "bdt",
          product_data: { name: item.name },
          unit_amount: Math.round(item.price * 100),
        },
        quantity: item.quantity,
      })),
      success_url: `${process.env.CLIENT_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}&orderId=${orderId}`,
      cancel_url: `${process.env.CLIENT_URL}/checkout/cancel`,
      metadata: { orderId, userId: req.user!.id },
    });

    res.status(200).json({ success: true, url: session.url, sessionId: session.id });
  } catch (error) {
    console.error("Stripe session error:", error);
    res.status(500).json({ success: false, message: "Failed to create checkout session." });
  }
});

// POST: CONFIRM PURCHASE (idempotent — same race-condition fix as RecipeHub)
router.post("/confirm-purchase", requireAuth("user"), async (req: AuthedRequest, res: Response) => {
  try {
    if (!stripe) return res.status(500).json({ success: false, message: "Stripe not configured." });

    const { sessionId, orderId } = req.body;
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid") {
      return res.status(400).json({ success: false, message: "Payment not completed." });
    }

    const db = await connectToDatabase();

    const existingPayment = await db.collection("Payments").findOne({ transactionId: session.id });
    if (existingPayment) {
      return res.status(200).json({ success: true, message: "Already confirmed." });
    }

    const order = await db.collection("Orders").findOne({ _id: toObjectId(orderId) });
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });

    await db.collection("Payments").insertOne({
      orderId: toObjectId(orderId),
      userId: toObjectId(req.user!.id),
      amount: order.totalAmount,
      stripeSessionId: session.id,
      transactionId: session.id,
      status: "completed",
      createdAt: new Date(),
    });

    await db.collection("Orders").updateOne(
      { _id: toObjectId(orderId) },
      { $set: { status: "paid", transactionId: session.id, paidAt: new Date() } }
    );

    // bump vendor totalSales
    await db.collection("Vendors").updateOne(
      { _id: order.vendorId },
      { $inc: { totalSales: order.totalAmount } }
    );

    res.status(200).json({ success: true, message: "Purchase confirmed." });
  } catch (error) {
    console.error("Confirm purchase error:", error);
    res.status(500).json({ success: false, message: "Failed to confirm purchase." });
  }
});

// GET: POLL PURCHASE STATUS (client retries against this)
router.get("/status/:orderId", requireAuth("user"), async (req: AuthedRequest, res: Response) => {
  try {
    const db = await connectToDatabase();
    const order = await db.collection("Orders").findOne({ _id: toObjectId(req.params.orderId) });
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });
    res.status(200).json({ success: true, status: order.status });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to check status." });
  }
});

export default router;