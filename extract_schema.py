import re

with open("11_Data_Model.md", "r", encoding="utf-8") as f:
    content = f.read()

# Find all sql code blocks
sql_blocks = re.findall(r"```sql\n(.*?)\n```", content, re.DOTALL)

with open("schema.sql", "w", encoding="utf-8") as f:
    for block in sql_blocks:
        f.write(block + "\n\n")

print(f"Extracted {len(sql_blocks)} SQL blocks.")
