// server.js - Backend Server with SQLite Database
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Load environment variables
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || './business.db';

// Helper function to format date as YYYY-MM-DD
function formatDate(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Security headers - Add after other middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

// Initialize SQLite Database
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('❌ Error opening database:', err.message);
    } else {
        console.log('✅ Connected to SQLite database:', DB_PATH);
    }
});

// Create tables if they don't exist
db.serialize(() => {
    // Transactions table
    db.run(`CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customerName TEXT NOT NULL,
        phoneNumber TEXT NOT NULL,
        service TEXT NOT NULL,
        amountPaid REAL NOT NULL,
        serviceBy TEXT NOT NULL,
        expenses REAL NOT NULL,
        date TEXT NOT NULL,
        timestamp TEXT NOT NULL
    )`);

    // Messages table
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        sender TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        time TEXT NOT NULL
    )`);
});

// API Routes

// Get all transactions
app.get('/api/transactions', (req, res) => {
    const { filter } = req.query;
    let query = 'SELECT * FROM transactions';
    let params = [];

    if (filter && filter !== 'all') {
        const now = new Date();
        const today = formatDate(now);
        
        switch (filter) {
            case 'day':
                query += ' WHERE date = ?';
                params.push(today);
                break;
            case 'week':
                const weekAgo = new Date(now);
                weekAgo.setDate(now.getDate() - 7);
                query += ' WHERE date >= ?';
                params.push(formatDate(weekAgo));
                break;
            case 'month':
                const monthAgo = new Date(now);
                monthAgo.setMonth(now.getMonth() - 1);
                query += ' WHERE date >= ?';
                params.push(formatDate(monthAgo));
                break;
            case 'year':
                const yearAgo = new Date(now);
                yearAgo.setFullYear(now.getFullYear() - 1);
                query += ' WHERE date >= ?';
                params.push(formatDate(yearAgo));
                break;
        }
    }

    query += ' ORDER BY timestamp DESC';

    db.all(query, params, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// Add new transaction
app.post('/api/transactions', (req, res) => {
    const { customerName, phoneNumber, service, amountPaid, serviceBy, expenses, date } = req.body;
    
    // Validation
    if (!customerName || !phoneNumber || !service || !amountPaid || !serviceBy || !date) {
        return res.status(400).json({ error: 'Required fields missing: customerName, phoneNumber, service, amountPaid, serviceBy, date' });
    }

    // Default expenses to 0 if not provided
    const finalExpenses = expenses || 0;
    const timestamp = new Date().toISOString();
    const formattedDate = formatDate(date);
    
    const stmt = db.prepare(`INSERT INTO transactions 
        (customerName, phoneNumber, service, amountPaid, serviceBy, expenses, date, timestamp) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    
    stmt.run([customerName, phoneNumber, service, amountPaid, serviceBy, finalExpenses, formattedDate, timestamp], function(err) {
        if (err) {
            console.error('Database error:', err);
            res.status(500).json({ error: err.message });
            return;
        }
        
        const newTransaction = {
            id: this.lastID,
            customerName,
            phoneNumber,
            service,
            amountPaid: parseFloat(amountPaid),
            serviceBy,
            expenses: parseFloat(finalExpenses),
            date: formattedDate,
            timestamp
        };
        
        console.log(`✅ New transaction added: ${customerName} - ${service} - ₦${amountPaid}`);
        
        res.json({ 
            id: this.lastID, 
            message: 'Transaction added successfully',
            transaction: newTransaction
        });
    });
    
    stmt.finalize();
});

// Get dashboard analytics
app.get('/api/analytics', (req, res) => {
    const { filter } = req.query;
    let query = 'SELECT * FROM transactions';
    let params = [];

    if (filter && filter !== 'all') {
        const now = new Date();
        const today = formatDate(now);
        
        switch (filter) {
            case 'day':
                query += ' WHERE date = ?';
                params.push(today);
                break;
            case 'week':
                const weekAgo = new Date(now);
                weekAgo.setDate(now.getDate() - 7);
                query += ' WHERE date >= ?';
                params.push(formatDate(weekAgo));
                break;
            case 'month':
                const monthAgo = new Date(now);
                monthAgo.setMonth(now.getMonth() - 1);
                query += ' WHERE date >= ?';
                params.push(formatDate(monthAgo));
                break;
            case 'year':
                const yearAgo = new Date(now);
                yearAgo.setFullYear(now.getFullYear() - 1);
                query += ' WHERE date >= ?';
                params.push(formatDate(yearAgo));
                break;
        }
    }

    db.all(query, params, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        const analytics = {
            totalIncome: rows.reduce((sum, t) => sum + t.amountPaid, 0),
            totalExpenses: rows.reduce((sum, t) => sum + t.expenses, 0),
            netIncome: 0,
            servicePerformance: {
                Photography: 0,
                Makeup: 0,
                'Product Sales': 0
            },
            transactionCount: rows.length
        };

        analytics.netIncome = analytics.totalIncome - analytics.totalExpenses;

        rows.forEach(transaction => {
            if (analytics.servicePerformance.hasOwnProperty(transaction.service)) {
                analytics.servicePerformance[transaction.service] += transaction.amountPaid;
            } else {
                // Add new service types dynamically
                analytics.servicePerformance[transaction.service] = transaction.amountPaid;
            }
        });

        res.json(analytics);
    });
});

