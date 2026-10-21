import sqlite3
import sys

try:
    with open("schema.sql", "r", encoding="utf-8") as f:
        sql = f.read()

    conn = sqlite3.connect("temp.db")
    conn.executescript(sql)
    conn.commit()
    conn.close()
    print("Successfully created temp.db")
except Exception as e:
    print("Error:", e)
    sys.exit(1)
