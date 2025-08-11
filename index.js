require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const EFLOW_ADMIN_API_KEY = process.env.EFLOW_ADMIN_API_KEY;
const BACKEND_API_KEY = process.env.BACKEND_API_KEY;

// ✅ Secure CORS config
const corsOptions = {
  origin: '*', // For production, replace with 'https://members.afrofiliate.com'
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'x-api-key'],
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// ✅ Middleware to check API key
app.use((req, res, next) => {
  if (req.path.startsWith('/partner-dashboard/offers')) {
    const providedKey = req.headers['x-api-key'];
    if (!providedKey || providedKey !== BACKEND_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
  }
  next();
});

app.get('/partner-dashboard/offers', async (req, res) => {
  const { type, affiliate_id } = req.query;

  if (!affiliate_id || affiliate_id.includes('{')) {
    return res.status(400).json({ error: 'Valid affiliate_id is required' });
  }

  let url = `https://api.eflow.team/v1/networks/offers?affiliate_id=${affiliate_id}&limit=10&status=active&visibility=public`;

  if (type === 'top') {
    url += '&sort_by=payout&sort_direction=desc';
  } else if (type === 'latest') {
    url += '&sort_by=created_at&sort_direction=desc';
  }

  try {
    const response = await fetch(url, {
      headers: {
        'X-Eflow-API-Key': EFLOW_ADMIN_API_KEY,
        'Content-Type': 'application/json',
      },
    });

    const text = await response.text();
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Everflow API request failed', details: text });
    }

    const data = JSON.parse(text);
    const offers = data.offers || [];

    const enrichedOffers = await Promise.all(
      offers.map(async (offer) => {
        const offerId = offer.network_offer_id;
        const detailUrl = `https://api.eflow.team/v1/networks/offers/${offerId}?affiliate_id=${affiliate_id}`;
        try {
          const detailRes = await fetch(detailUrl, {
            headers: {
              'X-Eflow-API-Key': EFLOW_ADMIN_API_KEY,
              'Content-Type': 'application/json',
            },
          });

          if (!detailRes.ok) return offer;

          const detailData = await detailRes.json();
          return {
            ...offer,
            default_payout: detailData.default_payout || 'N/A',
            currency: detailData.currency || '',
          };
        } catch {
          return offer;
        }
      })
    );

    res.json({ offers: enrichedOffers });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
});
