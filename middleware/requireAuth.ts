import { Request, Response, NextFunction } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { getAuth } from "../lib/auth.js";

export interface AuthedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    status: string;
  };
}

export function requireAuth(...allowedRoles: string[]) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const auth = await getAuth();
      if (!auth) {
        return res.status(500).json({ success: false, message: "Auth not initialized." });
      }
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });

      if (!session) {
        return res.status(401).json({ success: false, message: "Not authenticated." });
      }

      const userDoc = session.user as any;

      if (userDoc.status === "banned") {
        return res.status(403).json({ success: false, message: "Account banned." });
      }

      if (allowedRoles.length && !allowedRoles.includes(userDoc.role)) {
        return res.status(403).json({ success: false, message: "Insufficient permissions." });
      }

      req.user = {
        id: String(userDoc.id),
        email: userDoc.email,
        role: userDoc.role,
        status: userDoc.status,
      };

      next();
    } catch (error) {
      console.error("Auth error:", error);
      return res.status(401).json({ success: false, message: "Not authenticated." });
    }
  };
}