#!/bin/bash
set -e          # Stop immediately if a command fails
set -o pipefail # Catch errors in piped commands

# --- CONFIGURATION (UPDATED FROM YOUR DETAILS) ---
CLOUD_USER="howe.wang.2023" 
CLOUD_IP="136.119.247.157"
CLOUD_PORT="22"
SSH_KEY_PATH="~/.ssh/runpod_ed25519"
# ------------------------------------

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Construct the identity flag if a key path is provided
if [ -n "$SSH_KEY_PATH" ]; then
    ID_FLAG="-i $SSH_KEY_PATH"
else
    ID_FLAG=""
fi

# SSH options to handle ephemeral cloud GPU pods (skips host key verification errors)
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

# Copy requirements.txt to cloud
scp $SSH_OPTS $ID_FLAG -P $CLOUD_PORT requirements.txt $CLOUD_USER@$CLOUD_IP:$CLOUD_REPO_PATH/backend/retraining-pipeline/

# Install requirements
ssh $SSH_OPTS $ID_FLAG -p $CLOUD_PORT $CLOUD_USER@$CLOUD_IP << EOF
    set -e
    
    ### Install pip if missing
    # if ! command -v pip &> /dev/null; then
    #     echo "pip not found. Installing..."
    #     sudo apt update && sudo apt install -y pip
    # fi

    ### Install requirements
    echo "Installing requirements"
    sudo pip install -r requirements.txt
EOF

