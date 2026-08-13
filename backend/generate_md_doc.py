import json

with open('d:/JOD-Events/backend/schema_dump.json') as f:
    data = json.load(f)

md = []
md.append("# JOD Events Platform — Complete Database Dictionary & Schema Documentation\n")
md.append("This document provides an exhaustive, field-by-field dictionary for all tables in the PostgreSQL database (`jod_events`). It includes column names, data types, constraints (Primary Key, Foreign Key, Nullability, Defaults), and table purposes.\n")
md.append("---")
md.append("\n## Table Index\n")

for tname in sorted(data.keys()):
    info = data[tname]
    md.append(f"- [{tname}](#{tname.replace('_', '-')}) — `{info['row_count']} rows`, PK: `{', '.join(info['pks']) if info['pks'] else 'None'}`")

md.append("\n---\n")

for tname in sorted(data.keys()):
    info = data[tname]
    md.append(f"## {tname}\n")
    md.append(f"**Total Records:** `{info['row_count']}`  ")
    md.append(f"**Primary Key:** `{', '.join(info['pks']) if info['pks'] else 'None'}`  ")
    
    if info['fks']:
        md.append("**Foreign Keys:**")
        for fk in info['fks']:
            md.append(f"- `{fk['col']}` &rarr; `{fk['target_table']}.{fk['target_col']}`")
        md.append("")
    else:
        md.append("**Foreign Keys:** `None`  ")
        md.append("")

    md.append("| Column Name | Data Type | Nullable | Primary Key | Foreign Key / Constraint | Default Value |")
    md.append("|---|---|---|---|---|---|")

    # Map FKs by column name
    fk_by_col = {fk['col']: f"{fk['target_table']}.{fk['target_col']}" for fk in info['fks']}

    for col in info['columns']:
        cname = col['name']
        ctype = col['type']
        nullable = "YES" if col['nullable'] == "YES" else "**NO**"
        is_pk = "**YES [PK]**" if cname in info['pks'] else "No"
        fk_str = f"`FK -> {fk_by_col[cname]}`" if cname in fk_by_col else "-"
        default_str = f"`{col['default']}`" if col['default'] is not None else "-"
        
        md.append(f"| `{cname}` | `{ctype}` | {nullable} | {is_pk} | {fk_str} | {default_str} |")
    
    md.append("\n---\n")

with open('C:/Users/krithish.B.R/.gemini/antigravity-ide/brain/aaa65823-44c5-46be-866b-d48d786fabc8/database_dictionary.md', 'w', encoding='utf-8') as f:
    f.write("\n".join(md))

print("Created database_dictionary.md successfully!")
