# Dev box for coding agents: everything the ProtocoloApp repo needs to build, test and generate code locally,
# without waiting on GitHub Actions. Deployed on Coolify with docker-compose.yml next to this file.
FROM node:24-bookworm-slim AS node

FROM mcr.microsoft.com/dotnet/sdk:10.0-noble

ARG INSTALL_PLAYWRIGHT=true

# Node 24 (same major as CI) copied from the official image.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# Base tools, Docker CLI (talks to the dind service for Testcontainers) and GitHub CLI.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates gnupg jq ripgrep postgresql-client python3 sudo \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc \
 && echo "deb [signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" > /etc/apt/sources.list.d/docker.list \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli.gpg \
 && echo "deb [signed-by=/etc/apt/keyrings/githubcli.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin gh \
 && rm -rf /var/lib/apt/lists/*

# Claude Code CLI.
RUN npm install -g @anthropic-ai/claude-code

# Non-root user; its home is a volume (repos, NuGet/npm caches, CLI logins survive redeploys).
RUN (userdel -r ubuntu 2>/dev/null || true) && useradd -m -s /bin/bash dev && echo "dev ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/dev
USER dev
WORKDIR /home/dev
ENV PATH="/home/dev/.dotnet/tools:${PATH}" \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_NOLOGO=1

RUN dotnet tool install --global dotnet-ef

# Chromium for visual checks and e2e (Playwright). Optional: ~500 MB.
RUN if [ "$INSTALL_PLAYWRIGHT" = "true" ]; then \
      npx -y playwright@latest install chromium && sudo npx -y playwright@latest install-deps chromium; \
    fi

# Keep the container alive; work happens through the Coolify terminal / `docker exec`.
CMD ["sleep", "infinity"]
