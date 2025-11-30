import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AIEnrichmentError, AIValidationError, analyze } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function test(): Promise<void> {
    if (!process.env.ANTHROPIC_API_KEY) {
        console.error('ANTHROPIC_API_KEY not set');
        process.exit(1);
    }

    const mockPath = join(__dirname, '..', 'mock', 'mock.json');
    const data: unknown = JSON.parse(readFileSync(mockPath, 'utf-8'));

    try {
        const schema = await analyze(data, {
            apiKey: process.env.ANTHROPIC_API_KEY,
        });

        const outputPath = join(__dirname, '..', 'mock', 'schema-output.json');
        writeFileSync(outputPath, JSON.stringify(schema, null, 2));
    } catch (err: unknown) {
        if (err instanceof AIEnrichmentError) {
            console.error(err.message);
            if (err.cause instanceof AIValidationError) {
                console.error(err.cause.validationErrors);
            }
        } else if (err instanceof AIValidationError) {
            console.error(err.validationErrors);
        } else if (err instanceof Error) {
            console.error(err.message);
        }
        process.exit(1);
    }
}

test();
