
const $ = (selector) => document.querySelector(selector);

const state = {
  tables: [],
  currentPage: "dashboard",
  currentTable: null,
  dashboard: null,
  report: [],
  search: "",
  loading: false
};

const TABLE_LABELS = {
  station: "Stations",
  passenger: "Passengers",
  vehicle: "Vehicles",
  route: "Routes",
  route_stop: "Route stops",
  trip: "Trips",
  booking: "Bookings",
  ticket: "Tickets",
  payment: "Payments"
};

const $content = $("#content");
const $tableNav = $("#table-nav");
const $title = $("#page-title");

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function money(value) {
  return "₹" + Number(value || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 2
  });
}

function pretty(value) {
  return String(value ?? "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, char => char.toUpperCase());
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 2800);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });

  const type = response.headers.get("content-type") || "";
  const data = type.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new Error(data?.error || data?.message || `Request failed (${response.status})`);
  }

  return data;
}

function setConnection(connected, message) {
  const label = $("#connection-label");
  if (label) {
    label.textContent = message || (connected ? "MySQL connected" : "Database unavailable");
    const dot = label.closest(".sidebar-bottom")?.querySelector(".status-dot");
    if (dot) dot.classList.toggle("connected", connected);
  }
}

function setActiveNav(page) {
  document.querySelectorAll(".nav-item").forEach(button => {
    button.classList.toggle("active", button.dataset.page === page);
  });
}

function setPageTitle(title) {
  if ($title) $title.textContent = title;
}

function kicker(text) {
  return `<div class="section-kicker">${esc(text)}</div>`;
}

function sectionHeading(label, title, right = "") {
  return `
    <div class="section-heading">
      <div>${kicker(label)}<h2>${esc(title)}</h2></div>
      ${right}
    </div>`;
}

function statCard(label, value, note = "") {
  return `
    <article class="stat-card">
      <div class="label">${esc(label)}</div>
      <strong class="value">${esc(value)}</strong>
      <small>${esc(note)}</small>
    </article>`;
}

function emptyState(title, detail = "No records available yet.") {
  return `
    <div class="empty-state">
      <h3>${esc(title)}</h3>
      <p>${esc(detail)}</p>
    </div>`;
}

function renderError(error) {
  $content.innerHTML = `
    <div class="panel">
      <div class="section-kicker">CONNECTION ISSUE</div>
      <h2>We couldn't load this view.</h2>
      <p>${esc(error.message || "An unexpected error occurred.")}</p>
      <button class="primary" id="retry-btn">Try again</button>
    </div>`;
  $("#retry-btn")?.addEventListener("click", () => navigate(state.currentPage));
}

function renderTableNav() {
  $tableNav.innerHTML = state.tables.map((table, index) => {
    const name = typeof table === "string"
      ? table
      : table.name || table.table_name || table.tableName;

    if (!name) return "";

    return `
      <button class="nav-item" data-table="${esc(name)}" data-page="table">
        <span class="nav-number">${String(index + 1).padStart(2, "0")}</span>
        <span>${esc(TABLE_LABELS[name] || pretty(name))}</span>
      </button>`;
  }).join("");

  $tableNav.querySelectorAll("[data-table]").forEach(button => {
    button.addEventListener("click", () => openTable(button.dataset.table));
  });
}

async function initialize() {
  try {
    const result = await api("/api/tables");
    state.tables = Array.isArray(result)
      ? result
      : result.tables || result.data || [];

    setConnection(true, "MySQL connected");
    renderTableNav();
    await navigate("dashboard");
  } catch (error) {
    setConnection(false, "Database unavailable");
    renderError(error);
  }
}


async function navigate(page) {
  state.currentPage = page;
  state.search = "";
  setActiveNav(page);
  $content.innerHTML = `<div class="loading">Loading transport records…</div>`;

  try {
    if (page === "dashboard") {
      setPageTitle("Network overview");
      await renderDashboard();

    } else if (page === "bookings-report") {
      setPageTitle("Journey manifest");
      await renderReport();

    } else if (page === "route-timeline") {
      setPageTitle("Route stop timeline");
      await renderRouteTimeline();
   
    } else if (page === "trip-schedule") {
      setPageTitle("Trip schedule explorer");
      await renderTripSchedule();

    } else if (page === "table") {
      await renderTable(state.currentTable);
    }

  } catch (error) {
    renderError(error);
  }
}


