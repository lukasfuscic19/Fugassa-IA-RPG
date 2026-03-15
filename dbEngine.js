function getColumns(tableName) {
  // Validate input to prevent SQL injection
  const safeTableName = tableName.replace(/[^a-zA-Z0-9_]/g, '');

  // Use the validated table name in the query
  const query = `PRAGMA table_info(${safeTableName})`;
  return executeQuery(query);
}