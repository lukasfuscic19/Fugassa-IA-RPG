// dbEngine.js

const mysql = require('mysql');

// Create a connection to the database
const connection = mysql.createConnection({
    host: 'localhost',
    user: 'user',
    password: 'password',
    database: 'database_name'
});

// Function to validate table names
function validateTableName(tableName) {
    const validTableNames = ['users', 'products', 'orders']; // Example list of valid tables
    return validTableNames.includes(tableName);
}

// Function to prevent SQL injection
function executeQuery(tableName, columns) {
    if (!validateTableName(tableName)) {
        console.error(`Invalid table name: ${tableName}`);
        return;
    }

    if (!Array.isArray(columns) || columns.length === 0) {
        console.error('Column names must be provided and cannot be null.');
        return;
    }

    const columnList = columns.join(', ');
    const query = `SELECT ${columnList} FROM ${connection.escapeId(tableName)}`;
    connection.query(query, (error, results) => {
        if (error) {
            console.error('Error executing query:', error);
            return;
        }
        console.log('Query results:', results);
    });
}

module.exports = { executeQuery };