async function getTableData(tableName) {
  const result = await api(`/api/${encodeURIComponent(tableName)}`);

  if (Array.isArray(result)) return result;
  if (Array.isArray(result.rows)) return result.rows;
  if (Array.isArray(result.data)) return result.data;
  if (Array.isArray(result.records)) return result.records;

  return [];
}


function normalizeTableName(table) {
  return typeof table === "string"
    ? table
    : table.name || table.table_name || table.tableName;
}

function makeConnections(stations, routes) {
  if (!stations.length || !routes.length) {
    return emptyState("No network connections yet", "Add stations and routes to map your network.");
  }

  const byId = new Map(stations.map(station => [
    String(station.station_id),
    station.station_name
  ]));

  return `
    <div class="route-list">
      ${routes.slice(0, 6).map(route => {
        const origin = byId.get(String(route.origin_id)) || `Station ${route.origin_id ?? "—"}`;
        const destination = byId.get(String(route.destination_id)) || `Station ${route.destination_id ?? "—"}`;

        return `
          <div class="route-row">
            <div>
              <div class="route-name">${esc(route.route_name || `Route ${route.route_id}`)}</div>
              <div class="route-detail">${esc(origin)} → ${esc(destination)}</div>
            </div>
            <div class="route-line">${esc(route.distance_km ?? "—")} km</div>
          </div>`;
      }).join("")}
    </div>`;
}


