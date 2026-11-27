# FixMate — REST API & Backend Server (`FixMate-Server`)

Backend REST API for **FixMate**, built with **Node.js**, **Express.js**, **MongoDB**, and **Stripe**. It handles public service search, filtering, sorting, and rating aggregations; role-based access control (`customer`, `technician`, `admin`); server-enforced job status pipelines; and Stripe Checkout payment verification[cite: 17, 21, 22, 30].

## Live URLs

- **Backend API Server:** https://fix-mate-server-iota.vercel.app
- **Client Web App:** https://fix-mate-client-sepia.vercel.app

## Demo Credentials

| Role | Email | Password |
| :--- | :--- | :--- |
| **Admin** | `Admin2@gmail.com` | `Sunny1451` |
| **Technician** | `technician3@gmail.com` | `Sunny1451` |
| **Customer** | `customer1@gmail.com` | `Sunny1451` |

## Database Architecture (`FixMatedb`)

Alongside Better Auth's authentication collections (`user`, `session`, `account`, `verification`), FixMate uses four core domain collections[cite: 18, 19, 20]:

1. **`user` (users):** Stores user profile and role fields (`name`, `email`, `image`, `role`, `phone`, `area`, `bio`)[cite: 18, 19].
2. **`services`:** Stores repair service listings (`title`, `category`, `description`, `image`, `basePrice`, `estimatedDuration`, `serviceMode`, `serviceArea`, `technicianName`, `technicianEmail`, `approvalStatus`, `isAvailable`, `createdAt`)[cite: 19, 20].
3. **`bookings`:** Stores repair requests, status pipeline transitions, `statusHistory`, `finalAmount`, `paymentStatus`, and post-payment `rating` & `review`[cite: 18, 20, 31].
4. **`payments`:** Stores verified Stripe Checkout payment records (`bookingId`, `serviceTitle`, `customerName`, `customerEmail`, `technicianName`, `technicianEmail`, `amount`, `currency`, `transactionId`, `stripeSessionId`, `paymentStatus`, `paidAt`)[cite: 20].

## Key Features & Workflow Rules

- **Server-Side Search, Filter & Sort:** Supports querying approved and available services by search term, category, service mode, and price/newest sorting directly in MongoDB[cite: 24, 30].
- **Role-Based Authorization:** Enforces `customer`, `technician`, and `admin` permissions so users can only access or modify authorized resources[cite: 22, 30].
- **Sequential Job Status Pipeline:**
  - `requested` → `accepted` or `rejected` (by the assigned technician)[cite: 21]
  - `requested` → `cancelled` (by the customer who created the booking)[cite: 21]
  - `accepted` → `in-progress` → `completed` with a positive `finalAmount` (by the assigned technician)[cite: 21]
  - `completed` + `unpaid` → `paid` (after Stripe payment confirmation, preventing duplicate payment records)[cite: 21, 22, 27]
- **Pay-After-Completion & Reviews:** Creates Stripe Checkout sessions from server-verified booking amounts, records payment details upon completion, and supports customer ratings and reviews after payment[cite: 21, 27, 31].

## Tech Stack & NPM Packages

- **Runtime & Framework:** `node`, `express`[cite: 31]
- **Database:** `mongodb`[cite: 17, 31]
- **Payments:** `stripe`[cite: 17, 31]
- **Middleware & Configuration:** `cors`, `dotenv`

## Environment Variables (`.env`)

Create a `.env` file in the root of `FixMate-Server`:

```env
PORT=8000
DB_USER=your_mongodb_atlas_username
DB_USER_PASSWORD=your_mongodb_atlas_password
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=whsec_your_stripe_webhook_secret
CLIENT_URL=http://localhost:3000
