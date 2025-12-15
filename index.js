const express = require('express');
const app = express();
const cors = require("cors");
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
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

const verifyFirebaseToken = async (req, res, next) => {
  const token = req.headers.authorization;
  // console.log(token);
  if (!token) {
    return res.status(401).json({ message: "unauthorized access" });
  }

  try {
    const idToken = token.split(' ')[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    // console.log('decoded in the verify ', decoded);
    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    return res.status(401).json({ message: "unauthorized access" });
  }


}


async function run() {
  try {

    const db = client.db('ticketDB');
    const usersCollection = db.collection('users');
    const ticketsCollection = db.collection('tickets');

     //admin verify middlewAre

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await usersCollection.findOne(query);

      if (!user || user?.role !== 'admin') {
        return res.status(403).json({ message: 'forbidden access' });
      }

      next();
    }

    const verifyVendor = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await usersCollection.findOne(query);

      if (!user || user.role !== 'vendor') {
        return res.status(403).send({ message: 'forbidden access' });
      }

      next();
    }


    //users related apis

     app.get('/users', verifyFirebaseToken, async (req, res) => {
      const search = req.query.searchText;
      const query = {};
      if (search) {
        query.$or = [
          { displayName: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } }
        ];
      }

      // if(query){
      //   const cursor = usersCollection.find(query).sort({createdAt: -1}).limit(4);
      // const result = await cursor.toArray();
      // }
      const cursor = usersCollection.find(query).sort({ createdAt: -1 }).limit(4);
      const result = await cursor.toArray();
      res.send(result);
    })
   

    app.get('/users/:email/role',verifyFirebaseToken,async(req,res)=>{
      const email = req.params.email;
      const query =  { email };
      const result = await usersCollection.findOne(query);
      res.send({role: result?.role || 'user'});
    })

    
    app.post('/users',async(req,res)=>{
      const user = req.body;
      user.role = 'user';
      user.createdAt = new Date();

      const isUserExists = await usersCollection.findOne({email: user.email});

      if(isUserExists){
        return res.json({message: 'user already exists'});
      }

      const result = await usersCollection.insertOne(user);
      res.send(result);


    })

      app.patch('/users/:id/role', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const roleInfo = req.body;
      const update = {
        $set: {
          role: roleInfo.role,
        }
      }

      const result = await usersCollection.updateOne(query, update);
      res.send(result);

    })



      // Connect the client to the server	(optional starting in v4.7)
      // await client.connect();
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
