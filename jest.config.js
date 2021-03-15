/* eslint-disable no-undef */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { defaultMapper } = require("@effect-ts/jest/Modules")

// eslint-disable-next-line
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "./",
  clearMocks: true,
  collectCoverage: false,
  coverageDirectory: "coverage",
  collectCoverageFrom: ["packages/**/src/**/*.ts"],
  setupFiles: ["./scripts/jest-setup.ts"],
  modulePathIgnorePatterns: [
    "<rootDir>/packages/.*/build",
    "<rootDir>/packages/.*/compiler-debug",
    "<rootDir>/_tmp"
  ],
  verbose: true,
  moduleNameMapper: {
    ...defaultMapper,
    "@effect-ts/query/(.*)$": "<rootDir>/packages/query/build/_traced/$1",
    "@effect-ts/query$": "<rootDir>/packages/query/build/_traced"
  },
  globals: {
    "ts-jest": {
      tsconfig: "<rootDir>/tsconfig.jest.json",
      compiler: "ttypescript"
    }
  }
}
