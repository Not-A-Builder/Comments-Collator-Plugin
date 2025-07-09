const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Ensure database directory exists
const dbPath = process.env.DATABASE_URL || './database/comments.db';
const dbDir = path.dirname(dbPath);

// Create directory if it doesn't exist
try {
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
        console.log(`Created database directory: ${dbDir}`);
    }
} catch (error) {
    console.log(`Could not create directory ${dbDir}, using file directly:`, error.message);
}

console.log(`Using database path: ${dbPath}`);

// Connect to database
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
    console.log('Connected to SQLite database');
});

// Read and execute schema
const schemaPath = path.join(__dirname, '../database/schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');

// Split statements properly, handling multi-line statements like triggers
function parseStatements(sql) {
    const statements = [];
    let current = '';
    let inTrigger = false;
    
    const lines = sql.split('\n');
    
    for (const line of lines) {
        const trimmedLine = line.trim();
        
        // Skip comments and empty lines
        if (trimmedLine.startsWith('--') || trimmedLine === '') {
            continue;
        }
        
        current += line + '\n';
        
        // Check if we're starting a trigger
        if (trimmedLine.toUpperCase().includes('CREATE TRIGGER')) {
            inTrigger = true;
        }
        
        // Check if we're ending a trigger
        if (inTrigger && trimmedLine.toUpperCase() === 'END;') {
            inTrigger = false;
            statements.push(current.trim());
            current = '';
        }
        // Check for regular statement end (semicolon) when not in trigger
        else if (!inTrigger && trimmedLine.endsWith(';')) {
            statements.push(current.trim());
            current = '';
        }
    }
    
    // Add any remaining statement
    if (current.trim()) {
        statements.push(current.trim());
    }
    
    return statements.filter(stmt => stmt.length > 0);
}

const statements = parseStatements(schema);

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