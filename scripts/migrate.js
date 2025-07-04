const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Ensure database directory exists
const dbDir = path.dirname(process.env.DATABASE_URL || './database/comments.db');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

// Connect to database
const db = new sqlite3.Database(process.env.DATABASE_URL || './database/comments.db', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
    console.log('Connected to SQLite database');
});

// Read and execute schema
const schemaPath = path.join(__dirname, '../database/schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');

// Split by semicolon and execute each statement
const statements = schema.split(';').filter(stmt => stmt.trim().length > 0);

console.log(`Executing ${statements.length} database statements...`);

// Execute statements sequentially
async function runMigrations() {
    for (let i = 0; i < statements.length; i++) {
        const statement = statements[i].trim();
        if (!statement) continue;

        try {
            await new Promise((resolve, reject) => {
                db.run(statement, (err) => {
                    if (err) {
                        console.error(`Error executing statement ${i + 1}:`, err.message);
                        console.error('Statement:', statement);
                        reject(err);
                    } else {
                        console.log(`✓ Executed statement ${i + 1}`);
                        resolve();
                    }
                });
            });
        } catch (error) {
            console.error('Migration failed:', error);
            process.exit(1);
        }
    }

    console.log('✅ Database migration completed successfully!');
    
    // Close database connection
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        } else {
            console.log('Database connection closed');
        }
        process.exit(0);
    });
}

runMigrations(); 