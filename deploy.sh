#!/bin/bash

# Deploy script for website-log-horas
# This script deploys the Next.js application using Docker Compose

set -e  # Exit on error

echo "================================"
echo "🚀 Website Log Horas - Deploy"
echo "================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed. Please install Docker first.${NC}"
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}❌ Docker Compose is not installed. Please install Docker Compose first.${NC}"
    exit 1
fi

echo -e "${YELLOW}📋 Checking Docker installation...${NC}"
docker --version
docker-compose --version
echo ""

# Get the directory of the script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Navigate to the application directory
cd "$SCRIPT_DIR"

echo -e "${YELLOW}📦 Building Docker image...${NC}"
docker-compose build

echo ""
echo -e "${YELLOW}🔥 Starting services...${NC}"
docker-compose up -d

echo ""
echo -e "${YELLOW}⏳ Waiting for application to be ready...${NC}"
sleep 5

# Check if the container is running
if docker-compose ps | grep -q "website-log-horas"; then
    echo -e "${GREEN}✅ Application is running!${NC}"
    echo ""
    echo -e "${GREEN}🎉 Deployment successful!${NC}"
    echo ""
    echo "Application details:"
    echo "  - URL: http://localhost:3700"
    echo "  - Container: website-log-horas"
    echo ""
    echo "Useful commands:"
    echo "  - View logs:        docker-compose logs -f"
    echo "  - Stop services:    docker-compose down"
    echo "  - Restart services: docker-compose restart"
    echo "  - View status:      docker-compose ps"
else
    echo -e "${RED}❌ Application failed to start. Check logs with: docker-compose logs${NC}"
    exit 1
fi
