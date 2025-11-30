import type { StatsMultiTableSchema } from './types.js';
import type { ValidatedFieldsResponse } from './validation.js';

export interface TableSummary {
    readonly table: string;
    readonly identifiers: readonly string[];
    readonly references: readonly string[];
    readonly allFields: readonly string[];
}

export function buildFieldEnrichmentPrompt(stats: StatsMultiTableSchema): string {
    return `Analyze dataset fields and provide semantic enrichment.

<rules>
- Return field paths EXACTLY as provided. Never modify or unescape.
- Paths like "sepal\\.length" must stay as "sepal\\.length".
- Base analysis on field names, types, and example values.
- When uncertain: role="dimension" for strings, role="measure" for numbers.
</rules>

<input>
${JSON.stringify(stats.tables, null, 2)}
</input>

<schema>
role (required):
- "identifier" — Unique ID (uuid, auto-increment, *_id with unique values)
- "reference" — Foreign key to another entity
- "dimension" — Categorical for grouping (status, type, category)
- "measure" — Numeric for aggregation (price, quantity, length)
- "time" — Timestamps, dates
- "text" — Free-form searchable text (name, description)
- "metadata" — Arrays, nested objects

description (required):
- What this field represents in business/domain terms
- Must be meaningful, not just restating the field name

pii (required):
- "email", "phone", "name", "address", "ssn", "credit_card", "ip_address", "other"
- false — if not personal data

unit (required, null if not applicable):
- Currency: "USD", "EUR", "GBP", "cents"
- Length: "cm", "mm", "m", "in", "ft"
- Weight: "kg", "g", "lbs", "oz"
- Time: "seconds", "minutes", "hours", "days"
- Other: "percent", "celsius", "fahrenheit"
- null — if no unit applies

aggregation (required):
- "sum" — Totals: money, quantities, counts
- "avg" — Averages: measurements, scores, rates
- "min" / "max" — Ranges
- "count" — Counting occurrences
- "none" — Not aggregatable: text, identifiers, categories
</schema>

<example_input>
{
  "root": {
    "fields": [
      {"path": "sepal\\.width", "type": "number", "nullable": false, "examples": [3.5, 3.0, 2.9]},
      {"path": "variety", "type": "string", "nullable": false, "examples": ["Setosa", "Virginica"]}
    ]
  }
}
</example_input>

<example_output>
{
  "tables": {
    "root": {
      "sepal\\.width": {
        "role": "measure",
        "description": "Width measurement of the flower sepal, used for species classification",
        "pii": false,
        "unit": "cm",
        "aggregation": "avg"
      },
      "variety": {
        "role": "dimension",
        "description": "Species classification of the iris flower specimen",
        "pii": false,
        "unit": null,
        "aggregation": "none"
      }
    }
  }
}
</example_output>

<wrong>
- "sepal.width" instead of "sepal\\.width" ← Path must stay escaped
- "description": "A number" ← Too vague
- "description": "sepal.width" ← Just restating the name
- "unit": "numeric" ← Not a real unit
- "aggregation": "sum" for width/height/length ← Use "avg" for measurements
</wrong>

<output_format>
{
  "tables": {
    "tableName": {
      "exactFieldPath": {
        "role": "...",
        "description": "...",
        "pii": false,
        "unit": null,
        "aggregation": "..."
      }
    }
  }
}

Return ONLY valid JSON. Include every field.
</output_format>`;
}

