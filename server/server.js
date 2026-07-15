require('dotenv').config();     // loads .dnv into process.env
                                // must run before anything reads process.env

const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');     // the MongoDB driver

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Reads the connection string from the environment, not hardcoded.
// process.env.MONGO_URI: Reads the MONGO_URI value from your .env file at runtime
// MongoClient: The object that manages the connection to Atlas
const client = new MongoClient(process.env.MONGO_URI);

// use this to hold a reference to our database's "emails" collection
let emailsCollection;

// Connect once when the server starts, and store the collection reference
async function connectToDatabase() {
    await client.connect();
    const db = client.db('johnny-site');    // names the database
                                            // db('johnny-site'): A database — a named container for your data,
                                            // created automatically the first time you write to it
    emailsCollection = db.collection('emails');     // names the collection
                                                    // collection('emails'): Roughly MongoDB's version of a table,
                                                    // a named group of documents (records)
    console.log('Connected to MongoDB');
}

connectToDatabase();

app.get('/', (req, res) => {
    res.send('Server is running');
});

app.post('/api/signup', async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }

    // findOne searches the collection for a document mathcing this filter.
    // Returns the matchnig document, or null if none found.
    const existing = await emailsCollection.findOne({
        email: email.toLowerCase()
    });

    if (existing) {
        return res.status(409).json({ error: 'Email already signed up' });
    }

    // insertOne adds a newe document (record) to the collection.
    await emailsCollection.insertOne({
        email: email.toLowerCase(),
        signedUpAt: new Date()
    });

    console.log('New signup saved:', email);
    res.status(200).json({ message: 'Signup successful' });
});

app.listen(PORT, () => {
    console.log(`Server listening on ${PORT}`);
})