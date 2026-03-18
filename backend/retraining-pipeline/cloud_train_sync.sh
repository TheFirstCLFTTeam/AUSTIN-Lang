#!/bin/bash
set -e          # Stop immediately if a command fails
set -o pipefail # Catch errors in piped commands

# --- CONFIGURATION (UPDATED FROM YOUR DETAILS) ---
CLOUD_USER="root" 
CLOUD_IP="157.157.221.29" 
CLOUD_PORT="32255"
SSH_KEY_PATH="~/.ssh/runpod_ed25519"
CLOUD_REPO_PATH="~/AUSTIN-Lang" 
MANIFEST_NAME="manifest.jsonl" 
ADAPTER_NAME="cloud_meralion_v1"
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

echo -e "${GREEN}Step 1: Preparing data on local server...${NC}"
# Navigate to the directory where the script is located
cd "$(dirname "$0")"
# Build dataset from audio files and edited transcripts
python3 dataset_builder.py

echo -e "${GREEN}Step 2: Packaging entire retraining pipeline (excluding adapters)...${NC}"
tar --exclude='adapters' --exclude='training_data.tar.gz' -czf training_data.tar.gz .

echo -e "${GREEN}Step 3: Uploading pipeline to Cloud GPU ($CLOUD_IP:$CLOUD_PORT)...${NC}"
ssh $SSH_OPTS $ID_FLAG -p $CLOUD_PORT $CLOUD_USER@$CLOUD_IP "mkdir -p $CLOUD_REPO_PATH/backend/retraining-pipeline"
scp $SSH_OPTS $ID_FLAG -P $CLOUD_PORT training_data.tar.gz $CLOUD_USER@$CLOUD_IP:$CLOUD_REPO_PATH/backend/retraining-pipeline/

echo -e "${GREEN}Step 4: Starting Remote Training...${NC}"
ssh $SSH_OPTS $ID_FLAG -p $CLOUD_PORT $CLOUD_USER@$CLOUD_IP << EOF
    set -e
    cd $CLOUD_REPO_PATH/backend/retraining-pipeline
    tar --no-same-owner -xzf training_data.tar.gz
    
    # Install dependencies on the fresh pod
    pip3 uninstall -y torchvision || true
    pip3 install --upgrade --no-cache-dir torch transformers accelerate bitsandbytes peft
    pip install -r requirements.txt
    
    # Run training with environment variables
    export MANIFEST_PATH="data/$MANIFEST_NAME"
    export OUTPUT_DIR="adapters/$ADAPTER_NAME"
    python3 train.py

    rm training_data.tar.gz
EOF

echo -e "${GREEN}Step 5: Downloading trained adapters...${NC}"
mkdir -p adapters/
scp $SSH_OPTS $ID_FLAG -P $CLOUD_PORT -r $CLOUD_USER@$CLOUD_IP:$CLOUD_REPO_PATH/backend/retraining-pipeline/adapters/$ADAPTER_NAME ./adapters/

echo -e "${GREEN}COMPLETE! Adapter saved to: backend/retraining-pipeline/adapters/$ADAPTER_NAME${NC}"
