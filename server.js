require("dotenv").config();
console.log("ENV file loaded:", require("fs").existsSync(".env"));
console.log("DB user:", process.env.DB_USER);
console.log("DB password is empty:", !process.env.DB_PASSWORD);
const express = require("express");
const path = require("path");
const mysql = require("mysql2/promise");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost", 
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",  
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "transportation_db",
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true
});
async function testDatabaseConnection() {
  try {
    const connection = await pool.getConnection();
    console.log("MySQL connection successful!");
    const [rows] = await connection.query(
      "SELECT USER() AS user, DATABASE() AS db, @@port AS port"
    );
    console.log("Database details:", rows[0]);
    connection.release();
  } catch (error) {
    console.error("MySQL connection failed:", error.message);
  }
}

testDatabaseConnection();

const TABLES = [
  "station", "route", "route_stop", "vehicle", "trip",
  "passenger", "booking", "ticket", "payment"
];
const metadata = {};

function validTable(table) {
  return TABLES.includes(table);
}
function quoteId(id) {
  return "`" + String(id).replace(/`/g, "``") + "`";
}
async function getMeta(table) {
  if (!validTable(table)) throw new Error("Unknown table.");
  if (metadata[table]) return metadata[table];
  const [cols] = await pool.query(
    `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_KEY, EXTRA, IS_NULLABLE, COLUMN_DEFAULT
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
    [process.env.DB_NAME || "transportation_db", table]
  );
  const primary = cols.filter(c => c.COLUMN_KEY === "PRI").map(c => c.COLUMN_NAME);
  metadata[table] = { columns: cols, primary };
  return metadata[table];
}

app.get("/api/health", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT DATABASE() AS database_name");
    res.json({ ok: true, database: rows[0].database_name });
  } catch (e) {
    res.status(500).json({ ok: false, message: "Could not connect to MySQL. Check your .env settings.", detail: e.message });
  }
});

app.get("/api/tables", (req, res) => res.json(TABLES));

app.get("/api/dashboard", async (req, res) => {
  try {
    const stats = {};
    for (const t of TABLES) {
      const [r] = await pool.query(`SELECT COUNT(*) AS total FROM ${quoteId(t)}`);
      stats[t] = Number(r[0].total);
    }
    const [recent] = await pool.query(`
      SELECT b.booking_id, p.full_name AS passenger_name, b.booking_date, b.status,
             tr.trip_id, r.route_name
      FROM booking b
      JOIN passenger p ON p.passenger_id = b.passenger_id
      JOIN trip tr ON tr.trip_id = b.trip_id
      JOIN route r ON r.route_id = tr.route_id
      ORDER BY b.booking_id DESC LIMIT 8
    `);
    res.json({ stats, recent });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.get("/api/booking-details", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT b.booking_id, p.full_name AS passenger_name, p.phone,
             b.booking_date, b.status, t.ticket_id, t.seat_no,
             t.traveller_name, tr.trip_id, tr.departure_time, tr.arrival_time,
             r.route_name, r.distance_km, t.fare
      FROM booking b
      JOIN passenger p ON b.passenger_id = p.passenger_id
      JOIN ticket t ON b.booking_id = t.booking_id
      JOIN trip tr ON b.trip_id = tr.trip_id
      JOIN route r ON tr.route_id = r.route_id
      ORDER BY b.booking_id, t.ticket_id
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.get("/api/:table/meta", async (req, res) => {
  try {
    const m = await getMeta(req.params.table);
    res.json({ columns: m.columns, primary: m.primary });
  } catch (e) { res.status(400).json({ message: e.message }); }
});

app.get("/api/:table", async (req, res) => {
  try {
    const table = req.params.table;
    const m = await getMeta(table);
    const [rows] = await pool.query(`SELECT * FROM ${quoteId(table)} LIMIT 500`);
    res.json({ rows, primary: m.primary, columns: m.columns });
  } catch (e) { res.status(400).json({ message: e.message }); }
});

app.post("/api/:table", async (req, res) => {
  try {
    const table = req.params.table;
    const m = await getMeta(table);
    const body = req.body || {};
    const allowed = new Set(m.columns.filter(c => !c.EXTRA.includes("auto_increment")).map(c => c.COLUMN_NAME));
    const keys = Object.keys(body).filter(k => allowed.has(k) && body[k] !== "" && body[k] !== null && body[k] !== undefined);
    if (!keys.length) return res.status(400).json({ message: "Enter at least one field." });
    const sql = `INSERT INTO ${quoteId(table)} (${keys.map(quoteId).join(",")}) VALUES (${keys.map(() => "?").join(",")})`;
    const [result] = await pool.execute(sql, keys.map(k => body[k]));
    res.json({ ok: true, insertId: result.insertId });
  } catch (e) { res.status(400).json({ message: friendlyError(e) }); }
});

app.put("/api/:table/:id", async (req, res) => {
  try {
    const table = req.params.table;
    const m = await getMeta(table);
    if (m.primary.length !== 1) return res.status(400).json({ message: "Editing this table requires a single-column primary key." });
    const pk = m.primary[0];
    const allowed = new Set(m.columns.filter(c => c.COLUMN_NAME !== pk && !c.EXTRA.includes("auto_increment")).map(c => c.COLUMN_NAME));
    const keys = Object.keys(req.body || {}).filter(k => allowed.has(k));
    if (!keys.length) return res.status(400).json({ message: "No editable fields supplied." });
    const values = keys.map(k => req.body[k] === "" ? null : req.body[k]);
    const [result] = await pool.execute(
      `UPDATE ${quoteId(table)} SET ${keys.map(k => `${quoteId(k)} = ?`).join(", ")} WHERE ${quoteId(pk)} = ?`,
      [...values, req.params.id]
    );
    res.json({ ok: true, affectedRows: result.affectedRows });
  } catch (e) { res.status(400).json({ message: friendlyError(e) }); }
});

app.delete("/api/:table/:id", async (req, res) => {
  try {
    const table = req.params.table;
    const m = await getMeta(table);
    if (m.primary.length !== 1) return res.status(400).json({ message: "This table has a composite primary key and cannot be deleted using this screen." });
    const [result] = await pool.execute(
      `DELETE FROM ${quoteId(table)} WHERE ${quoteId(m.primary[0])} = ?`,
      [req.params.id]
    );
    res.json({ ok: true, affectedRows: result.affectedRows });
  } catch (e) { res.status(400).json({ message: friendlyError(e) }); }
});

function friendlyError(e) {
  if (e.code === "ER_DUP_ENTRY") return "That value already exists. Check primary keys and unique fields.";
  if (e.code === "ER_NO_REFERENCED_ROW_2") return "This record refers to an ID that does not exist in the related table.";
  if (e.code === "ER_ROW_IS_REFERENCED_2") return "This record is used by another table, so it cannot be deleted yet.";
  if (e.code === "ER_BAD_NULL_ERROR" || e.code === "ER_NO_DEFAULT_FOR_FIELD") return "A required field is missing.";
  if (e.code === "ER_CHECK_CONSTRAINT_VIOLATED") return "A value failed a database CHECK constraint.";
  return e.message || "Database operation failed.";
}

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Transportation System running at http://localhost:${port}`));