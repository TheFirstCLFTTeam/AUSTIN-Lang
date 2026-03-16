#!/bin/bash

# --- CONFIGURATION (UPDATED FROM YOUR DETAILS) ---
CLOUD_USER="root" 
CLOUD_IP="157.157.221.29" 
CLOUD_PORT="32229"
SSH_KEY_PATH="~/.ssh/runpod_ed25519"
CLOUD_REPO_PATH="~/AUSTIN-Lang" 
MANIFEST_NAME="meralion_manifest.jsonl"
ADAPTER_NAME="meralion_v1" 
# ------------------------------------

# Colors for output
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Construct the identity flag if a key path is provided
if [ -n "$SSH_KEY_PATH" ]; then
    ID_FLAG="-i $SSH_KEY_PATH"
else
    ID_FLAG=""
fi

echo -e "${GREEN}Step 1: Preparing data on local server...${NC}"
# Navigate to the directory where the script is located
cd "$(dirname "$0")"
# Build dataset from audio files and edited transcripts
python3 dataset_builder.py

echo -e "${GREEN}Step 2: Packaging entire retraining pipeline (excluding adapters)...${NC}"
# Package everything in the retraining-pipeline directory except the adapters and the tarball itself
tar --exclude='adapters' --exclude='training_data.tar.gz' -czf training_data.tar.gz .

echo -e "${GREEN}Step 3: Uploading pipeline to Cloud GPU ($CLOUD_IP:$CLOUD_PORT)...${NC}"
# Ensure the directory exists on the cloud before uploading
ssh $ID_FLAG -p $CLOUD_PORT $CLOUD_USER@$CLOUD_IP "mkdir -p $CLOUD_REPO_PATH/backend/retraining-pipeline"
scp $ID_FLAG -P $CLOUD_PORT training_data.tar.gz $CLOUD_USER@$CLOUD_IP:$CLOUD_REPO_PATH/backend/retraining-pipeline/

echo -e "${GREEN}Step 4: Starting Remote Training...${NC}"
ssh $ID_FLAG -p $CLOUD_PORT $CLOUD_USER@$CLOUD_IP << EOF
    cd $CLOUD_REPO_PATH/backend/retraining-pipeline
    tar -xzf training_data.tar.gz
    
    # Install dependencies on the fresh pod
    pip install -r requirements.txt
    
    # Run training with environment variables
    export MANIFEST_PATH="data/$MANIFEST_NAME"
    export OUTPUT_DIR="adapters/$ADAPTER_NAME"
    python3 train.py

    # Clean up tarball on cloud
    rm training_data.tar.gz
EOF

echo -e "${GREEN}Step 5: Downloading trained adapters...${NC}"
mkdir -p adapters/
scp $ID_FLAG -P $CLOUD_PORT -r $CLOUD_USER@$CLOUD_IP:$CLOUD_REPO_PATH/backend/retraining-pipeline/adapters/$ADAPTER_NAME ./adapters/

echo -e "${GREEN}COMPLETE!${NC}"
echo "Adapter saved to: backend/retraining-pipeline/adapters/$ADAPTER_NAME"
