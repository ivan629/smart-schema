# smart-schema

**Before:**
```json
[{"id": 1, "name": "Alice", "total": 99.50, "status": "shipped"}]
```

**After:**
```json
{
  "domain": "ecommerce",
  "description": "Customer order records with fulfillment tracking",
  "grain": "One order per row",
  "root": {
    "type": "object",
    "fields": {
      "id": { "type": "int", "role": "identifier", "description": "Unique order ID" },
      "name": { "type": "string", "role": "dimension", "description": "Customer name" },
      "total": { "type": "number", "role": "measure", "unit": "USD", "aggregation": "sum", "description": "Order total amount" },
      "status": { "type": "string", "role": "dimension", "description": "Fulfillment status" }
    }
  },
  "capabilities": {
    "measures": ["total"],
    "dimensions": ["name", "status"],
    "identifiers": ["id"],
    "timeFields": []
  }
}
```

**Your data stays home. The schema travels.**

```bash
npm install smart-schema
```

```typescript
import { analyze } from 'smart-schema';

const schema = await analyze(data, {
    apiKey: process.env.ANTHROPIC_API_KEY
});
```

---

## The Gap

LLMs need to understand your data. Structure isn't enough.

Traditional schemas say `total` is a number. They don't say it's revenue. Don't say it's USD. Don't say sum it.

Traditional schemas say `status` is a string. They don't say group by it.

Traditional schemas say `customer_id` exists. They don't say it points to `customers.id`.

Structure without meaning. Skeleton without muscle.

**smart-schema closes the gap:**

| What | You Get |
|------|---------|
| Structure | Types. Nesting. Nullability. Arrays. Maps. |
| Semantics | What each field means. Plain English. |
| Roles | Identifier. Measure. Dimension. Time. Text. |
| Compression | `$defs` for repeated structures. Maps with keys. |
| Entities | Detected objects with ID fields. |
| Capabilities | Measures to sum. Dimensions to group. Time fields to filter. |

Generate once. Reuse forever. Raw data never leaves.

---

## Output Format

```typescript
interface SmartSchema {
    domain: string;           // "ecommerce", "analytics", etc.
    description: string;      // What this data represents
    grain: string;            // "One order per row"
    $defs?: Record<string, TypeDef>;  // Reusable type definitions
    root: NodeDef;            // Schema tree
    capabilities: {
        measures: string[];     // Summable fields
        dimensions: string[];   // Groupable fields
        identifiers: string[];  // ID fields
        timeFields: string[];   // Date/time fields
    };
    entities?: Entity[];      // Detected entities
}
```

---

## The Use Case

You have data. You want 100 visualization ideas. Ranked by usefulness.

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { analyze } from 'smart-schema';

const schema = await analyze(salesData, {
    apiKey: process.env.ANTHROPIC_API_KEY
});

const anthropic = new Anthropic();
const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8000,
    messages: [{
        role: 'user',
        content: `Schema: ${JSON.stringify(schema)}
    
Generate 100 visualization ideas ranked by business value.`
    }]
});
```

The LLM knows `revenue` is summable. Knows `region` is groupable. Knows `created_at` is the time axis. Knows what to do without you explaining it.

No prompt engineering. No sending sample rows. No figuring out how to describe your data.

The schema already did that.

---

## Options

```typescript
await analyze(data, {
    apiKey: string,     // Required. Anthropic key.
    skipAI?: boolean,   // Default false. Structure only, no API calls.
    verbose?: boolean,  // Default false. Log progress to console.
});
```

### Shortcuts

```typescript
// No AI. Structure only. Fast.
await analyze(data, { apiKey: '', skipAI: true });

// With logging
await analyze(data, { apiKey, verbose: true });
```

---

## Errors

```typescript
try {
    const schema = await analyze(data, { apiKey });
} catch (err) {
    // Input was null, primitive, or empty
    console.error(err.message);
}
```

If AI enrichment fails, the library returns a schema with default descriptions instead of throwing.

Large datasets (many tables/fields) trigger warnings with `verbose: true` but never throw.

---

## Features

### Role Detection

Fields are automatically assigned roles based on name patterns and types:

| Role | Examples | Description |
|------|----------|-------------|
| `identifier` | `id`, `user_id`, `sku` | Unique identifiers |
| `measure` | `total`, `count`, `price` | Numeric, aggregatable |
| `dimension` | `status`, `category` | Groupable strings |
| `time` | `created_at`, `timestamp` | Date/time fields |
| `text` | `description`, `content` | Long-form text |

### Map Detection

Repeated object structures become maps:

```json
{
  "mechanisms": {
    "type": "map",
    "keys": ["fear_induction", "shame_induction", "anger_farming"],
    "values": { "$ref": "#/$defs/scored_assessment" }
  }
}
```

### $defs Extraction

Repeated shapes are extracted to `$defs`:

```json
{
  "$defs": {
    "scored_assessment": {
      "fields": {
        "score": { "type": "int", "role": "measure", "aggregation": "avg" },
        "confidence": { "type": "int", "role": "measure", "aggregation": "avg" }
      }
    }
  }
}
```

### Entity Detection

Objects with ID fields become entities:

```json
{
  "entities": [
    { "name": "Video", "idField": "request.video_id", "description": "..." }
  ]
}
```

---

## What It Doesn't Do

- No storage. Persistence is yours.
- No diffing. No versioning. Not a registry.
- No validation. Describes. Doesn't enforce.
- No offline mode. Needs Anthropic API (unless `skipAI: true`).

---

## License

MIT