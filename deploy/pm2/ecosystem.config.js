const path = require('node:path');

module.exports = {
  apps: [{
    name: 'youtube-music-player',
    cwd: path.resolve(__dirname, '../..'),
    script: 'server/src/index.js',
    interpreter: process.execPath,
    exec_mode: 'fork',
    instances: 1,
    watch: false,
    autorestart: true,
    restart_delay: 5000,
    // Let an in-flight CSV transaction finish before a forced shutdown.
    kill_timeout: 600000,
    time: true,
    // The application reads HOST, PORT, TRUST_PROXY and DB credentials from .env.
    env: { NODE_ENV: 'production' },
  }],
};