function makeNetworkGraphic(stations, routes) {
  const points = stations.slice(0, 6);
  if (!points.length) {
    return `<div class="hero-map"></div>`;
  }

  const width = 360;
  const height = 210;
  const positions = points.map((station, index) => ({
    station,
    x: 35 + ((index * 67 + 24) % 285),
    y: 30 + ((index * 43 + (index % 2) * 34) % 145)
  }));

  const lines = routes.slice(0, 6).map((route, index) => {
    const from = positions.find(p => String(p.station.station_id) === String(route.origin_id));
    const to = positions.find(p => String(p.station.station_id) === String(route.destination_id));

    if (!from || !to) {
      const a = positions[index % positions.length];
      const b = positions[(index + 1) % positions.length];
      if (!a || !b || a === b) return "";
      return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#e87542" stroke-width="2" stroke-linecap="round" />`;
    }

    return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="#e87542" stroke-width="2.5" stroke-linecap="round" />`;
  }).join("");

  const nodes = positions.map(({ station, x, y }) => `
    <g>
      <circle cx="${x}" cy="${y}" r="6" fill="#204638" stroke="#fffdf5" stroke-width="2.5"/>
      <text x="${x + 9}" y="${y - 9}" font-size="9" fill="#fffdf5">${esc((station.station_name || "Station").slice(0, 17))}</text>
    </g>`).join("");

  return `
    <div class="network-map" style="background-color:#204638">
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" role="img" aria-label="Schematic map of database station connections">
        ${lines}
        ${nodes}
      </svg>
    </div>`;
}


async function renderDashboard() {
  const names = state.tables.map(normalizeTableName).filter(Boolean);

  const [stations, routes, vehicles, trips, bookings, passengers, tickets, payments] =
    await Promise.all([
      getSafeTable("station", names),
      getSafeTable("route", names),
      getSafeTable("vehicle", names),
      getSafeTable("trip", names),
      getSafeTable("booking", names),
      getSafeTable("passenger", names),
      getSafeTable("ticket", names),
      getSafeTable("payment", names)
    ]);

  state.dashboard = { stations, routes, vehicles, trips, bookings, passengers, tickets, payments };

  const paidTotal = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const activeBookings = bookings.filter(booking =>
    !/cancel/i.test(String(booking.status || ""))
  ).length;

  $content.innerHTML = `
    <section class="dashboard-hero hero">
      <div>
        ${kicker("YOUR TRANSPORT NETWORK · LIVE DATABASE")}
        <h1 class="hero-title">Every journey<br>starts somewhere.</h1>
        <p>A connected view of your stations, routes, vehicles and passenger journeys — powered by your relational database.</p>
        <div class="page-actions">
          <button class="primary" id="view-bookings">Explore journey manifest ↗</button>
          <button class="secondary" id="view-routes">Browse routes</button>
        </div>
      </div>
      ${makeNetworkGraphic(stations, routes)}
    </section>

    ${sectionHeading("NETWORK SNAPSHOT", "At a glance")}
    <div class="stats-grid">
      ${statCard("Stations", stations.length, "Network locations")}
      ${statCard("Routes", routes.length, "Defined connections")}
      ${statCard("Vehicles", vehicles.length, "Registered fleet")}
      ${statCard("Trips", trips.length, "Scheduled journeys")}
    </div>

    <div class="stats-grid">
      ${statCard("Passengers", passengers.length, "Registered travellers")}
      ${statCard("Bookings", bookings.length, "Total reservations")}
      ${statCard("Active bookings", activeBookings, "Excluding cancelled")}
      ${statCard("Payments recorded", money(paidTotal), `${payments.length} payment records`)}
    </div>

    <div class="dashboard-grid">
      <section class="panel">
        <div class="panel-header">
          <div>${kicker("CONNECTIONS")}<h2 style="margin-top:7px">Routes across the network</h2></div>
          <button class="secondary" id="all-routes">View data ↗</button>
        </div>
        ${makeConnections(stations, routes)}
      </section>

    </div>`;

  $("#view-bookings")?.addEventListener("click", () => navigate("bookings-report"));
  
  $("#view-routes")?.addEventListener("click", () => openTable("route"));
  $("#all-routes")?.addEventListener("click", () => openTable("route"));

  $content.querySelectorAll("[data-open-table]").forEach(button => {
    button.addEventListener("click", () => openTable(button.dataset.openTable));
  });
}

async function getSafeTable(name, availableNames) {
  if (!availableNames.includes(name)) return [];

  try {
    return await getTableData(name);
  } catch (error) {
    console.warn(`Could not load ${name}:`, error.message);
    return [];
  }
}

async function openTable(name) {
  state.currentTable = name;
  state.currentPage = "table";
  state.search = "";
  setActiveNav("table");
  setPageTitle(TABLE_LABELS[name] || pretty(name));
  await navigate("table");
}

function tableColumns(rows) {
  if (!rows.length) return [];
  return Object.keys(rows[0]);
}

function renderCell(value) {
  if (value === null || value === undefined || value === "") {
    return `<span class="text-muted">—</span>`;
  }

  if (typeof value === "object") {
    return esc(JSON.stringify(value));
  }

  return esc(value);
}


function renderRows(rows, columns) {
  if (!rows.length) {
    return `<tr><td colspan="${columns.length + 2}">
      ${emptyState("No matching records", "Try changing your search or add a record.")}
    </td></tr>`;
  }

  return rows.map((row, index) => `
    <tr>
      ${columns.map(column => `<td>${renderCell(row[column])}</td>`).join("")}
      <td><span class="badge">Record</span></td>
      <td>
        <button class="secondary edit-record" data-index="${index}">Edit</button>
        <button class="secondary delete-record" data-index="${index}">Delete</button>
      </td>
    </tr>
  `).join("");
}


async function renderTable(name) {
  if (!name) {
    throw new Error("Choose a database table from the left menu.");
  }

  setPageTitle(TABLE_LABELS[name] || pretty(name));
  $content.innerHTML = `<div class="loading">Reading ${esc(name)} records…</div>`;

  const rows = await getTableData(name);
  const columns = tableColumns(rows);
  const title = TABLE_LABELS[name] || pretty(name);

  $content.innerHTML = `
    <div>
      ${kicker("DATA REGISTRY / " + name.toUpperCase())}
      <h1 class="page-heading">${esc(title)}</h1>
      <p class="muted">Explore records stored in the ${esc(name)} relation.</p>
    </div>

    <div class="section-heading">
      <div>${kicker("TABLE EXPLORER")}<h2>${esc(title)} records</h2></div>
      <span class="record-count">${rows.length} RECORDS</span>
    </div>

    <section class="table-panel">
      <div class="panel" style="border:0;border-bottom:1px solid var(--line)">
        <div class="table-toolbar">
          <input id="table-search" class="search-input" type="search" placeholder="Search records…" aria-label="Search table records">
          <div class="toolbar-actions">
  <button class="secondary" id="refresh-table">↻ Refresh</button>
  <button class="secondary" id="add-record">+ Add Record</button>
  <button class="primary" id="export-table">Export CSV ↓</button>
</div>
        </div>
        <div class="record-count" id="filtered-count">${rows.length} records shown</div>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
           <tr>${columns.map(column => `<th>${esc(pretty(column))}</th>`).join("")}<th>Type</th><th>Actions</th></tr>
          </thead>
          <tbody id="data-rows">${renderRows(rows, columns)}</tbody>
        </table>
      </div>
    </section>`;

  const search = $("#table-search");

const tableBody = $("#data-rows");

tableBody.addEventListener("click", async event => {
  const editButton = event.target.closest(".edit-record");
  const deleteButton = event.target.closest(".delete-record");

  if (editButton) {
    const index = Number(editButton.dataset.index);
    const row = rows[index];
    const meta = await api(`/api/${encodeURIComponent(name)}/meta`);
    const primary = Array.isArray(meta.primary)
      ? meta.primary[0]
      : meta.primary;

    const fields = columns
      .filter(column => column !== primary)
      .map(column => `
        <label class="form-field">
          <span>${esc(pretty(column))}</span>
          <input name="${esc(column)}"
            value="${esc(String(row[column] ?? ""))}">
        </label>
      `).join("");

    $content.innerHTML = `
      <h1 class="page-heading">Edit ${esc(TABLE_LABELS[name] || pretty(name))}</h1>
      <section class="table-panel panel">
        <form id="edit-record-form">
          <div class="form-grid">${fields}</div>
          <div class="toolbar-actions" style="margin-top:24px">
            <button type="button" class="secondary" id="cancel-edit">Cancel</button>
            <button type="submit" class="primary">Save Changes</button>
          </div>
          <p id="edit-message" class="muted"></p>
        </form>
      </section>`;

    $("#cancel-edit").addEventListener("click", () => renderTable(name));

    $("#edit-record-form").addEventListener("submit", async e => {
      e.preventDefault();
      const record = Object.fromEntries(new FormData(e.currentTarget).entries());

      try {
        const response = await api(
          `/api/${encodeURIComponent(name)}/${encodeURIComponent(row[primary])}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(record)
          }
        );

        await renderTable(name);
      } catch (error) {
        $("#edit-message").textContent = `Update failed: ${error.message}`;
      }
    });
  }

  if (deleteButton) {
    const index = Number(deleteButton.dataset.index);
    const row = rows[index];
    const meta = await api(`/api/${encodeURIComponent(name)}/meta`);
    const primary = Array.isArray(meta.primary)
      ? meta.primary[0]
      : meta.primary;

    if (!confirm("Delete this record? This cannot be undone.")) return;

    try {
      await api(
        `/api/${encodeURIComponent(name)}/${encodeURIComponent(row[primary])}`,
        { method: "DELETE" }
      );
      await renderTable(name);
    } catch (error) {
      alert(`Delete failed: ${error.message}`);
    }
  }
});

  function updateRows() {
    const query = search.value.trim().toLowerCase();
    const filtered = rows.filter(row =>
      columns.some(column => String(row[column] ?? "").toLowerCase().includes(query))
    );

    $("#data-rows").innerHTML = renderRows(filtered, columns);
    $("#filtered-count").textContent = `${filtered.length} of ${rows.length} records shown`;
  }

  search.addEventListener("input", updateRows);
  $("#refresh-table").addEventListener("click", () => navigate("table"));
  $("#add-record").addEventListener("click", () => addRecordForm(name));
  $("#export-table").addEventListener("click", () => downloadCSV(`${name}.csv`, columns, rows));
}
async function addRecordForm(tableName) {
  try {
    const meta = await api(`/api/${encodeURIComponent(tableName)}/meta`);
   const rawColumns = meta.columns || [];

const columns = rawColumns.map(column => {
  if (typeof column === "string") return column;

  return (
    column.Field ||
    column.field ||
    column.COLUMN_NAME ||
    column.column_name ||
    column.name ||
    column.columnName ||
    column.key ||
    ""
  );
}).filter(Boolean);

const primary = meta.primary;

    const fields = columns
  .filter(column => column !== primary)
  .map(column => `
    <label class="form-field">
      <span>${esc(pretty(column))}</span>
      <input
        name="${esc(column)}"
        placeholder="Enter ${esc(pretty(column).toLowerCase())}"
      >
    </label>
  `)
  .join("");

    $content.innerHTML = `
      <div>
        ${kicker("DATA REGISTRY / NEW RECORD")}
        <h1 class="page-heading">Add ${esc(TABLE_LABELS[tableName] || pretty(tableName))}</h1>
        <p class="muted">Enter the details below to create a new record.</p>
      </div>

      <section class="table-panel panel">
        <form id="add-record-form">
          <div class="form-grid">${fields}</div>
          <div class="toolbar-actions" style="margin-top:24px">
            <button type="button" class="secondary" id="cancel-add">Cancel</button>
            <button type="submit" class="primary">Save Record</button>
          </div>
          <p id="form-message" class="muted" role="status"></p>
        </form>
      </section>
    `;

    $("#cancel-add").addEventListener("click", () => navigate("table"));

    $("#add-record-form").addEventListener("submit", async event => {
      event.preventDefault();

      const form = event.currentTarget;
      const record = Object.fromEntries(new FormData(form).entries());

      for (const key of Object.keys(record)) {
        if (record[key] === "") delete record[key];
      }

      const message = $("#form-message");
      const saveButton = form.querySelector('button[type="submit"]');

      try {
        saveButton.disabled = true;
        message.textContent = "Saving record…";

        await api(`/api/${encodeURIComponent(tableName)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(record)
        });

        message.textContent = "Record added successfully!";
        await renderTable(tableName);
      } catch (error) {
        message.textContent = `Could not save record: ${error.message}`;
        saveButton.disabled = false;
      }
    });
  } catch (error) {
    console.error("Could not prepare add-record form:", error);
    $content.innerHTML = `
      <div class="panel">
        <h2>Could not open the form</h2>
        <p>${esc(error.message)}</p>
        <button class="secondary" id="back-to-table">Back to table</button>
      </div>
    `;
    $("#back-to-table").addEventListener("click", () => navigate("table"));
  }
}
async function renderReport() {
  let rows = [];

  
  try {
    const result = await api("/api/booking-details");

    rows = Array.isArray(result)
      ? result
      : result.rows || result.data || result.bookings || [];
  } catch (error) {
    console.error("Could not load booking details:", error);
    rows = await buildBookingReport();
  }


  state.report = rows;

  $content.innerHTML = `
    <div>
      ${kicker("PASSENGER SERVICES / BOOKING REGISTER")}
      <h1 class="page-heading">Journey manifest.</h1>
      <p class="muted">A consolidated view of reservations and their journey details.</p>
    </div>

    <div class="stats-grid">
      ${statCard("Reservations", rows.length, "Rows in manifest")}
      ${statCard("Confirmed", rows.filter(row => /confirm|booked/i.test(String(row.status || ""))).length, "Confirmed or booked")}
      ${statCard("Cancelled", rows.filter(row => /cancel/i.test(String(row.status || ""))).length, "Cancelled reservations")}
      ${statCard("Export", "CSV", "Download the manifest")}
    </div>

    <section class="table-panel">
      <div class="panel" style="border:0;border-bottom:1px solid var(--line)">
        <div class="table-toolbar">
          <input id="report-search" class="search-input" type="search" placeholder="Find passenger, route or status…" aria-label="Search bookings">
          <div class="toolbar-actions">
            <button class="secondary" id="refresh-report">↻ Refresh</button>
            <button class="primary" id="export-report">Export manifest ↓</button>
          </div>
        </div>
        <div id="report-count" class="record-count">${rows.length} reservations</div>
      </div>
      <div class="table-wrap">
        <table>
          <thead id="report-head"></thead>
          <tbody id="report-body"></tbody>
        </table>
      </div>
    </section>`;

  const columns = tableColumns(rows);
  $("#report-head").innerHTML = `<tr>${columns.map(column => `<th>${esc(pretty(column))}</th>`).join("")}</tr>`;

  function update() {
    const query = $("#report-search").value.trim().toLowerCase();
    const filtered = rows.filter(row =>
      columns.some(column => String(row[column] ?? "").toLowerCase().includes(query))
    );

    $("#report-body").innerHTML = filtered.length
      ? filtered.map(row => `<tr>${columns.map(column => `<td>${renderCell(row[column])}</td>`).join("")}</tr>`).join("")
      : `<tr><td colspan="${Math.max(columns.length, 1)}">${emptyState("No reservations found")}</td></tr>`;

    $("#report-count").textContent = `${filtered.length} of ${rows.length} reservations`;
  }

  $("#report-search").addEventListener("input", update);
  $("#refresh-report").addEventListener("click", () => navigate("bookings-report"));
  $("#export-report").addEventListener("click", () => downloadCSV("journey-manifest.csv", columns, rows));
  update();
}

async function renderRouteTimeline() {
  const [routes, stations, routeStops] = await Promise.all([
    getTableData("route"),
    getTableData("station"),
    getTableData("route_stop")
  ]);

  const routeSelectOptions = routes.map(route => `
    <option value="${esc(route.route_id)}">
      ${esc(route.route_name || `Route ${route.route_id}`)}
    </option>
  `).join("");

  $content.innerHTML = `
    <div>
      ${kicker("NETWORK PLANNING / ROUTE EXPLORER")}
      <h1 class="page-heading">Route stop timeline.</h1>
      <p class="muted">Explore each route's stations in travel order, from origin to destination.</p>
    </div>

    <section class="table-panel">
      <div class="panel">
        <label for="timeline-route"><strong>Select a route</strong></label>
        <select id="timeline-route" class="search-input" style="margin-top:12px;max-width:480px">
          <option value="">Choose a route…</option>
          ${routeSelectOptions}
        </select>
        <div id="timeline-summary" class="muted" style="margin-top:16px">
          Select a route to view its stops.
        </div>
      </div>
      <div id="timeline-content" class="panel">
        ${emptyState("Choose a route to display its station timeline")}
      </div>
    </section>
  `;

  const select = $("#timeline-route");
  const summary = $("#timeline-summary");
  const timeline = $("#timeline-content");

  function renderSelectedRoute() {
    const routeId = select.value;

    if (!routeId) {
      summary.textContent = "Select a route to view its stops.";
      timeline.innerHTML = emptyState("Choose a route to display its station timeline");
      return;
    }

    const route = routes.find(
      item => String(item.route_id) === String(routeId)
    );

    const stops = routeStops
      .filter(stop => String(stop.route_id) === String(routeId))
      .sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));

    const stationMap = new Map(
      stations.map(station => [
        String(station.station_id),
        station
      ])
    );

    if (!stops.length) {
      summary.textContent = route
        ? `${route.route_name || `Route ${route.route_id}`} · No stops recorded`
        : "No route selected.";

      timeline.innerHTML = emptyState("No stops have been recorded for this route yet.");
      return;
    }

    const originStation = stationMap.get(String(route?.origin_id));
    const destinationStation = stationMap.get(String(route?.destination_id));

    summary.textContent =
      `${route?.route_name || `Route ${routeId}`} · ${stops.length} recorded stops` +
      (route?.distance_km != null ? ` · ${route.distance_km} km` : "");

    timeline.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:0;padding:8px 0">
        ${stops.map((stop, index) => {
          const station = stationMap.get(String(stop.station_id));
          const isFirst = index === 0;
          const isLast = index === stops.length - 1;
          const isOrigin = String(stop.station_id) === String(route?.origin_id);
          const isDestination = String(stop.station_id) === String(route?.destination_id);

          return `
            <div style="display:grid;grid-template-columns:48px minmax(0,1fr);gap:14px;min-height:88px">
              <div style="display:flex;flex-direction:column;align-items:center">
                <div style="
                  width:34px;height:34px;border-radius:50%;
                  display:flex;align-items:center;justify-content:center;
                  border:2px solid var(--accent, #245c45);
                  background:${isOrigin || isDestination ? "var(--accent, #245c45)" : "transparent"};
                  color:${isOrigin || isDestination ? "#fff" : "var(--text, #245c45)"};
                  font-weight:700;font-size:12px">
                  ${index + 1}
                </div>
                ${!isLast ? `<div style="width:2px;flex:1;min-height:42px;background:var(--line,#ddd);margin:4px 0"></div>` : ""}
              </div>
              <div style="padding:3px 0 22px">
                <div style="font-weight:600">
                  ${esc(station?.station_name || `Station ID ${stop.station_id}`)}
                </div>
                <div class="muted" style="font-size:13px;margin-top:4px">
                  ${esc([station?.city, station?.state].filter(Boolean).join(", ") || "Location not specified")}
                </div>
                <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-top:7px;color:var(--accent,#245c45)">
                  ${isOrigin ? "Origin" : isDestination ? "Destination" : `Stop sequence ${esc(stop.stop_sequence)}`}
                </div>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  select.addEventListener("change", renderSelectedRoute);
}

async function renderTripSchedule() {
  const [trips, routes, vehicles] = await Promise.all([
    getTableData("trip"),
    getTableData("route"),
    getTableData("vehicle")
  ]);

  $content.innerHTML = `
    <div>
      ${kicker("OPERATIONS / TRIP PLANNER")}
      <h1 class="page-heading">Trip schedule explorer.</h1>
      <p class="muted">Explore scheduled journeys, departure times, vehicles and fares.</p>
    </div>

    <section class="table-panel">
      <div class="panel">
        <label for="schedule-route"><strong>Filter by route</strong></label>
        <select id="schedule-route" class="search-input"
          style="margin-top:12px;max-width:480px">
          <option value="all">All routes</option>
          ${routes.map(route => `
            <option value="${esc(route.route_id)}">
              ${esc(route.route_name || `Route ${route.route_id}`)}
            </option>
          `).join("")}
        </select>

        <input
          id="schedule-search"
          class="search-input"
          type="search"
          placeholder="Search route, vehicle or trip ID…"
          aria-label="Search trips"
          style="margin-top:14px;max-width:480px"
        />
        <div id="schedule-count" class="record-count"
          style="margin-top:12px"></div>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Trip ID</th>
              <th>Route</th>
              <th>Vehicle</th>
              <th>Departure</th>
              <th>Arrival</th>
              <th>Base fare</th>
            </tr>
          </thead>
          <tbody id="schedule-body"></tbody>
        </table>
      </div>
    </section>
  `;

  const routeSelect = $("#schedule-route");
  const searchInput = $("#schedule-search");
  const tbody = $("#schedule-body");
  const count = $("#schedule-count");

  function updateSchedule() {
    const selectedRoute = routeSelect.value;
    const query = searchInput.value.trim().toLowerCase();

    const filtered = trips.filter(trip => {
      const route = routes.find(
        item => String(item.route_id) === String(trip.route_id)
      );

      const vehicle = vehicles.find(
        item => String(item.vehicle_id) === String(trip.vehicle_id)
      );

      const matchesRoute =
        selectedRoute === "all" ||
        String(trip.route_id) === selectedRoute;

      const searchable = [
        trip.trip_id,
        route?.route_name,
        vehicle?.vehicle_type,
        vehicle?.reg_no,
        trip.departure_time,
        trip.arrival_time
      ].join(" ").toLowerCase();

      return matchesRoute && searchable.includes(query);
    });

    count.textContent = `${filtered.length} of ${trips.length} trips`;

    tbody.innerHTML = filtered.length
      ? filtered.map(trip => {
          const route = routes.find(
            item => String(item.route_id) === String(trip.route_id)
          );

          const vehicle = vehicles.find(
            item => String(item.vehicle_id) === String(trip.vehicle_id)
          );

          return `
            <tr>
              <td>${esc(trip.trip_id)}</td>
              <td>${esc(route?.route_name || `Route ${trip.route_id}`)}</td>
              <td>${esc(
                vehicle
                  ? `${vehicle.vehicle_type || ""} ${vehicle.reg_no ? `(${vehicle.reg_no})` : ""}`.trim()
                  : `Vehicle ${trip.vehicle_id}`
              )}</td>
              <td>${esc(trip.departure_time ?? "—")}</td>
              <td>${esc(trip.arrival_time ?? "—")}</td>
              <td>${esc(trip.base_fare ?? "—")}</td>
            </tr>
          `;
        }).join("")
      : `<tr><td colspan="6">${emptyState("No matching trips found")}</td></tr>`;
  }

  routeSelect.addEventListener("change", updateSchedule);
  searchInput.addEventListener("input", updateSchedule);

  updateSchedule();
}

async function buildBookingReport() {
  const [bookings, passengers, tickets, trips, routes] = await Promise.all([
    getSafeTable("booking", state.tables.map(normalizeTableName)),
    getSafeTable("passenger", state.tables.map(normalizeTableName)),
    getSafeTable("ticket", state.tables.map(normalizeTableName)),
    getSafeTable("trip", state.tables.map(normalizeTableName)),
    getSafeTable("route", state.tables.map(normalizeTableName))
  ]);

  const passengerById = new Map(passengers.map(row => [String(row.passenger_id), row]));
  const tripById = new Map(trips.map(row => [String(row.trip_id), row]));
  const routeById = new Map(routes.map(row => [String(row.route_id), row]));

  return bookings.map(booking => {
    const passenger = passengerById.get(String(booking.passenger_id)) || {};
    const trip = tripById.get(String(booking.trip_id)) || {};
    const route = routeById.get(String(trip.route_id)) || {};
    const bookingTickets = tickets.filter(ticket => String(ticket.booking_id) === String(booking.booking_id));

    return {
      booking_id: booking.booking_id,
      passenger: passenger.full_name || "—",
      phone: passenger.phone || "—",
      route: route.route_name || "—",
      departure_time: trip.departure_time || "—",
      status: booking.status || "—",
      booking_date: booking.booking_date || "—",
      tickets: bookingTickets.length,
      total_fare: bookingTickets.reduce((sum, ticket) => sum + Number(ticket.fare || 0), 0)
    };
  });
}

function downloadCSV(filename, columns, rows) {
  if (!rows.length) {
    toast("There are no records to export.");
    return;
  }

  const escapeCSV = value => {
    const text = String(value ?? "");
    return `"${text.replace(/"/g, '""')}"`;
  };

  const csv = [
    columns.map(escapeCSV).join(","),
    ...rows.map(row => columns.map(column => escapeCSV(row[column])).join(","))
  ].join("\r\n");

  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);

  toast("CSV export started.");
}

document.addEventListener("click", event => {
  const nav = event.target.closest("[data-page]");
  if (!nav) return;

  if (
  nav.dataset.page === "dashboard" ||
  nav.dataset.page === "bookings-report" ||
  nav.dataset.page === "route-timeline"||
  nav.dataset.page === "trip-schedule"
) {
    event.preventDefault();
    navigate(nav.dataset.page);
     nav.dataset.page === "trip-schedule"
  }
});

initialize();
