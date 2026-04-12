module.exports = {
  apps: [
    {
      name: "oi-web",
      script: "node_modules/next/dist/bin/next",
      args: "start -H 0.0.0.0 -p 3000",
      cwd: "/opt/polymarket_ccxt_OI_dashboard",
      interpreter: "node",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
      max_restarts: 10,
      restart_delay: 3000,
    },
    {
      name: "oi-collector",
      script: "scripts/collect-loop.mjs",
      cwd: "/opt/polymarket_ccxt_OI_dashboard",
      interpreter: "node",
      env: {
        NODE_ENV: "production",
      },
      max_restarts: 10,
      restart_delay: 3000,
    },
  ],
};
