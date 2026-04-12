import { collectOpenInterest } from "../lib/collector.js";

const intervalMs = Math.max(30_000, Number(process.env.COLLECT_INTERVAL_MS || 60_000));

async function tick() {
  const started = Date.now();
  const result = await collectOpenInterest();
  const spent = Date.now() - started;
  const timestamp = new Date().toISOString();
  console.log(
    `[${timestamp}] symbols=${result.symbols} collected=${result.collected} failed=${result.failed} cost=${spent}ms`,
  );
}

async function run() {
  await tick();
  setInterval(() => {
    tick().catch((err) => {
      console.error(`[${new Date().toISOString()}] collect failed`, err);
    });
  }, intervalMs);
}

run().catch((err) => {
  console.error("collector bootstrap failed", err);
  process.exit(1);
});
