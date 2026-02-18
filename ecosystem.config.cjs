/**
 * PM2 Ecosystem Configuration
 * 
 * Start with: pm2 start ecosystem.config.cjs
 * 
 * Features:
 * - Auto-restart on crash with exponential backoff
 * - Crash loop protection (max 10 restarts)
 * - Memory limit restart (200MB)
 * - Log management
 */

module.exports = {
  apps: [{
    name: 'oyster-bot',
    script: 'caffeinate',
    args: '-i node src/app.js',
    cwd: __dirname,               // Resolve relative paths (.env, plugins, logs) from repo root
    
    // Crash loop protection
    max_restarts: 10,              // Max restarts before giving up
    min_uptime: 5000,              // Must run 5s to count as "started"
    restart_delay: 4000,           // Wait 4s between restart attempts
    exp_backoff_restart_delay: 100, // Exponential backoff: 100ms -> 200ms -> 400ms...
    
    // Auto restart settings
    autorestart: true,
    watch: false,                  // Don't watch files (we use hot reload instead)
    
    // Memory safety
    max_memory_restart: '200M',
    
    // Environment
    env: {
      NODE_ENV: 'production',
    },
    
    // Logging
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    merge_logs: true,
    time: true,                    // Add timestamps to logs
  }]
};
