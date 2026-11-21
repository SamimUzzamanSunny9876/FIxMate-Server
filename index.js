import express from 'express'
import cors from 'cors'
import 'dotenv/config'
import { MongoClient } from 'mongodb';

const client = new MongoClient(`mongodb://${process.env.DB_USER}:${process.env.DB_USER_PASSWORD}@ac-qptuiex-shard-00-00.xuksm8z.mongodb.net:27017,ac-qptuiex-shard-00-01.xuksm8z.mongodb.net:27017,ac-qptuiex-shard-00-02.xuksm8z.mongodb.net:27017/?ssl=true&replicaSet=atlas-psa02l-shard-0&authSource=admin`);
const app = express()
const port = process.env.PORT || 8000

app.use(cors())
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


app.get('/', (req, res) =>{
    res.send('Server is servering')
}) 

app.get('/users', async (req, res)=> {
    const result = await users.find().toArray();
    res.send(result);
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});