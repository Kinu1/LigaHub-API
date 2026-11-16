export function validateTestDatabaseUrl(value: string | undefined): string;
export function testDatabaseEnvironment(environment?: NodeJS.ProcessEnv): {
  DATABASE_URL: string;
  DIRECT_URL: string;
};
