const express = require('express');
const app = express();
const cors = require("cors");
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require("firebase-admin");
const stripe = require('stripe')(process.env.STRIPE_SECRET);
//const serviceAccount = require("./online-ticket-booking-firebase-admin-sdk-.json");
// const serviceAccount = require("./firebase-admin-key.json");

// const serviceAccount = require("./firebase-admin-key.json");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

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
    const paymentCollection = db.collection('payments');

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


    // payment related apis

    app.get('/payments', verifyFirebaseToken, async (req, res) => {
      const email = req.query.email;
      // console.log({ email, decoded_mail: req.decoded_email })
      const query = {};
      if (email) {
        query.userEmail = email;
        //check email with token email
        if (email !== req.decoded_email) {
          return res.status(403).json({ message: 'forbidden access' });
        }

      }

      const cursor = paymentCollection.find(query).sort({ paidAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    })

    app.post('/payment-checkout-session', async (req, res) => {
      try {
        const paymentInfo = req.body;

        // 1. Convert to cents (Stripe requirement)
        const amount = Math.round(parseFloat(paymentInfo.totalPrice) * 100);

        if (isNaN(amount) || amount <= 0) {
          return res.status(400).send({ message: "Invalid total price" });
        }

        const session = await stripe.checkout.sessions.create({
          // PRE-FILL USER EMAIL HERE
          customer_email: paymentInfo.userEmail,

          payment_method_types: ['card'],
          line_items: [
            {
              price_data: {
                currency: 'bdt',
                unit_amount: amount,
                product_data: {
                  name: `Ticket for: ${paymentInfo.bookingTitle}`,
                }
              },
              quantity: parseInt(paymentInfo.bookingQuantity) || 1,
            },
          ],
          mode: 'payment',
          metadata: {
            bookingId: paymentInfo.bookingId,
            ticketId: paymentInfo.ticketId,
            ticketTitle: paymentInfo.ticketTitle,
            userEmail: paymentInfo.userEmail,
            vendorEmail: paymentInfo.vendorEmail,
            ticketQuantity: paymentInfo.ticketQuantity,
          },
          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
        });

        res.send({ url: session.url });
      } catch (error) {
        // console.error("Stripe Error:", error.message);
        res.status(500).send({ message: error.message });
      }
    });


    // Add this inside the run() function
    app.patch('/payment-success', async (req, res) => {
      const sessionId = req.query.session_id;

      try {
        // 1. Retrieve the session details from Stripe
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        //  console.log('session retrieve', session);


        const transactionId = session.payment_intent;
        const query = { transactionId: transactionId }

        const paymentExist = await paymentCollection.findOne(query);
        // console.log(paymentExist);
        if (paymentExist) {

          return res.send({
            message: 'already exists',
            transactionId,
          })
        }


        if (session.payment_status === 'paid') {
          const { bookingId, ticketId, userEmail, vendorEmail, ticketTitle, ticketQuantity } = session.metadata;
          const quantityToSubtract = parseInt(ticketQuantity);
          // 2. Update the booking status in bookingsCollection
          const filter = { _id: new ObjectId(bookingId) };
          const updateDoc = {
            $set: {
              bookingStatus: 'paid',
              transactionId: session.payment_intent,
            },
          };
          await bookingsCollection.updateOne(filter, updateDoc);

          //CHANGE AVAILABLE QUANTITY
          if (ticketId) {
            const updateTicket = await ticketsCollection.updateOne(
              { _id: new ObjectId(ticketId) },
              { $inc: { quantity: -quantityToSubtract } } // Decrement stock
            );
            // console.log("Stock updated:", updateTicket);
          }


          const paymentRecord = {
            ticketTitle,
            bookingId,
            userEmail,
            vendorEmail,
            transactionId: session.payment_intent,
            amount: session.amount_total / 100,
            date: new Date(),
            paymentStatus: 'paid'
          };
          await paymentCollection.insertOne(paymentRecord);

          // 4. Send data back to the frontend
          res.send({
            transactionId: session.payment_intent,
            customer_email: session.customer_details.email,
            ticketTitle: session.line_items?.data[0]?.description || "Ticket",
            status: 'success'
          });
        } else {
          res.status(400).send({ message: "Payment not verified" });
        }
      } catch (error) {
        //console.error("Payment Success Error:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });



    app.get('/bookings/user', verifyFirebaseToken, async (req, res) => {
      const { email } = req.query;
      const query = {};
      if (email) {
        query.userEmail = email;
      }
      const cursor = bookingsCollection.find(query).sort({ createdAt: -1 });
      const result = await cursor.toArray();
      res.send(result);

    })

    app.get("/bookings/vendor", async (req, res) => {
      const query = {};
      const { vendorEmail } = req.query;
      const { bookingStatus } = req.query;
      if (vendorEmail) {
        query.vendorEmail = vendorEmail;
      }

      if (bookingStatus) {
        query.bookingStatus = bookingStatus;
      }
      const options = { sort: { createdAt: -1 } };
      const cursor = bookingsCollection.find(query, options);
      const result = await cursor.toArray();
      res.send(result);
    })


    app.patch('/bookings/:id', verifyFirebaseToken, verifyVendor, async (req, res) => {
      const id = req.params.id;
      const { bookingStatus } = req.body;
      const query = { _id: new ObjectId(id) };
      let update = {
        $set: {
          bookingStatus: bookingStatus,
        }
      }

      const result = await bookingsCollection.updateOne(query, update);
      res.send(result);


    })

    app.post('/bookings', verifyFirebaseToken, async (req, res) => {
      const booking = req.body;
      booking.createdAt = new Date();
      const result = await bookingsCollection.insertOne(booking);
      res.send(result);
    })

    //vendor stats

    app.get('/vendor-revenue-stats', verifyFirebaseToken, verifyVendor, async (req, res) => {
      const email = req.decoded_email;

      try {
        // Summary Stats
        const paymentStats = await paymentCollection.aggregate([
          { $match: { vendorEmail: email } },
          { $group: { _id: null, totalRevenue: { $sum: "$amount" }, totalSold: { $sum: 1 } } }
        ]).toArray();

        // Inventory Stats for Pie Chart
        const inventory = await ticketsCollection.aggregate([
          { $match: { vendorEmail: email } },
          { $group: { _id: null, totalAvailable: { $sum: "$quantity" } } }
        ]).toArray();

        const totalSold = paymentStats[0]?.totalSold || 0;
        const totalAvailable = inventory[0]?.totalAvailable || 0;

        // Data specifically formatted for the Pie Chart
        const pieData = [
          { name: 'Tickets Sold', value: totalSold },
          { name: 'Remaining Stock', value: totalAvailable }
        ];

        res.send({
          summary: {
            totalRevenue: paymentStats[0]?.totalRevenue || 0,
            totalTicketsSold: totalSold,
            totalTicketsAdded: totalSold + totalAvailable
          },
          pieData
        });
      } catch (error) {
        res.status(500).send({ message: "Server Error" });
      }
    });



    //tickets related apis

    app.get('/tickets/all-tickets', verifyFirebaseToken, async (req, res) => {
      try {
        const { limit = 9, skip = 0, sort = "price", order = "asc", search = "", type = "" } = req.query;

        // 1. Build Query
        let query = { status: 'approved' }; // Matches your data "status": "approved"

        // Search by origin or destination (matches your data keys)
        if (search) {
          query.$or = [
            { origin: { $regex: search, $options: "i" } },
            { destination: { $regex: search, $options: "i" } },
            { title: { $regex: search, $options: "i" } }
          ];
        }

        // Filter by transportType (matches your data "transportType": "Launch")
        if (type) {
          query.transportType = type;
        }

        // 2. Build Sort
        const sortOption = {};
        sortOption[sort] = order === "desc" ? -1 : 1;

        // 3. Execute Database Calls
        const tickets = await ticketsCollection
          .find(query)
          .sort(sortOption)
          .skip(parseInt(skip))
          .limit(parseInt(limit))
          .toArray();

        const totalCount = await ticketsCollection.countDocuments(query);

        // 4. Send Clean Response
        res.send({
          success: true,
          tickets,
          totalCount
        });

      } catch (error) {
        // console.error("Backend Error:", error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
      }
    });





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

    app.put('/tickets/:id', verifyFirebaseToken, verifyVendor, async (req, res) => {
      const id = req.params.id;
      const updateTicket = req.body;
      const query = { _id: new ObjectId(id) };
      const update = {
        $set: updateTicket,
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
    // await client.db("admin").command({ ping: 1 });
    // console.log("Pinged your deployment. You successfully connected to MongoDB!");
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
