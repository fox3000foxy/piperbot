module.exports = {
  apps: [{
    name: "piperbot-ts",
    script: "dist/src/index.js",
    cwd: "~/huggingface-crawler/discord-bot-ts",
    interpreter: "node",
    env: {
      NODE_ENV: "production",
    },
    log_date_format: "YYYY-MM-DD HH:mm:ss",
    max_memory_restart: "500M",
  }, {
    name: "piper-api",
    script: "dist/api/server.js",
    cwd: "/home/lsannier/huggingface-crawler/discord-bot-ts",
    interpreter: "node",
    env: { NODE_ENV: "production" },
    log_date_format: "YYYY-MM-DD HH:mm:ss",
    max_memory_restart: "500M",
  }]
};
