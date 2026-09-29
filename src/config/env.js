const REQUIRED_ENV_VARS = [
  "OPENAI_API_KEY",
  "DATABASE_URL",
];

function validateEnv(env = process.env) {
  const missing = REQUIRED_ENV_VARS.filter((key) => !env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }
}

module.exports = {
  validateEnv,
};
