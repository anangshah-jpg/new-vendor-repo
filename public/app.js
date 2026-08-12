// Global Application State
let rawData = [];
let filteredData = [];
let supplierChart = null;
let distributionChart = null;
let sevenDaysChart = null;
let pollTimeout = null;
let claimsData = [];


// Table Pagination & Sorting Settings
let currentPage = 1;
let pageSize = 25;
let sortColumn = 'diff'; // Default sorting by the size of the discrepancy
let sortDirection = 'asc'; // Ascending puts largest negative diffs at the top

// Elements caching
const elements = {
  lastSyncTime: document.getElementById('last-sync-time'),
  refreshBtn: document.getElementById('refresh-btn'),
  
  // KPIs
  kpiTotalOvercharge: document.getElementById('kpi-total-overcharge'),
  kpiTotalRange: document.getElementById('kpi-total-range'),
  kpiFlaggedCount: document.getElementById('kpi-flagged-count'),
  kpiClaimsReceived: document.getElementById('kpi-claims-received'),
  kpiMaxMismatch: document.getElementById('kpi-max-mismatch'),
  kpiSevenDaysOvercharge: document.getElementById('kpi-seven-days-overcharge'),
  kpiSevenDaysRange: document.getElementById('kpi-seven-days-range'),
  kpiSevenDaysCard: document.getElementById('kpi-seven-days-card'),
  
  // Filters
  searchInput: document.getElementById('search-input'),
  supplierFilter: document.getElementById('supplier-filter'),
  vendorFilter: document.getElementById('vendor-filter'),
  diffRangeFilter: document.getElementById('diff-range-filter'),
  clearFiltersBtn: document.getElementById('clear-filters-btn'),
  activeFiltersSummary: document.getElementById('active-filters-summary'),
  filterTags: document.getElementById('filter-tags'),
  
  // Table
  tableBody: document.getElementById('table-body'),
  ordersTable: document.getElementById('orders-table'),
  tableWrapper: document.querySelector('.table-wrapper'),
  emptyState: document.getElementById('empty-state'),
  
  // Seven Days Table
  sevenDaysTableBody: document.getElementById('seven-days-table-body'),
  sevenDaysEmptyState: document.getElementById('seven-days-empty-state'),
  
  // Footer
  rowsStart: document.getElementById('rows-start'),
  rowsEnd: document.getElementById('rows-end'),
  rowsTotal: document.getElementById('rows-total'),
  pageSize: document.getElementById('page-size'),
  prevPageBtn: document.getElementById('prev-page-btn'),
  nextPageBtn: document.getElementById('next-page-btn'),
  pagesContainer: document.getElementById('pages-container'),
  
  // Modal
  detailsModal: document.getElementById('details-modal'),
  closeModalBtn: document.getElementById('close-modal-btn'),
  btnCloseModalFooter: document.getElementById('btn-close-modal-footer'),
  modalOrderId: document.getElementById('modal-order-id'),
  modalPoNumber: document.getElementById('modal-po-number'),
  modalSku: document.getElementById('modal-sku'),
  modalQty: document.getElementById('modal-qty'),
  modalOrderDate: document.getElementById('modal-order-date'),
  modalInvoiceDate: document.getElementById('modal-invoice-date'),
  modalUpdatedOn: document.getElementById('modal-updated-on'),
  modalDateDiff: document.getElementById('modal-date-diff'),
  modalCalcSupplierPrice: document.getElementById('modal-calc-supplier-price'),
  modalCalcInvoicePrice: document.getElementById('modal-calc-invoice-price'),
  modalCalcUnitDiff: document.getElementById('modal-calc-unit-diff'),
  modalCalcTotalDiff: document.getElementById('modal-calc-total-diff'),
  modalSupplierName: document.getElementById('modal-supplier-name'),
  modalVendorId: document.getElementById('modal-vendor-id'),
  
  // Toast container
  toastContainer: document.getElementById('toast-container')
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  // Check if Lucide script loaded
  if (window.lucide) {
    window.lucide.createIcons();
  }
  
  bindEvents();
  loadData();
});

