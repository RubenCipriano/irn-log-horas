#!/bin/bash

# Deploy script for website-log-horas
# Stops old container, rebuilds from scratch, and starts fresh

set -e

echo "================================"
echo "Website Log Horas - Deploy"
echo "================================"
echo ""

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

if ! command -v docker &> /dev/null; then
    echo -e "${RED}Docker is not installed. Please install Docker first.${NC}"
    exit 1
fi

if ! command -v docker compose &> /dev/null && ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}Docker Compose is not installed.${NC}"
    exit 1
fi

# Use 'docker compose' (v2) if available, fallback to 'docker-compose' (v1)
if docker compose version &> /dev/null; then
    DC="docker compose"
else
    DC="docker-compose"
fi

echo -e "${YELLOW}Docker:${NC}"
docker --version
$DC version
echo ""

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Stop and remove old container + image
echo -e "${YELLOW}Stopping and removing old container...${NC}"
$DC down --rmi local --remove-orphans 2>/dev/null || true
echo ""

# Build fresh
echo -e "${YELLOW}Building Docker image (no cache)...${NC}"
$DC build --no-cache
echo ""

# Start
echo -e "${YELLOW}Starting services...${NC}"
$DC up -d
echo ""

echo -e "${YELLOW}Waiting for application to be ready...${NC}"
sleep 5

if $DC ps | grep -q "website-log-horas"; then
    echo -e "${GREEN}Deployment successful!${NC}"
    echo ""
    echo "  URL:       http://localhost:3700"
    echo "  Container: website-log-horas"
    echo ""
    echo "Commands:"
    echo "  Logs:    $DC logs -f"
    echo "  Stop:    $DC down"
    echo "  Status:  $DC ps"
else
    echo -e "${RED}Application failed to start. Check logs: $DC logs${NC}"
    exit 1
fi
