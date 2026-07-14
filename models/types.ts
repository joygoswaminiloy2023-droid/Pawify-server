import { ObjectId } from "mongodb";

export interface PawifyUser {
  _id?: ObjectId;
  name: string;
  email: string;
  role: "user" | "vendor" | "admin";
  status: "active" | "restricted" | "banned";
  phone?: string;
  address?: string;
  createdAt: Date;
}

export interface Vendor {
  _id?: ObjectId;
  userId: ObjectId;
  shopName: string;
  description: string;
  logo?: string;
  banner?: string;
  status: "pending" | "approved" | "revoked" | "rejected";
  rating: number;
  totalSales: number;
  createdAt: Date;
}

export interface Product {
  _id?: ObjectId;
  vendorId: ObjectId;
  name: string;
  category: string;
  petType: string;
  description: string;
  price: number;
  stock: number;
  images: string[];
  isActive: boolean;
  approvalStatus: "pending" | "approved" | "rejected";
  createdAt: Date;
}

export interface Review {
  _id?: ObjectId;
  productId: ObjectId;
  userId: ObjectId;
  userName: string;
  orderId: ObjectId;
  rating: number;
  comment: string;
  createdAt: Date;
}

export interface Order {
  _id?: ObjectId;
  userId: ObjectId;
  vendorId: ObjectId;
  items: { productId: ObjectId; name: string; price: number; quantity: number }[];
  totalAmount: number;
  status: "pending" | "paid" | "shipped" | "delivered" | "cancelled";
  shippingAddress: string;
  transactionId?: string;
  createdAt: Date;
}

export interface Payment {
  _id?: ObjectId;
  orderId: ObjectId;
  userId: ObjectId;
  amount: number;
  stripeSessionId: string;
  status: "pending" | "completed" | "failed";
  createdAt: Date;
}