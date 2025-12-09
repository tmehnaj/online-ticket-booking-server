const express = require('express');
const app = express();
const cors = require("cors");
require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');
const admin = require("firebase-admin");

const serviceAccount = require("./online-ticket-booking-firebase-admin-sdk-.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const port = process.env.PORT || 3000;


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@customcluster.mlvrouu.mongodb.net/?appName=CustomCluster`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});


//middleware
app.use(express.json());
app.use(cors());



async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('Hello World! We support online ticket booking!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
