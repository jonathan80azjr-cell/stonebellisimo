const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// API Endpoint for Contact Form
app.post('/api/contact', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, projectType, material, message } = req.body;
    
    // Basic validation
    if (!firstName || !lastName || !email || !phone) {
      return res.status(400).json({ success: false, message: 'Please fill out all required fields.' });
    }

    // Generic webhook payload
    const payload = {
      firstName,
      lastName,
      email,
      phone,
      projectType,
      material,
      message,
      source: 'Website Contact Form',
      dateCreated: new Date().toISOString().split('T')[0]
    };

    const webhookUrl = process.env.N8N_WEBHOOK_URL;

    if (webhookUrl && webhookUrl !== 'YOUR_N8N_WEBHOOK_URL_HERE') {
      // Forward to n8n (or any generic webhook)
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
         console.error('Failed to forward to webhook', response.statusText);
         // You might still want to return 200 to the client, but log the error
      } else {
         console.log('Successfully forwarded to Webhook');
      }
    } else {
      console.log('No Webhook URL configured. Simulating success.');
      console.log('Payload received:', payload);
    }

    res.status(200).json({ success: true, message: 'Thank you for your request! We will be in touch shortly.' });
  } catch (error) {
    console.error('Error handling contact form submission:', error);
    res.status(500).json({ success: false, message: 'An internal error occurred. Please try again later.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
