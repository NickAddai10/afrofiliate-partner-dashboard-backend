require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan'); // Added for request logging

// ✅ Fix for fetch in CommonJS environments (Node.js < 18)
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const EFLOW_ADMIN_API_KEY = process.env.EFLOW_ADMIN_API_KEY;

// ✅ Enhanced CORS config for production
const corsOptions = {
  origin: [
    'https://members.afrofiliate.com',
    'http://localhost:3000' // For local development
  ],
  methods: ['GET'],
  allowedHeaders: ['Content-Type'],
};

// ✅ Middleware setup
app.use(morgan('combined')); // Request logging
app.use(cors(corsOptions));
app.use(express.json());

// ======================
// 🚀 Health Check Routes
// ======================

// ✅ Dedicated health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: 'connected', // Add DB checks if applicable
    everflow_api: 'reachable' // Could add actual API ping test
  });
});

// ======================
// 🛠️ Main API Routes
// ======================

app.get('/partner-dashboard/offers', async (req, res) => {
  const { type, affiliate_id } = req.query;

  // Quick status check if no affiliate_id is provided:
  if (!affiliate_id) {
    return res.status(200).json({
      status: 'success',
      message: 'Partner dashboard backend is operational'
    });
  }

  // Validate affiliate_id content
  if (affiliate_id.includes('{')) {
    return res.status(400).json({
      error: 'Invalid request',
      message: 'Valid affiliate_id is required',
      details: {
        received: affiliate_id,
        expected: 'Non-empty string without special characters'
      }
    });
  }

  if (type && !['top', 'latest'].includes(type)) {
    return res.status(400).json({
      error: 'Invalid request',
      message: 'Type must be either "top" or "latest" if provided'
    });
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
      timeout: 5000,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Everflow API error:', errorText);
      return res.status(502).json({
        error: 'Bad Gateway',
        message: 'Failed to fetch offers from Everflow',
        details: errorText
      });
    }

    const data = await response.json();
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
            timeout: 3000,
          });

          if (!detailRes.ok) return offer;

          const detailData = await detailRes.json();
          return {
            ...offer,
            default_payout: detailData.default_payout || 'N/A',
            currency: detailData.currency || '',
          };
        } catch (err) {
          console.error(`Error enriching offer ${offerId}:`, err);
          return offer;
        }
      })
    );

    res.json({
      status: 'success',
      data: {
        offers: enrichedOffers,
        count: enrichedOffers.length,
        _metadata: {
          source: 'Everflow API',
          enrichment: 'payout_and_currency',
          timestamp: new Date().toISOString()
        }
      }
    });

  } catch (err) {
    console.error('Internal server error:', err);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// ======================
// 🛡️ Error Handling
// ======================

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `The requested resource ${req.path} was not found`
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: 'An unexpected error occurred'
  });
});

// ======================
// 🚀 Server Startup
// ======================
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔄 Health check available at /health`);
  console.log(`🌐 Ready to handle requests for /partner-dashboard/offers`);
});
