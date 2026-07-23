require('dotenv').config({ quiet: true});     // loads .env into process.env
                                // must run before anything reads process.env

const { BrevoClient } = require('@getbrevo/brevo');

// One client instance, reused for every email send — created once at startup,
// not inside the route, so we're not rebuilding it on every signup.
const brevo = new BrevoClient({
    apiKey: process.env.BREVO_API_KEY
});

const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');     // the MongoDB driver

process.on('unhandledRejection', (err) => {
    console.error('Unhandled promise rejection:', err);
});

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

// Sends the welcome email. Errors are caught and logged here, not thrown,
// so a Brevo outage never breaks the signup flow that calls this function.
async function sendWelcomeEmail(toEmail) {

    console.log('sendWelcomeEmail called for:', toEmail);

    try {
        await brevo.transactionalEmails.sendTransacEmail({
            sender: {
                name: process.env.BREVO_SENDER_NAME,
                email: process.env.BREVO_SENDER_EMAIL
            },
            to: [{ email: toEmail }],
            subject: "Welcome to the Johnny! mailing list",
            htmlContent: `
                <div style="font-family: 'Courier New', monospace; background:#1a1a1a; color:#f0e6d3; padding:32px;">
                    <h1 style="color:#c9a84c;">You're in.</h1>
                    <p>Thanks for signing up for the Johnny! newsletter.</p>
                    <p>We'll let you know about shows, releases, and anything else worth shouting about.</p>
                </div>
            `
        });
        console.log('Welcome email sent to:', toEmail);
    } catch (err) {
        // Log and move on — don't let email failure look like signup failure
        console.error('Failed to send welcome email:', err.message);
    }
}

// Adds the subscriber as a contact in Brevo, so they're reachable
// from the newsletter composer. Same error-handling pattern as
// sendWelcomeEmail — logged, never thrown, never blocks the signup.
async function addContactToList(email) {
    try {
        await brevo.contacts.createContact({
            email: email,
            listIds: [Number(process.env.BREVO_LIST_ID)],
            updateEnabled: true
        });
        console.log('Contact added to Brevo list:', email);
    } catch (err) {
        console.error('Failed to add contact to Brevo list:', err.message);
    }
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

    sendWelcomeEmail(email);        // intentionally not awaited
    addContactToList(email);

    res.status(200).json({ message: 'Signup successful' });
});

app.listen(PORT, () => {
    console.log(`Server listening on ${PORT}`);
})