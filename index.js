const express = require('express');
const app = express();
const cors = require("cors");
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require("firebase-admin");

const serviceAccount = require("./online-ticket-booking-firebase-admin-sdk-.json");
const { populate } = require('dotenv');

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
    const bookingsCollection = db.collection('bookings');

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

    //booking related apis
 app.get('/bookings/user',verifyFirebaseToken,async(req,res)=>{
  const { email } = req.query;
  const query = {};
  if(email){
    query.userEmail = email;
  }
  const cursor  = bookingsCollection.find(query).sort({createdAt: -1});
  const result = await cursor.toArray();
  res.send(result);

 })

      app.post('/bookings', verifyFirebaseToken, async (req, res) => {
      const booking = req.body;
      booking.createdAt = new Date();
      const result = await bookingsCollection.insertOne(booking);
      res.send(result);
    })

    

    //tickets related apis
    app.get('/tickets/vendor', verifyFirebaseToken, verifyVendor, async (req, res) => {
      const { vendorEmail } = req.query;
      const query = {};
      if (vendorEmail) {
        query.vendorEmail = vendorEmail;
      }


      const cursor = ticketsCollection.find(query).sort({ createdAt: -1 });
      const result = await cursor.toArray();

      res.send(result);

    })

    app.get('/tickets/admin', verifyFirebaseToken, verifyAdmin, async (req, res) => {
      const { status } = req.query;
      const query = {};
      if (status) {
        query.status = status;
      }
      const cursor = ticketsCollection.find(query).sort({ createdAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    })

    app.get('/tickets/all-tickets',verifyFirebaseToken, async (req, res) => {
      const query = {};
      const result = await ticketsCollection.find(query).sort({ createdAt: -1 }).toArray();
      res.send(result);
    })

    app.get('/tickets/latest', async (req, res) => {
      const query = {};
      const result = await ticketsCollection.find(query).sort({ createdAt: -1 }).limit(6).toArray();
      res.send(result);
    })

    app.get('/tickets/advertise', async (req, res) => {
      const { advertiseStatus } = req.query;
      const query = {};
      if (advertiseStatus) {
        query.advertiseStatus = advertiseStatus;
      }
      const cursor = ticketsCollection.find(query).sort({ createdAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    })
    
     app.get('/ticket-details/:id', async (req, res) => {
      const id = req.params.id;
      const result = await ticketsCollection.findOne({ _id: new ObjectId(id) })
      res.send(result)
    })


    app.post('/tickets', verifyFirebaseToken, verifyVendor, async (req, res) => {
      const ticket = req.body;
      ticket.status = 'pending';

      const result = await ticketsCollection.insertOne(ticket);
      res.send(result);
    })

    app.patch('/tickets/:id', verifyFirebaseToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const { status, advertiseStatus } = req.body;
      const query = { _id: new ObjectId(id) };
      let update = {
        $set: {
          status: status,
        }
      }

      if (status === 'approved' && !advertiseStatus) {
        update = {
          $set: {
            status: status,
            advertiseStatus: 'unadvertise',
          }
        }
      }

      if (status === 'approved' && advertiseStatus) {
        update = {
          $set: {
            advertiseStatus: advertiseStatus,
          }
        }
      }

      const result = await ticketsCollection.updateOne(query, update);
      res.send(result);

    })

    app.delete('/tickets/:id', verifyFirebaseToken, async (req, res) => {

      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await ticketsCollection.deleteOne(query);
      res.send(result);
    })

    //users related apis

    app.get('/users', verifyFirebaseToken, verifyAdmin, async (req, res) => {
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
      // const cursor = usersCollection.find(query).sort({ createdAt: -1 }).limit(4);
      const cursor = usersCollection.find(query).sort({ createdAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    })


    app.get('/users/:email/role', verifyFirebaseToken, async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const result = await usersCollection.findOne(query);
      res.send({ role: result?.role || 'user' });
    })


    app.post('/users', async (req, res) => {
      const user = req.body;
      user.role = 'user';
      user.createdAt = new Date();

      const isUserExists = await usersCollection.findOne({ email: user.email });

      if (isUserExists) {
        return res.json({ message: 'user already exists' });
      }

      const result = await usersCollection.insertOne(user);
      res.send(result);


    })

    app.patch('/users/:id/role', verifyFirebaseToken, verifyAdmin, async (req, res) => {
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
