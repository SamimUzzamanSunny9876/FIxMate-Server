import express from 'express'
import cors from 'cors'
import 'dotenv/config'
import { MongoClient, ObjectId } from 'mongodb';

const client = new MongoClient(`mongodb://${process.env.DB_USER}:${process.env.DB_USER_PASSWORD}@ac-qptuiex-shard-00-00.xuksm8z.mongodb.net:27017,ac-qptuiex-shard-00-01.xuksm8z.mongodb.net:27017,ac-qptuiex-shard-00-02.xuksm8z.mongodb.net:27017/?ssl=true&replicaSet=atlas-psa02l-shard-0&authSource=admin`);
const app = express()
const port = process.env.PORT || 8000

app.use(
  cors({
    origin: [
      "http://localhost:3000",
      process.env.CLIENT_URL, // Add your deployed Vercel URL here for production
    ].filter(Boolean),
    credentials: true,
  })
);
app.use(express.json())

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

const connectedClient = await connectToMongoDB()
const database =  connectedClient.db('FixMatedb')
const users = database.collection('user');
const services = database.collection('services')
const bookings = database.collection('bookings')
const payments = database.collection('payments')
// const users = database.collection('users');



app.get('/', (req, res) =>{
    res.send('Server is servering')
}) 

app.get('/users', async (req, res)=> {
    const result = await users.find().toArray();
    res.send(result);
})

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

app.post('/bookings' , async(req, res ) =>{
  const booking = req.body
  const result = await bookings.insertOne(booking)

  res.send(result)
})

//Service details api 

app.get('/browse-services/:id', async(req,res)=>{
  const {id} = req.params
  const result = await services.findOne({ _id: new ObjectId(id) })
  res.send(result)

})

//technician services apis

app.post('/services', async(req, res) =>{
    const service = req.body
    const result =  await services.insertOne(service);
    res.send(result)
})

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
app.delete('/services/:id' , async (req,res)=> {
   const {id} = req.params
   const result = await services.deleteOne({_id: new ObjectId(id)})
   res.send(result)
} )


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

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});