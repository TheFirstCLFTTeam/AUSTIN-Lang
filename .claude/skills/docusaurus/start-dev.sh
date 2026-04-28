#!/bin/bash
#
# Docusaurus Development Server Start Script
# Usage: bash start-dev.sh [project-dir] [options]
#

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Default values
PROJECT_DIR="${1:-.}"
OPTIONS="${2:-}"

# Navigate to project directory
if [ ! -d "$PROJECT_DIR" ]; then
    echo -e "${RED}Error: Directory '$PROJECT_DIR' does not exist${NC}"
    exit 1
fi

cd "$PROJECT_DIR" || exit 1

# Check if this is a Docusaurus project
if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: No package.json found. Is this a Docusaurus project?${NC}"
    exit 1
fi

if ! grep -q "docusaurus" package.json; then
    echo -e "${YELLOW}Warning: This doesn't appear to be a Docusaurus project${NC}"
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}node_modules not found. Running npm install...${NC}"
    npm install
    echo ""
fi

# Parse port from options if provided
PORT=3000
if [[ "$OPTIONS" == *"--port"* ]]; then
    PORT=$(echo "$OPTIONS" | grep -oP '(?<=--port )\d+')
fi

# Check if port is already in use
if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo -e "${RED}Error: Port $PORT is already in use${NC}"
    echo -e "${YELLOW}Try using a different port:${NC}"
    echo -e "  bash start-dev.sh $PROJECT_DIR \"--port 3001\""
    echo ""
    echo -e "${YELLOW}Or stop the process using port $PORT:${NC}"
    echo -e "  bash .claude/skills/docusaurus/stop-dev.sh $PORT"
    exit 1
fi

echo -e "${BLUE}=== Starting Docusaurus Development Server ===${NC}"
echo -e "${BLUE}Project directory: ${GREEN}$(pwd)${NC}"
echo -e "${BLUE}Port: ${GREEN}$PORT${NC}"

if [ -n "$OPTIONS" ]; then
    echo -e "${BLUE}Options: ${GREEN}$OPTIONS${NC}"
fi

echo ""
echo -e "${GREEN}Starting server...${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop the server${NC}"
echo ""

# Start the development server
if [ -n "$OPTIONS" ]; then
    npm start -- $OPTIONS
else
    npm start
fi
