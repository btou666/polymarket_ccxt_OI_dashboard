module.exports = {
  apps: [
    {
      name: "oi-web",
      script: "npm",
      args: "run start -- -p 3000",
      cwd: "/opt/polymarket_ccxt_OI_dashboard",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
      max_restarts: 10,
      restart_delay: 3000,
    },
    {
      name: "oi-collector",
      script: "npm",
      args: "run collect:loop",
      cwd: "/opt/polymarket_ccxt_OI_dashboard",
      env: {
        NODE_ENV: "production",
      },
      max_restarts: 10,
      restart_delay: 3000,
    },
  ],
};
