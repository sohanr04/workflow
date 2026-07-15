#!/bin/bash
# Grand Empire gateway — watchdog wrapper.
# launchd (KeepAlive) relaunches this the instant it exits, so a restart
# never depends on Sohan being at the terminal again.
export PATH="/Users/sohanramchandani/.nvm/versions/node/v22.22.0/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export HOME="/Users/sohanramchandani"
cd /Users/sohanramchandani/workflow/assistant || exit 1
exec node whatsapp.js sohan