// Bind UI Event Listeners
function bindEvents() {
  // Sync Controls
  elements.refreshBtn.addEventListener('click', () => loadData(true));
  
  // Table Filtering
  elements.searchInput.addEventListener('input', debounce(applyFilters, 250));
  elements.supplierFilter.addEventListener('change', applyFilters);
  elements.vendorFilter.addEventListener('change', applyFilters);
  elements.diffRangeFilter.addEventListener('change', applyFilters);
  elements.clearFiltersBtn.addEventListener('click', clearAllFilters);
  
  // Click shortcut on Latest 7 Days card to smooth scroll to detail table
  elements.kpiSevenDaysCard.addEventListener('click', () => {
    const target = document.getElementById('seven-days-table-section');
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  // Download 7-Day discrepancies report as CSV
  const downloadBtn = document.getElementById('download-7days-btn');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', downloadSevenDaysCSV);
  }
  
  // Pagination
  elements.pageSize.addEventListener('change', (e) => {
    pageSize = parseInt(e.target.value, 10);
    currentPage = 1;
    renderTable();
  });
  elements.prevPageBtn.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      renderTable();
    }
  });
  elements.nextPageBtn.addEventListener('click', () => {
    const totalPages = Math.ceil(filteredData.length / pageSize);
    if (currentPage < totalPages) {
      currentPage++;
      renderTable();
    }
  });
  
  // Table Sorting
  elements.ordersTable.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      if (sortColumn === field) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        sortColumn = field;
        sortDirection = field === 'diff' || field === 'order_date' ? 'asc' : 'desc'; // Mismatches: largest negative at top
      }
      
      // Update sorted headers CSS
      elements.ordersTable.querySelectorAll('th.sortable').forEach(header => {
        header.classList.remove('sort-asc', 'sort-desc');
        const icon = header.querySelector('i');
        if (icon) icon.setAttribute('data-lucide', 'chevrons-up-down');
      });
      
      th.classList.add(sortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
      const activeIcon = th.querySelector('i');
      if (activeIcon) {
        activeIcon.setAttribute('data-lucide', sortDirection === 'asc' ? 'chevron-up' : 'chevron-down');
      }
      if (window.lucide) window.lucide.createIcons();
      
      sortData();
      renderTable();
    });
  });
  
  // Modal Interactions
  elements.closeModalBtn.addEventListener('click', hideModal);
  elements.btnCloseModalFooter.addEventListener('click', hideModal);
  elements.detailsModal.addEventListener('click', (e) => {
    if (e.target === elements.detailsModal) hideModal();
  });
  
  // Copy to Clipboard bindings
  [elements.modalOrderId, elements.modalPoNumber, elements.modalSku].forEach(el => {
    el.addEventListener('click', () => {
      if (el.textContent && el.textContent !== '-') {
        navigator.clipboard.writeText(el.textContent)
          .then(() => showToast(`Copied: ${el.textContent}`, 'info'))
          .catch(() => showToast('Failed to copy text', 'error'));
      }
    });
  });
}



// Toast Notification Engine
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let iconName = 'info';
  if (type === 'success') iconName = 'check-circle';
  if (type === 'error') iconName = 'alert-octagon';
  
  toast.innerHTML = `
    <i data-lucide="${iconName}" class="toast-icon ${type}"></i>
    <div class="toast-message">${message}</div>
  `;
  
  elements.toastContainer.appendChild(toast);
  if (window.lucide) window.lucide.createIcons();
  
  // Remove toast after animation
  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s forwards';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Get backend API URL dynamically (routes to local Express server, or Netlify Serverless Function)
function getApiUrl(endpoint) {
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (isLocal) {
    return endpoint;
  }
  // Map /api/price-differences relative paths to the Netlify function endpoint
  const query = endpoint.includes('?refresh=true') ? '?refresh=true' : '';
  return `/.netlify/functions/price-differences${query}`;
}

