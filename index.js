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
    origin: [
      "http://localhost:3000",
      process.env.CLIENT_URL, // Add your deployed Vercel URL here for production
    ].filter(Boolean),
    credentials: true,
  }),
);
app.use(express.json());

// http://localhost:3000/

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
const bookings = database.collection("bookings");
const payments = database.collection("payments");
// const users = database.collection('users');

app.get("/", (req, res) => {
  res.send("Server is servering");
});

app.get("/users", async (req, res) => {
  const result = await users.find().toArray();
  res.send(result);
});

//browse services api
// Public Browse Services (Search, Filter & Sort)
app.get("/browse-services", async (req, res) => {
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
  res.send(result);
});

// boooking post api

app.post("/bookings", async (req, res) => {
  const booking = req.body;
  const result = await bookings.insertOne(booking);

  res.send(result);
});

//Service details api

app.get("/browse-services/:id", async (req, res) => {
  const { id } = req.params;
  const result = await services.findOne({ _id: new ObjectId(id) });
  res.send(result);
});

//technician services apis

app.post("/services", async (req, res) => {
  const service = req.body;
  const result = await services.insertOne(service);
  res.send(result);
});

app.get("/services", async (req, res) => {
  const { technicianEmail } = req.query;
  const query = technicianEmail
    ? { technicianEmail }
    : { approvalStatus: "approved", isAvailable: true };

  const result = await services.find(query).sort({ createdAt: -1 }).toArray();
  res.send(result);
});

app.get("/services/:id", async (req, res) => {
  const query = { _id: new ObjectId(req.params.id) };
  const result = await services.findOne(query);
  res.send(result);
});

app.patch("/services/:id", async (req, res) => {
  const query = { _id: new ObjectId(req.params.id) };
  const updatedDoc = { $set: req.body };
  const result = await services.updateOne(query, updatedDoc);
  res.send(result);
});
app.delete("/services/:id", async (req, res) => {
  const { id } = req.params;
  const result = await services.deleteOne({ _id: new ObjectId(id) });
  res.send(result);
});

// Get bookings (filtered by customerEmail or technicianEmail)
app.get("/bookings", async (req, res) => {
  const { customerEmail, technicianEmail } = req.query;
  const query = {};

  if (customerEmail) query.customerEmail = customerEmail;
  if (technicianEmail) query.technicianEmail = technicianEmail;

  const result = await bookings.find(query).sort({ createdAt: -1 }).toArray();
  res.send(result);
});

// Update booking status (e.g. customer cancels a requested booking)
app.patch("/bookings/:id", async (req, res) => {
  const query = { _id: new ObjectId(req.params.id) };
  const updatedDoc = { $set: req.body };
  const result = await bookings.updateOne(query, updatedDoc);
  res.send(result);
});

//update profile api
// Get single user profile by email
app.get("/user/:email", async (req, res) => {
  const email = req.params.email;
  const result = await users.findOne({ email });
  res.send(result);
});

// Update user profile by email
app.patch("/user/:email", async (req, res) => {
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

// Payment relateve apis
// 1. Get payment history (supports customerEmail, technicianEmail, or all for admin)
app.get("/payments", async (req, res) => {
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
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { bookingId } = req.body;
    const booking = await bookings.findOne({ _id: new ObjectId(bookingId) });

    if (!booking) {
      return res.status(404).send({ message: "Booking not found." });
    }
    if (booking.status !== "completed") {
      return res
        .status(400)
        .send({ message: "Payment is only allowed after repair completion." });
    }
    if (booking.paymentStatus === "paid") {
      return res.status(400).send({ message: "This booking is already paid." });
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
            unit_amount: Math.round(amount * 100), // Stripe uses cents
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
});

// 3. Verify Stripe Checkout Session, save Payment, and mark Booking as paid
// Inside your MongoDB run() function (optional but guarantees uniqueness at the DB level):
// await payments.createIndex({ stripeSessionId: 1 }, { unique: true });

app.post("/payments/verify-session", async (req, res) => {
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
      return res.status(400).send({ message: "Payment has not been completed." });
    }

    const bookingId = session.metadata?.bookingId;
    const booking = await bookings.findOne({ _id: new ObjectId(bookingId) });
    if (!booking) {
      return res.status(404).send({ message: "Associated booking not found." });
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

    // Atomic upsert prevents duplicate inserts even on simultaneous requests
    await payments.updateOne(
      { stripeSessionId: session.id },
      { $setOnInsert: paymentDoc },
      { upsert: true }
    );

    const savedPayment = await payments.findOne({
      stripeSessionId: session.id,
    });

    // Only update booking if not already marked paid
    if (booking.paymentStatus !== "paid") {
      await bookings.updateOne(
        { _id: new ObjectId(bookingId) },
        {
          $set: { paymentStatus: "paid" },
          $push: {
            statusHistory: { status: "paid", changedAt: new Date() },
          },
        }
      );
    }

    res.send(savedPayment);
  } catch (err) {
    // Handle duplicate key race condition gracefully if unique index is enabled
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
});
// status update api for booking
app.patch("/bookings/:id", async (req, res) => {
  try {
    const query = { _id: new ObjectId(req.params.id) };
    const { status, finalAmount } = req.body;

    const setFields = {};
    if (status) setFields.status = status;
    if (finalAmount !== undefined) setFields.finalAmount = Number(finalAmount);

    const updateDoc = { $set: setFields };

    if (status) {
      updateDoc.$push = {
        statusHistory: { status, changedAt: new Date() },
      };
    }

    const result = await bookings.updateOne(query, updateDoc);
    res.send(result);
  } catch (err) {
    console.error("PATCH /bookings/:id error:", err);
    res
      .status(500)
      .send({ message: err.message || "Failed to update booking." });
  }
});

// Get all services for Admin review (pending first, then newest)
app.get("/admin/services", async (req, res) => {
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

// Approve or Reject a service listing
app.patch("/admin/services/:id/approval", async (req, res) => {
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
});

// admin user role update api 

app.patch("/admin/users/:email/role", async (req,res)=>{
  const email =req.params.email;
   
  const  {role} = req.body;
  const allowedRoles = ['customer', 'technician', 'admin'];
  if(!allowedRoles.includes(role)){
    return res.status(400).send({message: 'Invalid role specified'})

  }
  const updateDoc = {
    $set: {role: role}
  }

  const result = await users.updateOne( {email: email} , updateDoc);
  res.send(result);

  })

// delete user api for admin 

app.delete("/admin/Users/:email", async (req,res)=> {
  const email = req.params.email;
  const result = await users.deleteOne({email: email});
  res.send(result);
}) 

// 1. Get all bookings across the platform (newest first)
app.get("/admin/bookings", async (req, res) => {
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

// 2. Admin override: update booking status
app.patch("/admin/bookings/:id/status", async (req, res) => {
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
        $set: { status },$push: {
          statusHistory: { status, changedAt: new Date() },
        },
      }
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
});

// 3. Delete a booking record
app.delete("/admin/bookings/:id", async (req, res) => {
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
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
