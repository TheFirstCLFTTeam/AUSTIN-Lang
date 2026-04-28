#!/bin/bash
#
# Docusaurus Development Server Stop Script
# Usage: bash stop-dev.sh [port]
#

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Default port
PORT="${1:-3000}"

echo -e "${BLUE}=== Stopping Docusaurus Development Server ===${NC}"
echo -e "${BLUE}Port: ${GREEN}$PORT${NC}"
echo ""

# Check if lsof is available
if ! command -v lsof &> /dev/null; then
    echo -e "${YELLOW}lsof command not found. Trying alternative method...${NC}"
    # Try to kill all docusaurus processes
    if pkill -f "docusaurus start"; then
        echo -e "${GREEN}✓ Stopped Docusaurus processes${NC}"
    else
        echo -e "${RED}No Docusaurus processes found${NC}"
    fi
    exit 0
fi

# Find process using the port
PID=$(lsof -ti:$PORT)

if [ -z "$PID" ]; then
    echo -e "${YELLOW}No process found running on port $PORT${NC}"

    # Check if any docusaurus process is running
    if pgrep -f "docusaurus start" > /dev/null; then
        echo -e "${YELLOW}Found running Docusaurus processes:${NC}"
        ps aux | grep "docusaurus start" | grep -v grep
        echo ""
        echo -e "${YELLOW}Stopping all Docusaurus processes...${NC}"
        pkill -f "docusaurus start"
        echo -e "${GREEN}✓ Stopped Docusaurus processes${NC}"
    else
        echo -e "${GREEN}No Docusaurus server is running${NC}"
    fi
    exit 0
fi

# Show process info
echo -e "${YELLOW}Found process:${NC}"
ps -p $PID -o pid,ppid,cmd | grep -v grep
echo ""

# Kill the process
echo -e "${YELLOW}Stopping process (PID: $PID)...${NC}"
kill $PID 2>/dev/null

# Wait a bit and check if process is still running
sleep 1

if kill -0 $PID 2>/dev/null; then
    echo -e "${YELLOW}Process still running. Forcing stop...${NC}"
    kill -9 $PID 2>/dev/null
    sleep 1
fi

# Verify the process is stopped
if ! kill -0 $PID 2>/dev/null; then
    echo -e "${GREEN}✓ Server stopped successfully${NC}"
else
    echo -e "${RED}Failed to stop the server${NC}"
    exit 1
fi

# Double-check the port is free
if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo -e "${RED}Port $PORT is still in use${NC}"
    exit 1
else
    echo -e "${GREEN}✓ Port $PORT is now free${NC}"
fi