// Fetch Metabase data from Proxy Server (Instant UI response + background sync)
async function loadData(force = false) {
  if (pollTimeout) {
    clearTimeout(pollTimeout);
    pollTimeout = null;
  }

  showToast(force ? 'Sync started in background...' : 'Loading data...', 'info');
  
  // Set UI loading states
  elements.tableWrapper.classList.add('loading');
  elements.refreshBtn.classList.add('loading-active');
  elements.refreshBtn.disabled = true;
  
  try {
    const url = getApiUrl(`/api/price-differences${force ? '?refresh=true' : ''}`);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Server returned error status ${res.status}`);
    }
    
    const result = await res.json();
    rawData = result.data || [];
    claimsData = result.claims || [];
    
    // Sort raw data before applying filters
    sortData();
    
    // Populate dynamic drop downs on first load or forced sync
    populateFilterDropdowns();
    
    // Update Sync status
    const syncDate = new Date(result.fetchedAt);
    elements.lastSyncTime.textContent = `Last sync: ${syncDate.toLocaleTimeString()}`;
    
    // Update state and refresh UI
    applyFilters();
    renderSevenDaysTable();

    if (result.isFetching) {
      elements.lastSyncTime.textContent = 'Syncing live data in background...';
      elements.refreshBtn.classList.add('loading-active');
      elements.refreshBtn.disabled = true;
      // Start polling for background query completion
      pollTimeout = setTimeout(pollSyncStatus, 2000);
    } else {
      elements.tableWrapper.classList.remove('loading');
      elements.refreshBtn.classList.remove('loading-active');
      elements.refreshBtn.disabled = false;
      showToast(result.isCached ? 'Loaded cached data' : 'Data synchronized successfully!', 'success');
    }
    
  } catch (error) {
    console.error('Error loading data:', error);
    showToast(`Sync Failed: ${error.message}`, 'error');
    elements.lastSyncTime.textContent = 'Sync failed. Retry manual sync.';
    elements.tableWrapper.classList.remove('loading');
    elements.refreshBtn.classList.remove('loading-active');
    elements.refreshBtn.disabled = false;
    
    if (rawData.length === 0) {
      elements.emptyState.classList.remove('hidden');
    }
  }
}

// Poll server in background until Metabase sync finishes
async function pollSyncStatus() {
  try {
    const url = getApiUrl('/api/price-differences');
    const res = await fetch(url);
    if (!res.ok) return;
    const result = await res.json();
    
    rawData = result.data || [];
    claimsData = result.claims || [];
    sortData();
    applyFilters();
    renderSevenDaysTable();
    
    const syncDate = new Date(result.fetchedAt);
    elements.lastSyncTime.textContent = `Last sync: ${syncDate.toLocaleTimeString()}`;
    
    if (result.isFetching) {
      elements.lastSyncTime.textContent = 'Syncing live data in background...';
      pollTimeout = setTimeout(pollSyncStatus, 2000);
    } else {
      elements.tableWrapper.classList.remove('loading');
      elements.refreshBtn.classList.remove('loading-active');
      elements.refreshBtn.disabled = false;
      showToast('Data synchronized successfully!', 'success');
    }
  } catch (error) {
    console.error('Error polling sync status:', error);
    elements.tableWrapper.classList.remove('loading');
    elements.refreshBtn.classList.remove('loading-active');
    elements.refreshBtn.disabled = false;
  }
}

// Populate Supplier and Vendor dropdown filters dynamically
function populateFilterDropdowns() {
  const suppliers = new Set();
  const vendors = new Set();
  
  rawData.forEach(item => {
    if (item.Supplier_name) suppliers.add(item.Supplier_name);
    if (item.vendor_id) vendors.add(item.vendor_id);
  });
  
  // Clear and rebuild Supplier Filter
  elements.supplierFilter.innerHTML = '<option value="all">All Suppliers</option>';
  Array.from(suppliers).sort().forEach(sup => {
    const opt = document.createElement('option');
    opt.value = sup;
    opt.textContent = sup;
    elements.supplierFilter.appendChild(opt);
  });
  
  // Clear and rebuild Vendor Filter
  elements.vendorFilter.innerHTML = '<option value="all">All Vendors</option>';
  Array.from(vendors).sort((a,b) => a - b).forEach(ven => {
    const opt = document.createElement('option');
    opt.value = ven;
    opt.textContent = ven;
    elements.vendorFilter.appendChild(opt);
  });
}

// Clear all active filters
function clearAllFilters() {
  elements.searchInput.value = '';
  elements.supplierFilter.value = 'all';
  elements.vendorFilter.value = 'all';
  elements.diffRangeFilter.value = 'all';
  applyFilters();
}

// Apply Filters to Data Set
function applyFilters() {
  const searchVal = elements.searchInput.value.toLowerCase().trim();
  const selectedSupplier = elements.supplierFilter.value;
  const selectedVendor = elements.vendorFilter.value;
  const selectedSeverity = elements.diffRangeFilter.value;
  
  filteredData = rawData.filter(item => {
    // 1. Text Search matching sku, order_id, or po_number
    if (searchVal) {
      const matchSku = item.sku && item.sku.toLowerCase().includes(searchVal);
      const matchOrderId = item.order_id && item.order_id.toLowerCase().includes(searchVal);
      const matchPo = item.po_number && item.po_number.toLowerCase().includes(searchVal);
      if (!matchSku && !matchOrderId && !matchPo) return false;
    }
    
    // 2. Supplier filter
    if (selectedSupplier !== 'all' && item.Supplier_name !== selectedSupplier) {
      return false;
    }
    
    // 3. Vendor filter
    if (selectedVendor !== 'all' && String(item.vendor_id) !== selectedVendor) {
      return false;
    }
    
    // 4. Severity filter (Absolute difference value = -diff)
    if (selectedSeverity !== 'all') {
      const absDiff = Math.abs(item.diff);
      if (selectedSeverity === 'low' && absDiff >= 1.0) return false;
      if (selectedSeverity === 'medium' && (absDiff < 1.0 || absDiff >= 10.0)) return false;
      if (selectedSeverity === 'high' && (absDiff < 10.0 || absDiff >= 100.0)) return false;
      if (selectedSeverity === 'critical' && absDiff < 100.0) return false;
    }
    
    return true;
  });
  
  // Manage Active Filter tags panel UI
  updateFilterTagsUI(searchVal, selectedSupplier, selectedVendor, selectedSeverity);
  
  // Re-sort filtered data
  sortData();
  
  // Reset pagination to first page
  currentPage = 1;
  
  // Update UI components
  calculateKPIs();
  updateCharts();
  renderTable();
}

// Render active filter summary tags
function updateFilterTagsUI(search, supplier, vendor, severity) {
  elements.filterTags.innerHTML = '';
  let activeCount = 0;
  
  if (search) {
    createTag(`Search: "${search}"`, () => {
      elements.searchInput.value = '';
      applyFilters();
    });
    activeCount++;
  }
  if (supplier !== 'all') {
    createTag(`Supplier: ${supplier}`, () => {
      elements.supplierFilter.value = 'all';
      applyFilters();
    });
    activeCount++;
  }
  if (vendor !== 'all') {
    createTag(`Vendor: ${vendor}`, () => {
      elements.vendorFilter.value = 'all';
      applyFilters();
    });
    activeCount++;
  }
  if (severity !== 'all') {
    let label = 'Severity: Under $1';
    if (severity === 'medium') label = 'Severity: $1 - $10';
    if (severity === 'high') label = 'Severity: $10 - $100';
    if (severity === 'critical') label = 'Severity: Over $100';
    createTag(label, () => {
      elements.diffRangeFilter.value = 'all';
      applyFilters();
    });
    activeCount++;
  }
  
  if (activeCount > 0) {
    elements.activeFiltersSummary.classList.remove('hidden');
  } else {
    elements.activeFiltersSummary.classList.add('hidden');
  }
}

function createTag(text, onRemove) {
  const tag = document.createElement('div');
  tag.className = 'filter-tag';
  tag.innerHTML = `
    <span>${text}</span>
    <button><i data-lucide="x"></i></button>
  `;
  tag.querySelector('button').addEventListener('click', onRemove);
  elements.filterTags.appendChild(tag);
  if (window.lucide) window.lucide.createIcons();
}

// Sort Data state
function sortData() {
  filteredData.sort((a, b) => {
    let valA = a[sortColumn];
    let valB = b[sortColumn];
    
    // Handle null or missing values gracefully
    if (valA === null || valA === undefined) return sortDirection === 'asc' ? 1 : -1;
    if (valB === null || valB === undefined) return sortDirection === 'asc' ? -1 : 1;
    
    // Handle number formatting differences (like strings containing currency/commas)
    if (typeof valA === 'string' && !isNaN(valA) && valA.trim() !== '') valA = parseFloat(valA);
    if (typeof valB === 'string' && !isNaN(valB) && valB.trim() !== '') valB = parseFloat(valB);
    
    // Sorting logic
    if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
    if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });
}

// Format date as YYYY-MM-DD (Ytdd format)
function formatYtdd(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Format numbers to USD Currency globally
function formatCurrency(val) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
}


// Get the trailing 7-day date window dynamically based on the most recent updatedon timestamp in the dataset
function getSevenDaysWindow() {
  let maxUpdatedOnDate = null;
  rawData.forEach(item => {
    if (item.updatedon) {
      const d = new Date(item.updatedon);
      if (!isNaN(d.getTime())) {
        if (!maxUpdatedOnDate || d > maxUpdatedOnDate) {
          maxUpdatedOnDate = d;
        }
      }
    }
  });

  const todayDate = maxUpdatedOnDate || new Date();
  const sevenDaysAgo = new Date(todayDate);
  sevenDaysAgo.setDate(todayDate.getDate() - 7);

  // Set time boundaries to cover the full days
  sevenDaysAgo.setHours(0, 0, 0, 0);
  todayDate.setHours(23, 59, 59, 999);

  return { sevenDaysAgo, todayDate };
}

// Calculate dashboard KPIs from active filtered list
function calculateKPIs() {
  const totalCount = filteredData.length;
  
  let totalOverpayment = 0;
  let maxOverpaymentValue = 0; // Absolute max value
  let minOrderDate = null;
  let maxOrderDate = null;
  
  filteredData.forEach(item => {
    // diff is calculated as supplier_price - inv_amt. Overpayment = -diff (where diff < 0)
    const overpayment = item.diff < 0 ? Math.abs(item.diff) : 0;
    totalOverpayment += overpayment;
    
    if (overpayment > maxOverpaymentValue) {
      maxOverpaymentValue = overpayment;
    }

    if (item.order_date) {
      const d = new Date(item.order_date);
      if (!isNaN(d.getTime())) {
        if (!minOrderDate || d < minOrderDate) minOrderDate = d;
        if (!maxOrderDate || d > maxOrderDate) maxOrderDate = d;
      }
    }
  });
  
  // Calculate Latest 7 Days Overpayment based on updatedon
  const { sevenDaysAgo, todayDate } = getSevenDaysWindow();
  let sevenDaysOverpayment = 0;
  
  // Note: We calculate this from rawData to represent the "always-shown" total for that period,
  // or from filteredData? Let's check: it's better to show it relative to active filters (e.g. if filtering by supplier),
  // but if the user wants the "overall" 7-day total, they can clear filters. Let's compute it over filteredData
  // so it is responsive to supplier/vendor selection as well.
  filteredData.forEach(item => {
    if (item.updatedon) {
      const itemDate = new Date(item.updatedon);
      if (!isNaN(itemDate.getTime()) && itemDate >= sevenDaysAgo && itemDate <= todayDate) {
        const overpayment = item.diff < 0 ? Math.abs(item.diff) : 0;
        sevenDaysOverpayment += overpayment;
      }
    }
  });
  
  // Calculate total claims received
  let totalClaimsValue = 0;
  claimsData.forEach(claim => {
    const val = parseFloat(claim.credit_value);
    if (!isNaN(val)) {
      totalClaimsValue += val;
    }
  });
  
  // Format numbers to USD Currency
  const formatInteger = (val) => new Intl.NumberFormat('en-US').format(val);
  
  elements.kpiTotalOvercharge.textContent = formatCurrency(totalOverpayment);
  
  if (minOrderDate && maxOrderDate) {
    elements.kpiTotalRange.textContent = `Range: ${formatYtdd(minOrderDate)} to ${formatYtdd(maxOrderDate)}`;
  } else {
    elements.kpiTotalRange.textContent = 'Range: No data';
  }

  elements.kpiFlaggedCount.textContent = formatInteger(totalCount);
  elements.kpiClaimsReceived.textContent = formatCurrency(totalClaimsValue);
  elements.kpiMaxMismatch.textContent = formatCurrency(maxOverpaymentValue);
  elements.kpiSevenDaysOvercharge.textContent = formatCurrency(sevenDaysOverpayment);
  elements.kpiSevenDaysRange.textContent = `Range: ${formatYtdd(sevenDaysAgo)} to ${formatYtdd(todayDate)}`;
}

// Create or update interactive visualizations
function updateCharts() {
  updateSupplierChart();
  updateDistributionChart();
}

function updateSupplierChart() {
  // Aggregate total overpayment by Supplier
  const supplierAgg = {};
  filteredData.forEach(item => {
    if (!item.Supplier_name) return;
    const overpayment = item.diff < 0 ? Math.abs(item.diff) : 0;
    supplierAgg[item.Supplier_name] = (supplierAgg[item.Supplier_name] || 0) + overpayment;
  });
  
  // Sort and pick top 10
  const sortedSuppliers = Object.entries(supplierAgg)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
    
  const labels = sortedSuppliers.map(item => item[0]);
  const data = sortedSuppliers.map(item => Math.round(item[1] * 100) / 100);
  
  // Destroy previous chart to avoid canvas redraw artifacts
  if (supplierChart) {
    supplierChart.destroy();
  }
  
  const ctx = document.getElementById('supplierChart').getContext('2d');
  if (labels.length === 0) {
    ctx.clearRect(0,0,300,300);
    return;
  }
  
  supplierChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Cumulative Overpayment ($)',
        data: data,
        backgroundColor: 'rgba(99, 102, 241, 0.6)',
        borderColor: '#6366f1',
        borderWidth: 1.5,
        hoverBackgroundColor: 'rgba(139, 92, 246, 0.8)',
        hoverBorderColor: '#8b5cf6',
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y', // Makes the bar chart horizontal
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) => `Total Overpayment: $${context.raw.toLocaleString()}`
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { 
            color: '#94a3b8',
            callback: (value) => `$${value.toLocaleString()}`
          }
        },
        y: {
          grid: { display: false },
          ticks: { color: '#f8fafc', font: { weight: '600' } }
        }
      }
    }
  });
}

function updateDistributionChart() {
  let low = 0;      // Under $1
  let medium = 0;   // $1 - $10
  let high = 0;     // $10 - $100
  let critical = 0; // Over $100
  
  filteredData.forEach(item => {
    const absDiff = Math.abs(item.diff);
    if (absDiff < 1.0) low++;
    else if (absDiff < 10.0) medium++;
    else if (absDiff < 100.0) high++;
    else critical++;
  });
  
  const labels = ['Under $1.00', '$1.00 - $10.00', '$10.00 - $100.00', 'Over $100.00'];
  const data = [low, medium, high, critical];
  
  if (distributionChart) {
    distributionChart.destroy();
  }
  
  const ctx = document.getElementById('distributionChart').getContext('2d');
  
  if (filteredData.length === 0) {
    ctx.clearRect(0,0,300,300);
    return;
  }
  
  distributionChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: [
          'rgba(99, 102, 241, 0.65)',  // low - indigo
          'rgba(245, 158, 11, 0.65)',  // medium - amber
          'rgba(168, 85, 247, 0.65)',  // high - purple
          'rgba(244, 63, 94, 0.75)'    // critical - rose
        ],
        borderColor: [
          '#6366f1',
          '#f59e0b',
          '#a855f7',
          '#f43f5e'
        ],
        borderWidth: 1.5,
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: '#f8fafc',
            font: { size: 11, family: 'Inter' },
            boxWidth: 12
          }
        },
        tooltip: {
          callbacks: {
            label: (context) => ` ${context.label}: ${context.raw} records (${Math.round(context.raw / filteredData.length * 100)}%)`
          }
        }
      }
    }
  });
}

// Render dynamic rows in table based on pagination slice
function renderTable() {
  const totalCount = filteredData.length;
  
  if (totalCount === 0) {
    elements.tableBody.innerHTML = '';
    elements.emptyState.classList.remove('hidden');
    elements.prevPageBtn.disabled = true;
    elements.nextPageBtn.disabled = true;
    elements.rowsStart.textContent = '0';
    elements.rowsEnd.textContent = '0';
    elements.rowsTotal.textContent = '0';
    elements.pagesContainer.innerHTML = '';
    return;
  }
  
  elements.emptyState.classList.add('hidden');
  
  const totalPages = Math.ceil(totalCount / pageSize);
  if (currentPage > totalPages) currentPage = totalPages;
  
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalCount);
  
  const pageSlice = filteredData.slice(startIndex, endIndex);
  
  // Rebuild rows
  let html = '';
  pageSlice.forEach((item, index) => {
    const originalIndex = startIndex + index;
    const isCritical = Math.abs(item.diff) >= 50.0;
    const rowClass = isCritical ? 'row-critical-alert' : '';
    
    html += `
      <tr class="${rowClass}">
        <td>${formatYtdd(item.order_date)}</td>
        <td class="font-mono">${formatYtdd(item.updatedon)}</td>
        <td class="font-bold">${item.Supplier_name || '-'}</td>
        <td class="font-mono">${item.vendor_id || '-'}</td>
        <td class="font-mono">${item.po_number || '-'}</td>
        <td class="font-mono">${item.order_id || '-'}</td>
        <td class="font-mono">${item.sku || '-'}</td>
        <td class="text-right font-mono">${item.quantity || '0'}</td>
        <td class="text-right font-mono">${formatCurrency(item.supplier_price)}</td>
        <td class="text-right font-mono">${formatCurrency(item.inv_amt)}</td>
        <td class="text-right font-mono text-danger font-bold">
          <span class="badge ${Math.abs(item.diff) >= 10.0 ? 'badge-danger' : 'badge-warning'}">
            ${formatCurrency(item.diff)}
          </span>
        </td>
        <td class="text-center">
          <button class="btn btn-secondary btn-pagination" onclick="showRecordDetails(${originalIndex})">
            <i data-lucide="eye" style="width: 0.85rem; height: 0.85rem;"></i>
          </button>
        </td>
      </tr>
    `;
  });
  
  elements.tableBody.innerHTML = html;
  
  // Update details icons
  if (window.lucide) window.lucide.createIcons();
  
  // Update footer statistics
  elements.rowsStart.textContent = startIndex + 1;
  elements.rowsEnd.textContent = endIndex;
  elements.rowsTotal.textContent = totalCount;
  
  // Update pagination buttons state
  elements.prevPageBtn.disabled = currentPage === 1;
  elements.nextPageBtn.disabled = currentPage === totalPages;
  
  renderPaginationList(totalPages);
}

// Generate pagination numbers and ellipses dynamically
function renderPaginationList(totalPages) {
  elements.pagesContainer.innerHTML = '';
  
  const maxButtons = 5;
  let startPage = Math.max(1, currentPage - 2);
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);
  
  if (endPage - startPage < maxButtons - 1) {
    startPage = Math.max(1, endPage - maxButtons + 1);
  }
  
  // First page shortcut if not in window
  if (startPage > 1) {
    createPageBtn(1, false);
    if (startPage > 2) {
      createPageBtn('...', true);
    }
  }
  
  for (let i = startPage; i <= endPage; i++) {
    createPageBtn(i, false, i === currentPage);
  }
  
  // Last page shortcut if not in window
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      createPageBtn('...', true);
    }
    createPageBtn(totalPages, false);
  }
}

function createPageBtn(page, isDots, isActive = false) {
  const btn = document.createElement('button');
  btn.className = `btn-page ${isActive ? 'active' : ''} ${isDots ? 'dots' : ''}`;
  btn.textContent = page;
  
  if (!isDots) {
    btn.addEventListener('click', () => {
      currentPage = page;
      renderTable();
    });
  } else {
    btn.disabled = true;
  }
  
  elements.pagesContainer.appendChild(btn);
}

// Show Record Details in Modal Popup window
window.showRecordDetails = function(index) {
  const item = filteredData[index];
  if (!item) return;
  
  const formatDateTime = (dateStr) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const time = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    return `${yyyy}-${mm}-${dd} ${time}`;
  };
  
  // Fill Modal metadata fields
  elements.modalOrderId.textContent = item.order_id || '-';
  elements.modalPoNumber.textContent = item.po_number || '-';
  elements.modalSku.textContent = item.sku || '-';
  elements.modalQty.textContent = item.quantity || '0';
  
  elements.modalOrderDate.textContent = formatDateTime(item.order_date);
  elements.modalInvoiceDate.textContent = formatDateTime(item.invoice_date);
  elements.modalUpdatedOn.textContent = formatDateTime(item.updatedon);
  
  const dateDiffVal = item.date_diff;
  elements.modalDateDiff.innerHTML = `<span class="badge ${dateDiffVal < 0 ? 'badge-danger' : 'badge-secondary'}">${dateDiffVal || '0'} days</span>`;
  
  elements.modalSupplierName.textContent = item.Supplier_name || '-';
  elements.modalVendorId.textContent = item.vendor_id || '-';
  
  // Fill Financial computation
  const invPriceVal = item.inv_amt;
  const supplierPriceVal = item.supplier_price;
  const unitDiff = item.diff; // diff = supplier_price - inv_amt
  const totalDiff = unitDiff * (item.quantity || 1); // diff is already line difference if it's not per unit, but since diff is o.supplier_price - inv_amt, it matches the column values directly
  
  elements.modalCalcSupplierPrice.textContent = formatCurrency(supplierPriceVal);
  elements.modalCalcInvoicePrice.textContent = formatCurrency(invPriceVal);
  elements.modalCalcUnitDiff.textContent = formatCurrency(unitDiff);
  elements.modalCalcTotalDiff.textContent = formatCurrency(totalDiff);
  
  // Visual Severity adjustment
  const modalStatusBadge = elements.modalStatusBadge;
  modalStatusBadge.className = 'modal-badge danger';
  modalStatusBadge.textContent = 'Price Discrepancy';
  
  elements.detailsModal.classList.remove('hidden');
}

function hideModal() {
  elements.detailsModal.classList.add('hidden');
}

// Helper: Debounce function for input elements search
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Render the dedicated Latest 7 Days discrepancy details table and bar chart
function renderSevenDaysTable() {
  const { sevenDaysAgo, todayDate } = getSevenDaysWindow();
  
  // Filter rawData for updates within the 7-day window
  const recentItems = rawData.filter(item => {
    if (!item.updatedon) return false;
    const d = new Date(item.updatedon);
    return !isNaN(d.getTime()) && d >= sevenDaysAgo && d <= todayDate;
  });

  // Sort by updatedon descending (most recent first)
  recentItems.sort((a, b) => new Date(b.updatedon) - new Date(a.updatedon));

  const body = elements.sevenDaysTableBody;
  const emptyState = elements.sevenDaysEmptyState;
  
  if (!body) return;

  if (recentItems.length === 0) {
    body.innerHTML = '';
    emptyState.classList.remove('hidden');
    if (sevenDaysChart) {
      sevenDaysChart.destroy();
      sevenDaysChart = null;
    }
    return;
  }

  emptyState.classList.add('hidden');
  
  // 1. Populate Condensed Table Rows
  let html = '';
  recentItems.forEach(item => {
    html += `
      <tr>
        <td class="font-mono">${formatYtdd(item.updatedon)}</td>
        <td class="font-bold">${item.Supplier_name || '-'}</td>
        <td class="font-mono">${item.po_number || '-'}</td>
        <td class="font-mono">${item.sku || '-'}</td>
        <td class="text-right font-mono">${item.quantity || '0'}</td>
        <td class="text-right font-mono text-danger font-bold">
          <span class="badge ${Math.abs(item.diff) >= 10.0 ? 'badge-danger' : 'badge-warning'}">
            ${formatCurrency(item.diff)}
          </span>
        </td>
      </tr>
    `;
  });

  body.innerHTML = html;

  // 2. Render horizontal bar chart aggregated by Supplier/Vendor (Top 10 highest discrepancies)
  const supplierAgg = {};
  recentItems.forEach(item => {
    if (!item.Supplier_name) return;
    const overpayment = item.diff < 0 ? Math.abs(item.diff) : 0;
    supplierAgg[item.Supplier_name] = (supplierAgg[item.Supplier_name] || 0) + overpayment;
  });

  // Sort by total overpayment descending to show the highest discrepancy at the top
  const sortedSuppliers = Object.entries(supplierAgg)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const labels = sortedSuppliers.map(item => item[0]);
  const data = sortedSuppliers.map(item => Math.round(item[1] * 100) / 100);

  if (sevenDaysChart) {
    sevenDaysChart.destroy();
  }

  const ctx = document.getElementById('sevenDaysBarChart').getContext('2d');
  
  sevenDaysChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Overpayment ($)',
        data: data,
        backgroundColor: 'rgba(244, 63, 94, 0.6)', // rose color matching discrepancy
        borderColor: '#f43f5e',
        borderWidth: 1.5,
        borderRadius: 4,
        hoverBackgroundColor: 'rgba(244, 63, 94, 0.85)',
        hoverBorderColor: '#f43f5e'
      }]
    },
    options: {
      indexAxis: 'y', // Horizontal bars
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) => `Overpayment: $${context.raw.toLocaleString()}`
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { 
            color: '#94a3b8',
            callback: (value) => `$${value.toLocaleString()}`
          }
        },
        y: {
          grid: { display: false },
          ticks: { color: '#f8fafc', font: { weight: '600', size: 10 } }
        }
      }
    }
  });
}

// Export 7-day discrepancies as a CSV file
function downloadSevenDaysCSV() {
  const { sevenDaysAgo, todayDate } = getSevenDaysWindow();
  
  // Filter for items updated in last 7 days
  const recentItems = rawData.filter(item => {
    if (!item.updatedon) return false;
    const d = new Date(item.updatedon);
    return !isNaN(d.getTime()) && d >= sevenDaysAgo && d <= todayDate;
  });

  if (recentItems.length === 0) {
    showToast('No recent discrepancies in the last 7 days to export.', 'info');
    return;
  }

  // Define columns
  const headers = [
    'Updated On',
    'Supplier Name',
    'Vendor ID',
    'PO Number',
    'Order ID',
    'SKU',
    'Quantity',
    'Supplier Price',
    'Invoice Amount',
    'Difference'
  ];

  // Convert rows
  const csvRows = [headers.join(',')];
  recentItems.forEach(item => {
    // Escaped values to avoid CSV breakage
    const supplier = (item.Supplier_name || '').toString().replace(/"/g, '""');
    const po = (item.po_number || '').toString().replace(/"/g, '""');
    const orderId = (item.order_id || '').toString().replace(/"/g, '""');
    const sku = (item.sku || '').toString().replace(/"/g, '""');
    
    // Difference is raw negative number in DB, formatting to positive overpayment
    const diffVal = item.diff < 0 ? Math.abs(item.diff) : 0;

    const row = [
      formatYtdd(item.updatedon),
      `"${supplier}"`,
      item.vendor_id || '',
      `"${po}"`,
      `"${orderId}"`,
      `"${sku}"`,
      item.quantity || 0,
      item.supplier_price || 0,
      item.inv_amt || 0,
      diffVal.toFixed(2)
    ];
    csvRows.push(row.join(','));
  });

  const csvString = csvRows.join('\n');
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `discrepancy_7days_report_${formatYtdd(todayDate)}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  showToast('7-Day CSV report downloaded successfully!', 'success');
}
