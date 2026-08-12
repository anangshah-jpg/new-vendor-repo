const METABASE_URL = process.env.METABASE_URL;
const USERNAME = process.env.METABASE_USERNAME;
const PASSWORD = process.env.METABASE_PASSWORD;
const DATABASE_ID = parseInt(process.env.METABASE_DATABASE_ID || '5', 10);

const SQL_QUERY = `
select o.order_date, tbl.updatedon, datediff(o.order_date,tbl.updatedon) as date_diff, left(po.po_number,4) as Supplier_name, o.vendor_id, po.po_number, tbl.invoice_date, o.order_id, o.sku,
o.quantity, o.supplier_price, (tbl.product_price-tbl.discount_received) as inv_amt, (o.supplier_price- (tbl.product_price-tbl.discount_received)) as diff from
orders o left join purchase_orders po on po.ord_primary_key = o.id inner join tbl_invoice_master tbl on o.order_id = tbl.order_id and o.sku = tbl.sku where 
(tbl.product_price-tbl.discount_received) > o.supplier_price and order_date >='2026-01-01' and o.vendor_id not in (7014, 9513) having diff < -0.05 order by diff asc;
`.trim();

const CLAIM_QUERY = `
select po_number, credit_value, cm_number, cm_date, claim_type from rma_invoice_gap_credit where claim_type = 'vendor';
`.trim();

// Cache state in serverless container memory (warm start cache)
let cachedData = null;
let cachedTimestamp = null;
const CACHE_DURATION = 2 * 60 * 1000; // 2 minutes

// Execute SQL Query helper
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
      native: { query: sql, 'template-tags': {} }
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

exports.handler = async function(event, context) {
  // CORS Headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  const forceRefresh = event.queryStringParameters && event.queryStringParameters.refresh === 'true';
  const now = Date.now();

  // Return cached data if valid and refresh is not forced
  if (!forceRefresh && cachedData && cachedTimestamp && (now - cachedTimestamp < CACHE_DURATION)) {
    console.log('[Cache] Serving data from warm container cache');
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        data: cachedData.discrepancies,
        claims: cachedData.claims,
        fetchedAt: new Date(cachedTimestamp).toISOString(),
        isCached: true,
        isFetching: false
      })
    };
  }

  try {
    console.log('[Metabase] Authenticating...');
    const sessionRes = await fetch(`${METABASE_URL}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
    });
    if (!sessionRes.ok) {
      throw new Error(`Authentication failed with status ${sessionRes.status}`);
    }
    const sessionData = await sessionRes.json();
    const token = sessionData.id;

    console.log('[Metabase] Running queries in parallel...');
    const [discrepancyRows, claimRows] = await Promise.all([
      executeSQL(token, SQL_QUERY),
      executeSQL(token, CLAIM_QUERY)
    ]);

    console.log(`[Metabase] Success. Discrepancies: ${discrepancyRows.length} rows. Claims: ${claimRows.length} rows.`);

    // Save to serverless memory cache
    cachedData = {
      discrepancies: discrepancyRows,
      claims: claimRows
    };
    cachedTimestamp = now;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        data: discrepancyRows,
        claims: claimRows,
        fetchedAt: new Date(now).toISOString(),
        isCached: false,
        isFetching: false
      })
    };

  } catch (error) {
    console.error('Metabase query error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Metabase Sync Failed', details: error.message })
    };
  }
};
