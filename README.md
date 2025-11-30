**Before:**
```json
[{"id": 1, "name": "Alice", "total": 99.50, "status": "shipped"}]
```

**After:**
```typescript
{
  tables: {
    root: {
      fields: [
        { path: "id", role: "identifier", description: "Unique record ID" },
        { path: "name", role: "text", description: "Customer name", pii: "name" },
        { path: "total", role: "measure", unit: "USD", aggregation: "sum" },
        { path: "status", role: "dimension", description: "Fulfillment status" }
      ],
      capabilities: {
        measures: ["total"],
        dimensions: ["status"],
        searchable: ["name"]
      }
    }
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
| Structure | Types. Nesting. Nullability. Arrays. |
| Semantics | What each field means. Plain English. |
| Roles | Identifier. Measure. Dimension. Timestamp. |
| Relationships | Foreign keys. Table connections. |
| Entities | Customers. Orders. Products. Real objects. |
| Capabilities | Sum this. Group that. Search here. Time-series there. |

Generate once. Reuse forever. Raw data never leaves.

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

## Input

| Shape | Result |
|-------|--------|
| `[{...}, {...}]` | `tables.root` |
| `{"users": [...], "orders": [...]}` | `tables.users`, `tables.orders` |
| `{...}` | `tables.root`, one row |
| `[1, 2, 3]` | `tables.root`, synthetic `value` field |
| Primitives | `InvalidInputError` |
| Empty | `InvalidInputError` |

---

## Options

```typescript
await analyze(data, {
    apiKey: string,              // Required. Anthropic key.

    maxRows?: number,            // Default 10000. Rows sampled per table.
    maxDepth?: number,           // Default 50. Nesting depth before truncation.

    skipAI?: boolean,            // Default false. Structure only. No API calls.
    model?: string,              // Default 'claude-sonnet-4-5-20250929'.
    timeout?: number,            // Default 300000. Five minutes.

    formatThreshold?: number,    // Default 0.9. 90% match for email/uuid/etc.
    mixedTypeThreshold?: number, // Default 0.1. 10% secondary type flags 'mixed'.

    logger?: Logger,             // Default silent. consoleLogger for noise.
});
```

### Shortcuts

```typescript
// No AI. Structure only.
await analyze(data, { apiKey: '', skipAI: true });

// Fast. Small sample.
await analyze(data, { apiKey, maxRows: 1000, timeout: 30_000 });

// Strict format detection.
await analyze(data, { apiKey, formatThreshold: 0.95 });

// Debug.
import { consoleLogger } from 'smart-schema';
await analyze(data, { apiKey, logger: consoleLogger });
```

---

## Limits

| Constraint | Value | Consequence |
|------------|-------|-------------|
| Tables | 20 | `LimitExceededError` |
| Fields total | 500 | `LimitExceededError` |
| Rows per table | 10,000 | Sampled |
| Nesting depth | 50 | Truncated |

Wide datasets fail. Tall datasets get sampled. Deep datasets get flattened.

---

## Errors

```typescript
import {
    InvalidInputError,
    AIEnrichmentError,
    LimitExceededError
} from 'smart-schema';

try {
    const schema = await analyze(data, { apiKey });
} catch (err) {
    if (err instanceof InvalidInputError) {
        // Primitive or empty.
        err.reason; // 'primitive' | 'empty'
    }
    if (err instanceof AIEnrichmentError) {
        // AI failed. Partial schema available.
        err.partialSchema;
    }
    if (err instanceof LimitExceededError) {
        // Too many tables or fields.
    }
}
```

---

## What It Doesn't Do

No storage. Persistence is yours.

No diffing. No versioning. Not a registry.

No validation. Describes. Doesn't enforce.

No offline. Needs Anthropic API.

---

## License

MIT