export function buildRelationshipPrompt(tableSummaries: readonly TableSummary[]): string {
    return `Detect foreign key relationships between tables.

<rules>
- Use EXACT field paths as provided. Never modify or unescape.
- Only include relationships with confidence >= 0.6.
- Format: "tableName.fieldPath" for both from and to.
</rules>

<input>
${JSON.stringify(tableSummaries, null, 2)}
</input>

<schema>
type:
- "one-to-one" — Each A has exactly one B
- "one-to-many" — One A has many B
- "many-to-one" — Many A belong to one B
- "many-to-many" — Many A to many B

confidence:
- 0.9-1.0: Exact match (customer_id → customers.id)
- 0.7-0.8: Strong pattern (user_id → users.id)
- 0.6: Reasonable inference
- Below 0.6: Do not include
</schema>

<example_input>
[
  {"table": "orders", "identifiers": ["id"], "references": ["customer_id"], "allFields": ["id", "customer_id", "total"]},
  {"table": "customers", "identifiers": ["id"], "references": [], "allFields": ["id", "name", "email"]}
]
</example_input>

<example_output>
{
  "relationships": [
    {
      "from": "orders.customer_id",
      "to": "customers.id",
      "type": "many-to-one",
      "confidence": 0.95,
      "description": "Each order belongs to one customer"
    }
  ]
}
</example_output>

<wrong>
- "from": "customer_id" ← Missing table name
- "from": "orders.customer\\_id" ← Don't add escapes that weren't there
- Including relationships with confidence below 0.6
- Guessing relationships with no evidence
</wrong>

<output_format>
{
  "relationships": [...]
}

Return ONLY valid JSON.
If no relationships found, return {"relationships": []}.
</output_format>`;
}

export function buildDomainPrompt(
    stats: StatsMultiTableSchema,
    fields: ValidatedFieldsResponse
): string {
    const tableViews = Object.entries(stats.tables).map(([tableName, table]) => ({
        name: tableName,
        fieldCount: table.fields.length,
        fields: table.fields.map((field) => ({
            path: field.path,
            type: field.type,
            role: fields.tables[tableName]?.[field.path]?.role ?? 'unknown',
        })),
    }));

    return `Synthesize domain, entities, and capabilities from analyzed fields.

<rules>
- Use EXACT field paths. Never modify, unescape, or add prefixes.
- Entity fields are paths only, not "tableName.fieldPath".
- Capabilities use exact field paths as they appear in input.
</rules>

<input>
<tables>
${JSON.stringify(tableViews, null, 2)}
</tables>

<field_details>
${JSON.stringify(fields.tables, null, 2)}
</field_details>
</input>

<schema>
domain (required):
ecommerce, healthcare, finance, hr, crm, logistics, education, social, analytics, iot, scientific, other

entity structure:
- name: Singular noun (customer, order, specimen)
- description: What this real-world object represents
- idField: Field path for unique identifier, or null
- nameField: Field path for display name, or null
- fields: Array of ALL field paths (exact, no table prefix)
- table: Table name containing this entity

capabilities structure:
- timeSeries: Time field path for trends, or null
- measures: Field paths for aggregation (role=measure)
- dimensions: Field paths for grouping (role=dimension)
- searchable: Field paths for text search (role=text)
</schema>

<example_input>
[{"name": "root", "fields": [
  {"path": "sepal\\.length", "type": "number", "role": "measure"},
  {"path": "variety", "type": "string", "role": "dimension"}
]}]
</example_input>

<example_output>
{
  "domain": "scientific",
  "description": "Botanical measurements of iris flower specimens for species classification",
  "entities": [
    {
      "name": "specimen",
      "description": "Individual iris flower measurement record",
      "idField": null,
      "nameField": "variety",
      "fields": ["sepal\\.length", "variety"],
      "table": "root"
    }
  ],
  "tables": {
    "root": {
      "description": "Iris flower morphological measurements",
      "dataGrain": "one row per flower specimen",
      "capabilities": {
        "timeSeries": null,
        "measures": ["sepal\\.length"],
        "dimensions": ["variety"],
        "searchable": []
      }
    }
  }
}
</example_output>

<wrong>
- "fields": ["root.sepal\\.length"] ← No table prefix
- "measures": ["sepal.length"] ← Must preserve escaping
- "idField": "root.id" ← No table prefix
- "domain": "data" ← Too vague, pick from options
</wrong>

<output_format>
{
  "domain": "...",
  "description": "...",
  "entities": [...],
  "tables": {...}
}

Return ONLY valid JSON.
</output_format>`;
}
