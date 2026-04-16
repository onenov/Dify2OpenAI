module.exports = {
  apps: [{
    name: "dify2openai",
    script: "app.js",
    instances: "max",
    exec_mode: "cluster",
    autorestart: true,
    watch: false,
    env: {
      NODE_ENV: "production",
      PORT: 3099,
    },
  }],
};
