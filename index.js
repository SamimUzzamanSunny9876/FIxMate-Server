import express from "express";
import cors from "cors";
import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const client = new MongoClient(
  `mongodb://${process.env.DB_USER}:${process.env.DB_USER_PASSWORD}@ac-qptuiex-shard-00-00.xuksm8z.mongodb.net:27017,ac-qptuiex-shard-00-01.xuksm8z.mongodb.net:27017,ac-qptuiex-shard-00-02.xuksm8z.mongodb.net:27017/?ssl=true&replicaSet=atlas-psa02l-shard-0&authSource=admin`,
);
const app = express();
const port = process.env.PORT || 8000;

app.use(
  cors({
    origin: ["http://localhost:3000", process.env.CLIENT_URL].filter(Boolean),
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(express.json());

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const connectedClient = await connectToMongoDB();
const database = connectedClient.db("FixMatedb");
const users = database.collection("user");
const services = database.collection("services");
const sessions = database.collection("session");
const bookings = database.collection("bookings");
const payments = database.collection("payments");

app.get("/", (req, res) => {
  res.send("Server is servering");
});

const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).send({ message: "Unauthorized" });
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
      return res.status(401).send({ message: "Unauthorized" });
    }

    const session = await sessions.findOne({ token });
    if (!session) {
      return res.status(401).send({ message: "Unauthorized" });
    }

    const userId = session.userId;
    const userQuery = ObjectId.isValid(userId)
      ? { _id: new ObjectId(userId) }
      : { _id: userId };

    const user = await users.findOne(userQuery);
    if (!user) {
      return res.status(401).send({ message: "Unauthorized" });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).send({ message: "Unauthorized" });
  }
};

const verifyRole = (allowedRoles) => (req, res, next) => {
  const role = req.user?.role || "customer";
  if (!allowedRoles.includes(role)) {
    return res
      .status(403)
      .send({ message: "Forbidden: Insufficient permissions." });
  }
  next();
};

const verifyCustomer = verifyRole(["customer"]);
const verifyTechnician = verifyRole(["technician"]);
const verifyAdmin = verifyRole(["admin"]);

async function attachRatingsToServices(serviceDocs) {
  if (!Array.isArray(serviceDocs) || serviceDocs.length === 0) {
    return serviceDocs;
  }

  const stringIds = serviceDocs.map((s) => String(s._id));
  const objectIds = stringIds
    .filter((id) => ObjectId.isValid(id))
    .map((id) => new ObjectId(id));

  const ratingStats = await bookings
    .aggregate([
      {
        $match: {
          serviceId: { $in: [...stringIds, ...objectIds] },
          paymentStatus: "paid",
          rating: { $gte: 1, $lte: 5 },
        },
      },
      {
        $group: {
          _id: { $toString: "$serviceId" },
          avgRating: { $avg: "$rating" },
          reviewCount: { $sum: 1 },
        },
      },
    ])
    .toArray();

  const statsMap = new Map(
    ratingStats.map((item) => [
      String(item._id),
      {
        averageRating: Number(item.avgRating.toFixed(1)),
        reviewCount: item.reviewCount,
      },
    ]),
  );

  return serviceDocs.map((doc) => {
    const stat = statsMap.get(String(doc._id));
    return {
      ...doc,
      averageRating: stat ? stat.averageRating : 0,
      reviewCount: stat ? stat.reviewCount : 0,
    };
  });
}

app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
  const result = await users.find().toArray();
  res.send(result);
});

