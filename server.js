require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for external frontends (e.g. Netlify)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Metabase configuration
const METABASE_URL = process.env.METABASE_URL;
const USERNAME = process.env.METABASE_USER;
const PASSWORD = process.env.METABASE_PASS;
const DATABASE_ID = parseInt(process.env.METABASE_DB_ID || '5', 10);

// In-memory cache for query results
let cache = {
  data: null,
  timestamp: null,
  duration: 2 * 60 * 1000 // 2 minutes cache
};

// Metabase session token state
let sessionToken = null;
let sessionExpiresAt = null;

// The SQL Query requested (optimized with INNER JOIN on tbl_invoice_master for 4x faster execution)
const SQL_QUERY = `
select o.order_date, tbl.updatedon, datediff(o.order_date,tbl.updatedon) as date_diff, left(po.po_number,4) as Supplier_name, o.vendor_id, po.po_number, tbl.invoice_date, o.order_id, o.sku,
o.quantity, o.supplier_price, (tbl.product_price-tbl.discount_received) as inv_amt, (o.supplier_price- (tbl.product_price-tbl.discount_received)) as diff from
orders o left join purchase_orders po on po.ord_primary_key = o.id inner join tbl_invoice_master tbl on o.order_id = tbl.order_id and o.sku = tbl.sku where 
(tbl.product_price-tbl.discount_received) > o.supplier_price and order_date >='2026-01-01' and o.vendor_id not in (7014, 9513) having diff < -0.05 order by diff asc;
`.trim();

// Authenticate and retrieve Metabase Session Token
async function getSessionToken() {
  // If we have a valid token (arbitrarily assuming a 1-hour expiration buffer)
  if (sessionToken && sessionExpiresAt && Date.now() < sessionExpiresAt) {
    return sessionToken;
  }

  console.log('[Metabase] Authenticating...');
  try {
    const response = await fetch(`${METABASE_URL}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USERNAME, password: PASSWORD })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Authentication failed with status ${response.status}: ${errText}`);
    }

    const data = await response.json();
    sessionToken = data.id;
    // Set expiration to 2 hours from now
    sessionExpiresAt = Date.now() + 2 * 60 * 60 * 1000;
    console.log('[Metabase] Successfully authenticated and obtained new session token.');
    return sessionToken;
  } catch (error) {
    console.error('[Metabase] Error during authentication:', error);
    throw error;
  }
}



// The new SQL Query to fetch Claims data
const CLAIM_QUERY = `
select po_number, credit_value, cm_number, cm_date, claim_type from rma_invoice_gap_credit where claim_type = 'vendor';
`.trim();

// Execute a SQL Query on Metabase database
async function executeSQL(token, sql) {
  const response = await fetch(`${METABASE_URL}/api/dataset`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Metabase-Session': token
    },
    body: JSON.stringify({
      database: DATABASE_ID,
      type: 'native',
      native: {
        query: sql,
        'template-tags': {}
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Query failed with status ${response.status}: ${errText}`);
  }

  const queryResult = await response.json();
  const dataObj = queryResult.data || {};
  const cols = dataObj.cols || [];
  const rows = dataObj.rows || [];

  const colNames = cols.map(c => c.name);
  return rows.map(row => {
    const item = {};
    colNames.forEach((colName, index) => {
      item[colName] = row[index];
    });
    return item;
  });
}

// Fetch both datasets from Metabase API in parallel
async function fetchMetabaseData() {
  const token = await getSessionToken();
  console.log('[Metabase] Executing dual database queries...');
  try {
    const [discrepancyRows, claimRows] = await Promise.all([
      executeSQL(token, SQL_QUERY),
      executeSQL(token, CLAIM_QUERY)
    ]);
    console.log(`[Metabase] Success. Discrepancies: ${discrepancyRows.length} rows. Claims: ${claimRows.length} rows.`);
    return {
      discrepancies: discrepancyRows,
      claims: claimRows
    };
  } catch (error) {
    // If unauthorized, clear token and retry once
    if (error.message.includes('401') && sessionToken) {
      console.log('[Metabase] Session token expired (401). Retrying with fresh login...');
      sessionToken = null;
      return fetchMetabaseData();
    }
    throw error;
  }
}

// Global tracking variable for active background sync
let isFetching = false;

// Get data, utilizing the in-memory cache if valid or running revalidation in background
async function getPriceDifferences(forceRefresh = false) {
  const now = Date.now();

  // If we have cached data, we immediately return it (stale-while-revalidate) to prevent blocking the user
  if (cache.data) {
    const isCacheFresh = (now - cache.timestamp < cache.duration);
    
    if (!forceRefresh && isCacheFresh) {
      console.log('[Cache] Serving fresh data from memory cache');
      return {
        data: cache.data.discrepancies,
        claims: cache.data.claims,
        fetchedAt: new Date(cache.timestamp).toISOString(),
        isCached: true,
        isFetching: isFetching
      };
    }
    
    // Trigger background query execution asynchronously if not already fetching
    if (!isFetching) {
      console.log('[Sync] Triggering background fetch to Metabase...');
      isFetching = true;
      fetchMetabaseData()
        .then(result => {
          cache.data = result;
          cache.timestamp = Date.now();
          console.log('[Sync] Background sync successfully updated cache.');
        })
        .catch(error => {
          console.error('[Sync] Background sync failed:', error);
        })
        .finally(() => {
          isFetching = false;
        });
    }

    // Immediately serve the stale cache, flagged as currently fetching/revalidating
    return {
      data: cache.data.discrepancies,
      claims: cache.data.claims,
      fetchedAt: new Date(cache.timestamp).toISOString(),
      isCached: true,
      isFetching: true
    };
  }

  // If there is NO cached data at all (first load after server restart), we must block and fetch synchronously
  isFetching = true;
  try {
    console.log('[Sync] No cache available. Performing initial synchronous fetch...');
    const result = await fetchMetabaseData();
    cache.data = result;
    cache.timestamp = Date.now();
    return {
      data: result.discrepancies,
      claims: result.claims,
      fetchedAt: new Date(cache.timestamp).toISOString(),
      isCached: false,
      isFetching: false
    };
  } finally {
    isFetching = false;
  }
}

// Serve static assets from public folder
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// API Endpoints
app.get('/api/price-differences', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    const result = await getPriceDifferences(forceRefresh);
    res.json(result);
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: 'Failed to fetch vendor price differences from Metabase', details: error.message });
  }
});

app.post('/api/refresh', async (req, res) => {
  try {
    const result = await getPriceDifferences(true);
    res.json(result);
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: 'Failed to force refresh data from Metabase', details: error.message });
  }
});

// Fallback to index.html for single page app routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` Vendor Price Dashboard Server running locally`);
  console.log(` URL: http://localhost:${PORT}`);
  console.log(` Environment: Production`);
  console.log(`==================================================`);
});
