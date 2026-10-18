# ProtocoloApp

App pessoal para acompanhar a consultoria de bodybuilding: protocolos, treinos e atualizações. Funciona offline
(SQLite no aparelho, sincronização com a API quando há rede).

- `backend/`: API .NET 10 (ASP.NET, EF Core, PostgreSQL 18) que também serve o build web.
- `frontend/`: React + Capacitor (APK Android e web). Desenvolvimento: `cd frontend && npm ci && npm run dev` (proxy para a API em `localhost:5091`); `npm run gen:api` regenera `src/api/schema.d.ts` de `openapi.json`.
- `infra/devbox/`: estação de trabalho dos agentes (Coolify). Veja o README da pasta.
- `docs/superpowers/`: specs e planos.

## Back-end

```bash
cd backend
dotnet build                         # também gera ../frontend/openapi.json
dotnet test                          # integração usa Testcontainers (precisa de Docker)
ConnectionStrings__Db="Host=localhost;Database=protocoloapp;Username=protocoloapp;Password=..." \
  dotnet run --project src/ProtocoloApp.Api
```

- `GET /health`: liveness (a API responde e o Postgres está no ar).
- Em Development: OpenAPI em `/openapi/v1.json` e Scalar em `/scalar`.
- `frontend/openapi.json` é gerado a cada build e versionado. Se a API mudar, faça o build e commite o arquivo; o CI
  falha quando o arquivo versionado diverge do gerado.

## Imagem Docker

```bash
docker build -f backend/Dockerfile -t protocoloapp .   # contexto = raiz do repositório
```

Nota: o estágio do front no `backend/Dockerfile` está **comentado** até a tarefa 5 (quando `frontend/` passa a existir).
Ao criar o front, descomente o estágio `frontend` e a linha `COPY --from=frontend ... ./wwwroot`.

Variáveis de ambiente: `ConnectionStrings__Db` (obrigatória) e `MIGRATE_ON_START` (padrão `true`: aplica as migrations
antes de subir a API).

## CI

`.github/workflows/ci.yml`: back-end (build, testes, conferência do OpenAPI), front (só quando `frontend/package.json`
existe) e imagem Docker.
