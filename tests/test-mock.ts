import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function test(): Promise<void> {
    if (!process.env.ANTHROPIC_API_KEY) {
        console.error('ANTHROPIC_API_KEY not set');
        process.exit(1);
    }

    const mockPath = join(__dirname, '..', 'mock', 'mock.json');
    const data: unknown = JSON.parse(readFileSync(mockPath, 'utf-8'));

    try {
        const schema = await generate(data, {
            apiKey: process.env.ANTHROPIC_API_KEY,
            verbose: true
        });

        const outputPath = join(__dirname, '..', 'mock', 'schema-output.json');
        writeFileSync(outputPath, JSON.stringify(schema, null, 2));
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(message);
        process.exit(1);
    }
}

test();