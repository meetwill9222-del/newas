module.exports = {
  apps: [
    {
      name: "pupp",
      script: "./index.js",
      watch: false,            // optional
      cron_restart: "*/20 * * * *",   // every 45 minutes
      // ensure logs go to stdout/stderr
      output: "/dev/stdout",
      error: "/dev/stderr",
      // no-daemon mode if used in container / Railway
      // daemon off is not in ecosystem file, but you can control behavior via CLI flags
    }
  ]
};