// Public Browse Services (Search, Filter & Sort)
app.get("/browse-services", async (req, res) => {
  try {
    const { search, category, serviceMode, sort } = req.query;

    const query = {
      approvalStatus: "approved",
      isAvailable: true,
    };

    if (category && category !== "all") {
      query.category = category;
    }

    if (serviceMode && serviceMode !== "all") {
      query.serviceMode = serviceMode;
    }

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { category: { $regex: search, $options: "i" } },
        { serviceArea: { $regex: search, $options: "i" } },
      ];
    }

    let sortOption = { createdAt: -1 };
    if (sort === "price_asc") sortOption = { basePrice: 1 };
    if (sort === "price_desc") sortOption = { basePrice: -1 };
    if (sort === "newest") sortOption = { createdAt: -1 };

    const result = await services.find(query).sort(sortOption).toArray();
    const enriched = await attachRatingsToServices(result);
    res.send(enriched);
  } catch (err) {
    res.status(500).send({ message: "Failed to fetch services." });
  }
});

// Public Service Details
app.get("/browse-services/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(404).send({ message: "Service not found." });
    }

    const serviceDoc = await services.findOne({ _id: new ObjectId(id) });
    if (!serviceDoc) {
      return res.status(404).send({ message: "Service not found." });
    }

    const [enrichedService] = await attachRatingsToServices([serviceDoc]);

    const reviewsList = await bookings
      .find(
        {
          serviceId: { $in: [String(serviceDoc._id), serviceDoc._id] },
          paymentStatus: "paid",
          rating: { $gte: 1, $lte: 5 },
        },
        {
          projection: {
            _id: 1,
            customerName: 1,
            rating: 1,
            review: 1,
            reviewedAt: 1,
            paidAt: 1,
          },
        },
      )
      .sort({ reviewedAt: -1, paidAt: -1 })
      .limit(20)
      .toArray();

    res.send({
      ...enrichedService,
      reviews: reviewsList,
    });
  } catch (err) {
    res.status(500).send({ message: "Failed to load service details." });
  }
});

//review patch
app.patch("/bookings/:id/review", async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, review, customerEmail } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid booking ID." });
    }

    const numericRating = Number(rating);
    if (
      !Number.isInteger(numericRating) ||
      numericRating < 1 ||
      numericRating > 5
    ) {
      return res
        .status(400)
        .send({ message: "Rating must be a whole number from 1 to 5." });
    }

    const cleanReview = typeof review === "string" ? review.trim() : "";
    if (!cleanReview) {
      return res.status(400).send({ message: "Please write a short review." });
    }

    const bookingDoc = await bookings.findOne({ _id: new ObjectId(id) });
    if (!bookingDoc) {
      return res.status(404).send({ message: "Booking not found." });
    }

    if (
      customerEmail &&
      bookingDoc.customerEmail?.toLowerCase() !==
        String(customerEmail).toLowerCase()
    ) {
      return res
        .status(403)
        .send({ message: "Only the customer who booked can leave a review." });
    }

    if (bookingDoc.paymentStatus !== "paid") {
      return res.status(400).send({
        message: "You can submit a rating and review after payment is completed.",
      });
    }

    const reviewedAt = new Date().toISOString();

    await bookings.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          rating: numericRating,
          review: cleanReview,
          reviewedAt,
        },
      },
    );

    const updatedBooking = await bookings.findOne({ _id: new ObjectId(id) });
    res.send({
      message: "Thank you! Your rating and review have been saved.",
      booking: updatedBooking,
    });
  } catch (err) {
    res.status(500).send({ message: "Failed to save review." });
  }
});

// Booking post api (Customer)
app.post("/bookings", verifyToken, verifyCustomer, async (req, res) => {
  const booking = req.body;
  const result = await bookings.insertOne(booking);
  res.send(result);
});

// Technician services apis
app.post("/services", verifyToken, verifyTechnician, async (req, res) => {
  const service = req.body;
  const result = await services.insertOne(service);
  res.send(result);
});

app.get("/services", verifyToken, verifyTechnician, async (req, res) => {
  const { technicianEmail } = req.query;
  const query = technicianEmail
    ? { technicianEmail }
    : { approvalStatus: "approved", isAvailable: true };

  const result = await services.find(query).sort({ createdAt: -1 }).toArray();
  res.send(result);
});

app.get("/services/:id", verifyToken, async (req, res) => {
  const query = { _id: new ObjectId(req.params.id) };
  const result = await services.findOne(query);
  res.send(result);
});

