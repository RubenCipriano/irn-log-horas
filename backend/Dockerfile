# Multi-stage build for the TimeFlow .NET 8 backend.
#
# Stage 1 (sdk): restore + publish the API. The publish step runs ahead-of-
# time compilation tweaks and copies everything required to run the host
# into /app/publish.
#
# Stage 2 (aspnet runtime): slim ~120 MB final image with just the runtime.
# Runs as a non-root `app` user (default in the alpine runtime image).

# --- build ---------------------------------------------------------------
FROM mcr.microsoft.com/dotnet/sdk:8.0-alpine AS build
WORKDIR /src

# Copy solution + project files first so `dotnet restore` caches well — if
# only source files change, the layer with restored NuGet packages stays hot.
COPY TimeFlow.sln ./
COPY TimeFlow.Api/TimeFlow.Api.csproj ./TimeFlow.Api/
COPY TimeFlow.Auth/TimeFlow.Auth.csproj ./TimeFlow.Auth/
COPY TimeFlow.Data/TimeFlow.Data.csproj ./TimeFlow.Data/
COPY TimeFlow.Domain/TimeFlow.Domain.csproj ./TimeFlow.Domain/
COPY TimeFlow.Cache/TimeFlow.Cache.csproj ./TimeFlow.Cache/
COPY TimeFlow.Rbac/TimeFlow.Rbac.csproj ./TimeFlow.Rbac/
COPY TimeFlow.Vault/TimeFlow.Vault.csproj ./TimeFlow.Vault/
COPY TimeFlow.Integrations/TimeFlow.Integrations.csproj ./TimeFlow.Integrations/
COPY TimeFlow.Ai/TimeFlow.Ai.csproj ./TimeFlow.Ai/
COPY TimeFlow.Billing/TimeFlow.Billing.csproj ./TimeFlow.Billing/
RUN dotnet restore TimeFlow.sln

# Copy the rest and publish the API project. The output goes to /app/publish.
COPY . .
RUN dotnet publish TimeFlow.Api/TimeFlow.Api.csproj \
    -c Release \
    -o /app/publish \
    --no-restore \
    /p:UseAppHost=false

# --- runtime -------------------------------------------------------------
FROM mcr.microsoft.com/dotnet/aspnet:8.0-alpine AS runtime
WORKDIR /app

# Health check probes /api/health (anonymous endpoint). nginx and docker
# both rely on this for upstream rotation + container restart.
RUN apk add --no-cache wget
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget --quiet --tries=1 -O /dev/null http://localhost:5001/api/health || exit 1

COPY --from=build /app/publish ./

ENV ASPNETCORE_URLS=http://+:5001
ENV ASPNETCORE_ENVIRONMENT=Production
EXPOSE 5001

ENTRYPOINT ["dotnet", "TimeFlow.Api.dll"]
