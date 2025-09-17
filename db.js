import mysql from 'mysql2';
import dotenv from 'dotenv';

dotenv.config();

// Change createConnection to createPool
const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'arsha_ai',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Optional: This check confirms the pool can connect to the database.
pool.getConnection((err, connection) => {
    if (err) {
        console.error("❌ DB pool creation failed:", err.message);
        return;
    }
    console.log("✅ Arsha connected to live DB via connection pool");
    connection.release(); // Return the connection to the pool
});

// Export the pool
export default pool;