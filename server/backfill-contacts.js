require('dotenv').config();

const { MongoClient } = require('mongodb');
const { BrevoClient } = require('@getbrevo/brevo');

const client = new MongoClient(process.env.MONGO_URI);
const brevo = new BrevoClient({ apiKey: process.env.BREVO_API_KEY });

async function backfill() {
    await client.connect();
    const db = client.db('johnny-site');
    const emailsCollection = db.collection('emails');

    // Pulls every subscriber document out of MongoDB.
    const allSubscribers = await emailsCollection.find({}).toArray();
    console.log(`Found ${allSubscribers.length} subscribers in MongoDB.`);

    let successCount = 0;
    let failCount = 0;

    // Loop one at a time (not in parallel) so we don't slam Brevo's API
    // with dozens of simultaneous requests at once.
    for (const subscriber of allSubscribers) {
        try {
            await brevo.contacts.createContact({
                email: subscriber.email,
                listIds: [Number(process.env.BREVO_LIST_ID)],
                updateEnabled: true
            });
            console.log('Added:', subscriber.email);
            successCount++;
        } catch (err) {
            console.error('Failed:', subscriber.email, '-', err.message);
            failCount++;
        }
    }

    console.log(`Done. ${successCount} succeeded, ${failCount} failed.`);
    await client.close();
}

backfill();