app.patch("/services/:id", verifyToken, verifyTechnician, async (req, res) => {
  const query = { _id: new ObjectId(req.params.id) };
  const updatedDoc = { $set: req.body };
  const result = await services.updateOne(query, updatedDoc);
  res.send(result);
});

app.delete("/services/:id", verifyToken, verifyTechnician, async (req, res) => {
  const { id } = req.params;
  const result = await services.deleteOne({ _id: new ObjectId(id) });
  res.send(result);
});

// Get bookings (filtered by customerEmail or technicianEmail)
app.get("/bookings", verifyToken, async (req, res) => {
  const { customerEmail, technicianEmail } = req.query;
  const query = {};

  if (customerEmail) query.customerEmail = customerEmail;
  if (technicianEmail) query.technicianEmail = technicianEmail;

  const result = await bookings.find(query).sort({ createdAt: -1 }).toArray();
  res.send(result);
});

// Status update api for booking (Customer cancel / Technician status pipeline)
app.patch("/bookings/:id", verifyToken, async (req, res) => {
  try {
    const query = { _id: new ObjectId(req.params.id) };
    const booking = await bookings.findOne(query);

    if (!booking) {
      return res.status(404).send({ message: "Booking not found." });
    }

    const { status: nextStatus, finalAmount } = req.body;
    const currentStatus = booking.status;
    const role = req.user.role || "customer";

    // Customer: can only cancel their own booking while it is still 'requested'
    if (role === "customer") {
      if (booking.customerEmail !== req.user.email) {
        return res
          .status(403)
          .send({ message: "Forbidden: Not your booking." });
      }
      if (currentStatus !== "requested" || nextStatus !== "cancelled") {
        return res.status(400).send({
          message: "You can only cancel a booking while it is requested.",
        });
      }
    }
    // Technician: can only update their own job, one valid step forward at a time
    else if (role === "technician") {
      if (booking.technicianEmail !== req.user.email) {
        return res.status(403).send({
          message: "Forbidden: Only the job owner can update status.",
        });
      }

      const validTransitions = {
        requested: ["accepted", "rejected"],
        accepted: ["in-progress"],
        "in-progress": ["completed"],
      };

      const allowedNext = validTransitions[currentStatus] || [];
      if (!allowedNext.includes(nextStatus)) {
        return res.status(400).send({
          message: `Invalid status change from '${currentStatus}' to '${nextStatus}'.`,
        });
      }

      if (nextStatus === "completed") {
        const parsedAmount = Number(finalAmount ?? booking.basePrice);
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
          return res
            .status(400)
            .send({ message: "Final amount must be greater than 0." });
        }
      }
    } else {
      return res.status(403).send({ message: "Forbidden." });
    }

    const setFields = { status: nextStatus };
    if (nextStatus === "completed") {
      setFields.finalAmount = Number(finalAmount ?? booking.basePrice);
    }

    const result = await bookings.updateOne(query, {
      $set: setFields,
      $push: {
        statusHistory: { status: nextStatus, changedAt: new Date() },
      },
    });

    res.send(result);
  } catch (err) {
    console.error("PATCH /bookings/:id error:", err);
    res
      .status(500)
      .send({ message: err.message || "Failed to update booking." });
  }
});

// Get single user profile by email
app.get("/user/:email", verifyToken, async (req, res) => {
  const email = req.params.email;
  const result = await users.findOne({ email });
  res.send(result);
});

// Update user profile by email
app.patch("/user/:email", verifyToken, async (req, res) => {
  const email = req.params.email;
  const { name, image, phone, area, bio } = req.body;

  const updatedDoc = {
    $set: {
      name,
      image,
      phone,
      area,
      bio,
    },
  };

  const result = await users.updateOne({ email }, updatedDoc);
  res.send(result);
});