// Get all messages
app.get('/api/messages', (req, res) => {
    db.all('SELECT * FROM messages ORDER BY timestamp ASC', (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// Send message
app.post('/api/messages', (req, res) => {
    const { text, sender } = req.body;
    
    if (!text || !sender) {
        return res.status(400).json({ error: 'Text and sender are required' });
    }

    const timestamp = new Date().toISOString();
    const time = new Date().toLocaleTimeString();
    
    const stmt = db.prepare('INSERT INTO messages (text, sender, timestamp, time) VALUES (?, ?, ?, ?)');
    
    stmt.run([text, sender, timestamp, time], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ 
            id: this.lastID, 
            message: 'Message sent successfully',
            messageData: {
                id: this.lastID,
                text,
                sender,
                timestamp,
                time
            }
        });
    });
    
    stmt.finalize();
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Server is running', timestamp: new Date().toISOString() });
});

// Admin endpoint to clear all data (USE WITH CAUTION!)
app.delete('/api/admin/clear-data', (req, res) => {
    const { confirmClear } = req.body;
    
    if (confirmClear !== 'YES_DELETE_ALL_DATA') {
        return res.status(400).json({ 
            error: 'Confirmation required. Send confirmClear: "YES_DELETE_ALL_DATA"' 
        });
    }

    // First backup current data before clearing
    backupDatabase();
    
    // Clear all data
    db.serialize(() => {
        db.run('DELETE FROM transactions', function(err) {
            if (err) {
                console.error('Error clearing transactions:', err);
                return res.status(500).json({ error: 'Failed to clear transactions' });
            }
            console.log(`🗑️ Cleared ${this.changes} transactions`);
        });
        
        db.run('DELETE FROM messages', function(err) {
            if (err) {
                console.error('Error clearing messages:', err);
                return res.status(500).json({ error: 'Failed to clear messages' });
            }
            console.log(`🗑️ Cleared ${this.changes} messages`);
            
            res.json({ 
                message: 'All data cleared successfully',
                cleared: {
                    transactions: true,
                    messages: true
                },
                backup: 'Data backed up before clearing',
                timestamp: new Date().toISOString()
            });
        });
    });
});

// Export data endpoint
app.get('/api/admin/export', (req, res) => {
    const { filter, format } = req.query;
    let query = 'SELECT * FROM transactions';
    let params = [];

    // Apply time filter
    if (filter && filter !== 'all') {
        const now = new Date();
        const today = formatDate(now);
        
        switch (filter) {
            case 'day':
                query += ' WHERE date = ?';
                params.push(today);
                break;
            case 'week':
                const weekAgo = new Date(now);
                weekAgo.setDate(now.getDate() - 7);
                query += ' WHERE date >= ?';
                params.push(formatDate(weekAgo));
                break;
            case 'month':
                const monthAgo = new Date(now);
                monthAgo.setMonth(now.getMonth() - 1);
                query += ' WHERE date >= ?';
                params.push(formatDate(monthAgo));
                break;
            case 'year':
                const yearAgo = new Date(now);
                yearAgo.setFullYear(now.getFullYear() - 1);
                query += ' WHERE date >= ?';
                params.push(formatDate(yearAgo));
                break;
        }
    }

    query += ' ORDER BY timestamp DESC';

    db.all(query, params, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        if (format === 'csv') {
            // Generate CSV format
            let csv = 'Date,Customer Name,Phone Number,Service,Amount Paid,Service By,Expenses,Net Profit,Timestamp\n';
            
            rows.forEach(row => {
                const netProfit = row.amountPaid - row.expenses;
                csv += `"${row.date}","${row.customerName}","${row.phoneNumber}","${row.service}","${row.amountPaid}","${row.serviceBy}","${row.expenses}","${netProfit}","${row.timestamp}"\n`;
            });

            const filename = `business_export_${filter || 'all'}_${new Date().toISOString().split('T')[0]}.csv`;
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(csv);
        } else {
            // JSON format with summary
            const summary = {
                totalTransactions: rows.length,
                totalIncome: rows.reduce((sum, t) => sum + t.amountPaid, 0),
                totalExpenses: rows.reduce((sum, t) => sum + t.expenses, 0),
                netProfit: 0,
                exportDate: new Date().toISOString(),
                filter: filter || 'all'
            };
            
            summary.netProfit = summary.totalIncome - summary.totalExpenses;

            res.json({
                summary,
                transactions: rows
            });
        }
    });
});

// Serve static files for different interfaces
app.get('/portal', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'portal.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/', (req, res) => {
    res.json({
        message: 'Business Management System API',
        endpoints: {
            portal: '/portal',
            dashboard: '/dashboard',
            api: {
                transactions: '/api/transactions',
                analytics: '/api/analytics',
                messages: '/api/messages',
                health: '/api/health'
            }
        }
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Backup database function
function backupDatabase() {
    const timestamp = new Date().toISOString().split('T')[0];
    const backupDir = process.env.DB_BACKUP_PATH || './backups';
    const backupPath = `${backupDir}/business_${timestamp}.db`;
    
    try {
        // Create backups directory if it doesn't exist
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }
        
        // Check if source database exists
        if (fs.existsSync(DB_PATH)) {
            // Copy database file
            fs.copyFileSync(DB_PATH, backupPath);
            console.log(`✅ Database backed up to ${backupPath}`);
        } else {
            console.log('⚠️ Database file not found, skipping backup');
        }
    } catch (error) {
        console.error('❌ Error backing up database:', error.message);
    }
}

// Run initial backup after 5 minutes (to ensure database is created)
setTimeout(backupDatabase, 5 * 60 * 1000);

// Run backup daily (24 hours = 24 * 60 * 60 * 1000 ms)
setInterval(backupDatabase, 24 * 60 * 60 * 1000);
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`🏢 Portal: http://localhost:${PORT}/portal`);
    console.log(`🔧 API: http://localhost:${PORT}/api`);
});

//  shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        } else {
            console.log('✅ Database connection closed');
        }
        process.exit(0);
    });
});