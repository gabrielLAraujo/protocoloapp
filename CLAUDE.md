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

## Ambiente na nuvem (limites)

- Sem `dotnet`, sem nuget.org e sem Docker no ambiente do agente: o código do back só é verificado no GitHub Actions (ou no dev box, `infra/devbox/`). Acompanhar o run com `gh api` (REST).
- Migrations (`dotnet ef`) e `gen:api` rodam no PC ou no dev box.
