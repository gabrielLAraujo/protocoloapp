# ProtocoloApp

App de acompanhamento de consultoria de bodybuilding (usuário único): back-end .NET 10 + front React/Capacitor, offline-first.
Spec: `docs/superpowers/specs/2026-10-18-protocoloapp-design.md`. Plano: `docs/superpowers/plans/`.

## Regras

- Código, nomes de arquivos, tipos e rotas em **inglês**; textos de UI em **português (pt-BR)**.
- **Nenhum dado real** no repositório (nomes, medidas, fotos, PDFs, chaves). Fixtures e exemplos são fictícios. O `.gitignore` bloqueia `*.pdf`, `*.jpg`, `*.jpeg`, `*.png`, `*.heic` fora de `**/fixtures/**` e `frontend/public/**`.
- Commits e PRs **sem marca do Claude** (sem `Co-Authored-By`, sem rodapé). Uma branch por subprojeto; `main` só recebe merge com OK do Gabriel.
- Processo: spec, depois plano, depois execução por subagentes (uma tarefa por vez, com revisão).

## Back-end (`backend/`)

- `global.json` fixa o SDK `10.0.100` (`rollForward: latestFeature`); `TreatWarningsAsErrors=true`, `Nullable=enable`.
- Versões de pacotes só em `Directory.Packages.props` (central).
- EF Core com `UseSnakeCaseNamingConvention()`; enums gravados como texto; migrations aplicadas por bundle no `docker-entrypoint.sh` (`MIGRATE_ON_START`, padrão `true`).
- Todas as rotas de domínio sob `/api`; erros sempre em problem details (RFC 9457). `/health` (liveness, só Postgres) fica fora de `/api`.
- Conteúdo de payloads de domínio **nunca** em logs.
- Connection string: `ConnectionStrings__Db`.
- O build gera `frontend/openapi.json` (Microsoft.Extensions.ApiDescription.Server). O arquivo é versionado; o CI falha se divergir.

## Front (`frontend/`)

- Node 24. `npm run lint` = `tsc -b && oxlint`; `npm test` = `vitest run`.
- Cliente da API gerado por `npm run gen:api` a partir de `frontend/openapi.json`.

## Ambiente na nuvem

- **.NET nas sessões na nuvem:** o hook `.claude/hooks/session-start.sh` (SessionStart, só com `CLAUDE_CODE_REMOTE=true`) instala o SDK do `global.json` em `~/.dotnet`, põe no `PATH` e roda `dotnet restore`/`npm ci` só quando os arquivos mudaram. Depende dos domínios liberados no ambiente (`dot.net`, `builds.dotnet.microsoft.com`, `ci.dot.net`, `api.nuget.org`); sem eles o hook avisa numa linha e a sessão segue sem `dotnet`.
- **Testes do back na nuvem:** `cd backend && dotnet test tests/ProtocoloApp.UnitTests` (unitários). Os de integração usam Docker/Testcontainers e rodam só no CI ou no dev box. `dotnet build` também regenera `frontend/openapi.json`: conferir o diff antes do commit.
- **CI:** acompanhar o run com `gh api` (REST). Mudanças só em `docs/**` ou `*.md` rodam só o Privacy (o resto é pulado).
- **Dev box** (`infra/devbox/`): .NET, Docker (dind), Postgres e Chromium; ali rodam os testes de integração, migrations (`dotnet ef`) e `gen:api`.
- **Homologação:** https://zsyne9rwmi9ojzerca9merr5.148.230.77.89.sslip.io; prévia de cada PR em `<número do PR>.zsyne9rwmi9ojzerca9merr5.148.230.77.89.sslip.io`.
- **Coolify** responde a partir das sessões na nuvem: a chave vai como segredo de rede do ambiente (o proxy injeta). Nunca imprimir, logar ou commitar segredos.