// Payment apis
// 1. Get payment history (supports customerEmail, technicianEmail, or all for admin)
app.get("/payments", verifyToken, async (req, res) => {
  try {
    const { customerEmail, technicianEmail } = req.query;
    const query = {};

    if (customerEmail) query.customerEmail = customerEmail;
    if (technicianEmail) query.technicianEmail = technicianEmail;

    const result = await payments.find(query).sort({ paidAt: -1 }).toArray();
    res.send(result);
  } catch (err) {
    res
      .status(500)
      .send({ message: err.message || "Failed to fetch payments." });
  }
});

// 2. Create Stripe Checkout Session for a completed & unpaid booking
app.post(
  "/create-checkout-session",
  verifyToken,
  verifyCustomer,
  async (req, res) => {
    try {
      const { bookingId } = req.body;
      const booking = await bookings.findOne({ _id: new ObjectId(bookingId) });

      if (!booking) {
        return res.status(404).send({ message: "Booking not found." });
      }
      if (booking.status !== "completed") {
        return res.status(400).send({
          message: "Payment is only allowed after repair completion.",
        });
      }
      if (booking.paymentStatus === "paid") {
        return res
          .status(400)
          .send({ message: "This booking is already paid." });
      }

      const amount = Number(booking.finalAmount ?? booking.basePrice);
      const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";

      const session = await stripe.checkout.sessions.create({
        allowed_payment_method_types: ["card"],
        mode: "payment",
        customer_email: booking.customerEmail,
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: booking.serviceTitle,
                description: `Repair by ${booking.technicianName} (${booking.category})`,
                images: booking.serviceImage ? [booking.serviceImage] : [],
              },
              unit_amount: Math.round(amount * 100),
            },
            quantity: 1,
          },
        ],
        metadata: {
          bookingId: booking._id.toString(),
        },
        success_url: `${clientUrl}/dashboard/customer/payments/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${clientUrl}/dashboard/customer/payments?canceled=true`,
      });

      res.send({ url: session.url });
    } catch (err) {
      console.error("Stripe checkout error:", err);
      res
        .status(500)
        .send({ message: err.message || "Failed to create Stripe session." });
    }
    if (booking.customerEmail !== req.user.email) {
      return res
        .status(403)
        .send({ message: "Forbidden: You can only pay for your own booking." });
    }
  },
);

// 3. Verify Stripe Checkout Session, save Payment, and mark Booking as paid
app.post(
  "/payments/verify-session",
  verifyToken,
  verifyCustomer,
  async (req, res) => {
    try {
      const { sessionId } = req.body;
      if (!sessionId) {
        return res.status(400).send({ message: "Session ID is required." });
      }

      const existingPayment = await payments.findOne({
        stripeSessionId: sessionId,
      });
      if (existingPayment) {
        return res.send(existingPayment);
      }

      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status !== "paid") {
        return res
          .status(400)
          .send({ message: "Payment has not been completed." });
      }

      const bookingId = session.metadata?.bookingId;
      const booking = await bookings.findOne({ _id: new ObjectId(bookingId) });
      if (!booking) {
        return res
          .status(404)
          .send({ message: "Associated booking not found." });
      }

      const paymentDoc = {
        bookingId: booking._id.toString(),
        serviceTitle: booking.serviceTitle,
        customerName: booking.customerName,
        customerEmail: booking.customerEmail,
        technicianName: booking.technicianName,
        technicianEmail: booking.technicianEmail,
        amount: (session.amount_total || 0) / 100,
        currency: "usd",
        transactionId:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.id,
        stripeSessionId: session.id,
        paymentStatus: "paid",
        paidAt: new Date(),
      };

      await payments.updateOne(
        { stripeSessionId: session.id },
        { $setOnInsert: paymentDoc },
        { upsert: true },
      );

      const savedPayment = await payments.findOne({
        stripeSessionId: session.id,
      });

      if (booking.paymentStatus !== "paid") {
        await bookings.updateOne(
          { _id: new ObjectId(bookingId) },
          {
            $set: { paymentStatus: "paid" },
            $push: {
              statusHistory: { status: "paid", changedAt: new Date() },
            },
          },
        );
      }

      res.send(savedPayment);
    } catch (err) {
      if (err.code === 11000) {
        const saved = await payments.findOne({
          stripeSessionId: req.body.sessionId,
        });
        return res.send(saved);
      }
      console.error("Verify payment error:", err);
      res
        .status(500)
        .send({ message: err.message || "Failed to verify Stripe payment." });
    }
  },
);

