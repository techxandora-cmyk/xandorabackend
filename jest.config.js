module.exports = {
  testEnvironment: 'node',
  verbose: true,
  testMatch: ['**/src/tests/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '/rfid-dashboard/e2e/'],
};
