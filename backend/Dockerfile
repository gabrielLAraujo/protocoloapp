# syntax=docker/dockerfile:1

# Single image: the ASP.NET API serves the front (Vite build) on the same domain.
# The build context is the REPOSITORY ROOT (Coolify: base_directory=/, dockerfile_location=/backend/Dockerfile):
#   docker build -f backend/Dockerfile -t protocoloapp .

# ---- frontend ----
# TODO(frontend task): enable this stage and the `COPY --from=frontend` line below once frontend/ exists.
# FROM node:24-alpine AS frontend
# WORKDIR /src/frontend
#
# COPY frontend/package.json frontend/package-lock.json ./
# # --include=dev: tsc and Vite are devDependencies; without it an inherited NODE_ENV=production (Coolify passes the
# # app variables as build args) would install runtime dependencies only and the build would break.
# RUN npm ci --include=dev --no-fund --no-audit
#
# COPY frontend/ ./
# RUN npm run build

# ---- build ----
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# The OpenAPI document is generated (and committed) by the normal build in CI; the image does not need to regenerate it.
ENV OpenApiGenerateDocumentsOnBuild=false

COPY backend/global.json backend/Directory.Build.props backend/Directory.Packages.props backend/ProtocoloApp.slnx ./
COPY backend/.config/dotnet-tools.json .config/
COPY backend/src/ProtocoloApp.Api/ProtocoloApp.Api.csproj src/ProtocoloApp.Api/
RUN dotnet tool restore && dotnet restore src/ProtocoloApp.Api/ProtocoloApp.Api.csproj

COPY backend/src/ src/
RUN dotnet publish src/ProtocoloApp.Api/ProtocoloApp.Api.csproj -c Release -o /app/publish --no-restore
# EF Core migrations bundle: applied by the entrypoint before the API starts
RUN dotnet ef migrations bundle \
      --project src/ProtocoloApp.Api \
      --startup-project src/ProtocoloApp.Api \
      --configuration Release \
      --output /app/efbundle --force

# ---- runtime ----
# The default aspnet:10.0 tag ships tzdata and ICU (pt-BR dates and numbers) and glibc; do not switch to an alpine or
# chiseled variant. Files live in Cloudflare R2, so there is no /data volume.
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
# curl for the Coolify health check
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/publish .
COPY --from=build --chmod=755 /app/efbundle ./efbundle
COPY --chmod=755 backend/docker-entrypoint.sh ./docker-entrypoint.sh
# TODO(frontend task): the compiled front goes into the API's webroot (SpaHosting serves it and falls back to index.html)
# COPY --from=frontend /src/frontend/dist ./wwwroot

ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
USER $APP_UID
ENTRYPOINT ["/app/docker-entrypoint.sh"]