// Admin APIs
app.get("/admin/services", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    const query = {};
    if (status && status !== "all") {
      query.approvalStatus = status;
    }

    const result = await services.find(query).sort({ createdAt: -1 }).toArray();
    res.send(result);
  } catch (err) {
    console.error("GET /admin/services error:", err);
    res
      .status(500)
      .send({ message: err.message || "Failed to fetch services." });
  }
});

app.patch(
  "/admin/services/:id/approval",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const { approvalStatus } = req.body;
      const allowed = ["pending", "approved", "rejected"];

      if (!allowed.includes(approvalStatus)) {
        return res.status(400).send({ message: "Invalid approval status." });
      }

      const query = { _id: new ObjectId(req.params.id) };
      const updatedDoc = {
        $set: { approvalStatus },
      };

      const result = await services.updateOne(query, updatedDoc);
      res.send(result);
    } catch (err) {
      console.error("PATCH /admin/services/:id/approval error:", err);
      res
        .status(500)
        .send({ message: err.message || "Failed to update approval status." });
    }
  },
);

app.patch(
  "/admin/users/:email/role",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    const email = req.params.email;
    const { role } = req.body;
    const allowedRoles = ["customer", "technician", "admin"];

    if (!allowedRoles.includes(role)) {
      return res.status(400).send({ message: "Invalid role specified" });
    }

    const updateDoc = { $set: { role } };
    const result = await users.updateOne({ email }, updateDoc);
    res.send(result);
  },
);

app.delete(
  "/admin/users/:email",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    const email = req.params.email;
    const result = await users.deleteOne({ email });
    res.send(result);
  },
);

app.get("/admin/bookings", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { status, paymentStatus } = req.query;
    const query = {};

    if (status && status !== "all") query.status = status;
    if (paymentStatus && paymentStatus !== "all") {
      query.paymentStatus = paymentStatus;
    }

    const result = await bookings.find(query).sort({ createdAt: -1 }).toArray();
    res.send(result);
  } catch (err) {
    console.error("GET /admin/bookings error:", err);
    res
      .status(500)
      .send({ message: err.message || "Failed to fetch all bookings." });
  }
});

app.patch(
  "/admin/bookings/:id/status",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const { status } = req.body;
      const allowedStatuses = [
        "requested",
        "accepted",
        "in-progress",
        "completed",
        "cancelled",
        "rejected",
      ];

      if (!allowedStatuses.includes(status)) {
        return res.status(400).send({ message: "Invalid booking status." });
      }

      const result = await bookings.updateOne(
        { _id: new ObjectId(req.params.id) },
        {
          $set: { status },
          $push: {
            statusHistory: { status, changedAt: new Date() },
          },
        },
      );

      if (result.matchedCount === 0) {
        return res.status(404).send({ message: "Booking not found." });
      }

      res.send(result);
    } catch (err) {
      console.error("PATCH /admin/bookings/:id/status error:", err);
      res
        .status(500)
        .send({ message: err.message || "Failed to update booking status." });
    }
  },
);

app.delete(
  "/admin/bookings/:id",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const result = await bookings.deleteOne({
        _id: new ObjectId(req.params.id),
      });

      if (result.deletedCount === 0) {
        return res.status(404).send({ message: "Booking not found." });
      }

      res.send(result);
    } catch (err) {
      console.error("DELETE /admin/bookings/:id error:", err);
      res
        .status(500)
        .send({ message: err.message || "Failed to delete booking." });
    }
  },
);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

export default app;