import { config } from 'dotenv';

// Load test environment variables
config({ path: '.env.test' });

// Set test timeout
jest.setTimeout(10000);

// Global test setup
beforeAll(async () => {
  // Add any global setup here (e.g., database connection)
});

// Global test teardown
afterAll(async () => {
  // Add any global cleanup here (e.g., close database connection)
}); 