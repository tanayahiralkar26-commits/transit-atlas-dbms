# Transportation System DBMS Mini Project — GUI

A beginner-friendly web GUI that connects to the existing `transportation_db` MySQL database in MySQL Workbench.

## Features
- Dashboard counts for all nine tables.
- Browse, search, add, edit and delete records for tables with a single-column primary key.
- Composite-key `route_stop` records can be viewed and added; edit/delete are intentionally limited in the generic screen.
- Booking report joins `booking`, `passenger`, `ticket`, `trip`, and `route`.
- Export the joined booking report to CSV.
- Friendly messages for duplicate values, invalid foreign keys, and records that are still referenced by another table.

## Requirements
- MySQL Server running locally.
- Node.js LTS installed.
- The existing `transportation_db` schema created from the project's SQL script.

## Setup on Windows
1. Extract the ZIP to a folder, for example `Desktop\transportation-system-gui`.
2. Open VS Code → **File → Open Folder** → select that folder.
3. In VS Code, choose **Terminal → New Terminal**.
4. Run:
   ```powershell
   npm install
   ```
5. Copy `.env.example` and name the copy `.env`. In File Explorer, enable **View → Show → File name extensions** if you cannot see file extensions.
6. Open `.env` and set `DB_USER`, `DB_PASSWORD`, and `DB_NAME`. For a typical local MySQL setup, `DB_USER=root` and `DB_NAME=transportation_db`. Enter the password you use for the MySQL Workbench connection. If the account has no password, leave `DB_PASSWORD=` blank.
7. Ensure MySQL Server is running, then run:
   ```powershell
   npm start
   ```
8. Open this address in Chrome: **http://localhost:3000**
9. Keep the terminal open while using the application. Press `Ctrl+C` in the terminal to stop it.

## Troubleshooting
- **Access denied for user**: verify the MySQL username/password in `.env`. Use the same credentials as your Workbench connection.
- **Unknown database**: verify that `transportation_db` exists. In Workbench run `SHOW DATABASES;`.
- **ECONNREFUSED**: start the local MySQL Server service and retry.
- **Port 3000 already in use**: change `PORT=3000` to `PORT=3001` in `.env`, restart, then open `http://localhost:3001`.
- Do not share your `.env` file or publish your database password.

## Project explanation
The interface is a presentation layer. Express exposes API routes, `mysql2` communicates with MySQL, and MySQL stores the normalized relational data. Foreign keys and database constraints continue to protect referential integrity. The Booking Report demonstrates a five-table join.

## Notes
This is a local educational mini-project, not a production ticketing platform. It does not implement login, payment gateway processing, seat-locking concurrency, or online deployment.
