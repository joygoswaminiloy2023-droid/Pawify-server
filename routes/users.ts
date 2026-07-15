import express from "express";
import { connectToDatabase, toObjectId } from "../lib/db.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = express.Router();

router.get("/me", requireAuth("user"), async (req: any, res: any) => {
  try {
    const db = await connectToDatabase();
    const user = await db.collection("user").findOne(
      { _id: toObjectId(req.user.id) },
      { projection: { password: 0 } }
    );
    if (!user) return res.status(404).json({ success: false, message: "User not found." });
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch profile." });
  }
});

router.patch("/profile", requireAuth("user"), async (req: any, res: any) => {
  try {
    const db = await connectToDatabase();
    const { name, phone, address, image } = req.body;

    const result = await db.collection("user").updateOne(
      { _id: toObjectId(req.user.id) },
      {
        $set: {
          ...(name !== undefined && { name }),
          ...(phone !== undefined && { phone }),
          ...(address !== undefined && { address }),
          ...(image !== undefined && { image }),
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    res.status(200).json({ success: true, message: "Profile updated successfully." });
  } catch (error) {
    console.error("Profile update error:", error);
    res.status(500).json({ success: false, message: "Failed to update profile." });
  }
});

export default router;