import catalogue from '../backend/prisma/seed-data/catalogue.json';
import { getDoProfile } from '../backend/src/analytics/do2026/profiles';

process.stdout.write(JSON.stringify({ ...catalogue, indicators: catalogue.indicators.map(indicator => ({ ...indicator, do2026: getDoProfile(indicator.id) })) }));
