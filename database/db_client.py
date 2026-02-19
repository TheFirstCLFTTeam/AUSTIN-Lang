"""
Database Client Usage Guide:

1. Initialization:

client = DatabaseClient(db_path='database/poc.db', schema_path='database/schema.sql')

2. Insert Data:

file_id = client.execute_query(
    "INSERT INTO audio_file (file_path) VALUES (?)", 
    ("audio_files/example.wav",)
)

3. Fetch Multiple Rows:
- Include conditions if needed

files = client.fetch_all("SELECT * FROM audio_file")
for file in files:
    print(file['file_path'])

4. Fetch a Single Row:

file = client.fetch_one("SELECT * FROM audio_file WHERE id = ?", (file_id,))
if file:
    print(file['uploaded_at'])

5. Update/Delete Data:

client.execute_query(
    "UPDATE audio_file SET file_path = ? WHERE id = ?", 
    ("new/path.wav", file_id)
)
"""

import sqlite3
import os

class DatabaseClient:
    """
    Client to interact with the SQLite database.
    Handles initialization from schema.sql if the database file is missing.
    """
    def __init__(self, db_path='./poc.db', schema_path='./schema.sql'):
        self.db_path = db_path
        self.schema_path = schema_path
        self._initialize_db()

    def _initialize_db(self):
        """Initializes the database if it doesn't exist."""
        if not os.path.exists(self.db_path):
            print(f"Database not found at {self.db_path}. Initializing...")
            conn = None
            try:
                conn = sqlite3.connect(self.db_path)
                with open(self.schema_path, 'r') as f:
                    conn.executescript(f.read())
                conn.commit()
                print("Database initialized successfully.")
            except Exception as e:
                print(f"Error initializing database: {e}")
                if conn:
                    conn.close()
                # If initialization fails, remove the partial db file if it was created
                if os.path.exists(self.db_path):
                    os.remove(self.db_path)
                raise
            finally:
                if conn:
                    conn.close()

    def get_connection(self):
        """Returns a connection object with Row factory enabled."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def execute_query(self, query, params=()):
        """
        Executes a write query (INSERT, UPDATE, DELETE).
        Example Usage:
        file_id = client.execute_query(
            "INSERT INTO audio_file (file_name) VALUES (?)", 
            ("example.wav",)
        )
        """
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(query, params)
            conn.commit()
            return cursor.lastrowid
        finally:
            conn.close()

    def fetch_all(self, query, params=()):
        """Fetches all results for a query."""
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(query, params)
            return [dict(row) for row in cursor.fetchall()]
        finally:
            conn.close()

    def fetch_one(self, query, params=()):
        """Fetches a single result for a query."""
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(query, params)
            row = cursor.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

if __name__ == "__main__":
    # Quick manual check
    client = DatabaseClient()
    print("Database client ready.")
