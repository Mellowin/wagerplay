module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: '.e2e-spec.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  // E2E тесты запускаем последовательно (важно для race-условий)
  maxWorkers: 1,
  // Таймаут для E2E тестов (60 сек - нужно время для инициализации БД)
  testTimeout: 60000,
  // Setup после загрузки окружения для каждого файла
  setupFilesAfterEnv: ['./test/e2e/setup-after-env.ts'],
  // Модульные пути
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
