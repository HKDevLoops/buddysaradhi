import re

def parse_schema():
    with open("prisma/schema.prisma", "r") as f:
        content = f.read()

    models = {}
    current_model = None

    for line in content.split("\n"):
        line = line.strip()
        if line.startswith("model "):
            current_model = line.split(" ")[1]
            models[current_model] = []
        elif line.startswith("}"):
            current_model = None
        elif current_model and line and not line.startswith("@@"):
            parts = [p for p in line.split(" ") if p]
            if len(parts) >= 2:
                name = parts[0]
                type_info = parts[1]
                
                # skip relations
                if type_info.startswith(current_model) or type_info.startswith(current_model + "[]") or "@relation" in line:
                    continue
                # skip lists
                if type_info.endswith("[]"):
                    continue
                    
                is_optional = type_info.endswith("?")
                base_type = type_info.replace("?", "")
                
                zod_type = "z.any()"
                if base_type == "String":
                    zod_type = "z.string()"
                elif base_type == "Int":
                    zod_type = "z.number().int()"
                elif base_type == "DateTime":
                    zod_type = "z.string().datetime()"
                
                if "@id" in line:
                    zod_type = "z.string().uuid()"
                elif name.endswith("Id"):
                    zod_type = "z.string().uuid()"
                
                models[current_model].append({
                    "name": name,
                    "zod_type": zod_type,
                    "optional": is_optional,
                    "nullable": is_optional
                })

    with open("packages/shared/src/schemas/models.ts", "w") as f:
        f.write('import { z } from "zod";\n\n')
        for model_name, fields in models.items():
            f.write(f"export const {model_name}Schema = z.object({{\n")
            for field in fields:
                z_type = field["zod_type"]
                if field["optional"]:
                    z_type += ".optional().nullable()"
                f.write(f"  {field['name']}: {z_type},\n")
            f.write("});\n\n")
            f.write(f"export type {model_name} = z.infer<typeof {model_name}Schema>;\n\n")

if __name__ == "__main__":
    parse_schema()
    print("Generated models.ts")
