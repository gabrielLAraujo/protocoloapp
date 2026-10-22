# Dev box (Coolify)

Estação de trabalho dos agentes num container: build, testes, migrations, `gen:api` e conferência visual rodam ali, sem
ida e volta ao GitHub Actions e sem depender do PC.

## O que tem

| Serviço | Para quê |
|---|---|
| `devbox` | .NET 10 SDK, `dotnet-ef`, Node 24, `gh`, Claude Code e Chromium (Playwright). A home (`/home/dev`) é um volume: repositórios, caches do NuGet/npm e logins sobrevivem a novos deploys. |
| `dind` | Docker isolado para os Testcontainers dos testes de integração. É `privileged`, mas só roda os containers dos testes, não os do servidor. |
| `postgres` | Postgres 18 de desenvolvimento, **só com dados fictícios**. Serve para subir a API, gerar o `schema.d.ts` e conferir as telas. |

## Subir no Coolify

1. **New Resource → Docker Compose**, apontando para este repositório, branch `main`, arquivo
   `infra/devbox/docker-compose.yml`.
2. Em **Environment Variables**, criar `POSTGRES_PASSWORD` com uma senha forte.
3. **Deploy.** O primeiro build leva alguns minutos, por causa do .NET SDK e do Chromium.
   Sem Chromium: `INSTALL_PLAYWRIGHT: "false"` no compose.
4. Não expor nenhuma porta. O acesso é pelo **Terminal** do Coolify, no serviço `devbox`.

## Primeiro acesso (pelo Terminal, uma vez)

```bash
gh auth login                      # GitHub: escolha HTTPS e o navegador/código
gh repo clone gabrielLAraujo/protocoloapp
claude                             # faz o login na sua conta Claude
```

Para comandar essa sessão pelo app do Claude (celular, desktop ou web), siga a página
[Remote Control](https://code.claude.com/docs/en/remote-control) da documentação oficial.

## Comandos que deixam de depender do CI

```bash
cd ~/protocoloapp/backend && dotnet test                                    # testes do back, incluindo os de integração (via dind)
dotnet ef migrations add <Nome> --project src/ProtocoloApp.Api --output-dir Shared/Data/Migrations
cd ~/protocoloapp/backend && dotnet run --project src/ProtocoloApp.Api &      # API apontando para o postgres do compose
cd ~/protocoloapp/frontend && npm ci && npm run gen:api                     # schema.d.ts gerado de frontend/openapi.json (o build do back gera o arquivo)
```

## Paralelizar o desenvolvimento

O que de fato limita a velocidade, medido nos runs de CI de 21 e 22/10/2026:

- **O CI não é o gargalo, mas o E2E é o caminho crítico.** Uma rodada leva ~3,5 min (mediana):
  - E2E ~3,3 min (Playwright ~1,5 min, instalação do Chromium ~25 s, build do front, publish e migrations);
  - back-end ~2 min, dos quais ~1,3 min são os testes;
  - front ~1,6 min (os testes do Vitest levam ~1 min);
  - imagem ~1,1 min, agora com cache de camadas (`type=gha`).
  
  A fila é de segundos. Um runner próprio economizaria pouco. Mudanças só de documentação pulam o pipeline (só o
  Privacy roda).
- **Quanto tempo leva uma tarefa:** cada tarefa de agente leva de 7 a 20 min. São duas ou três rodadas de CI de ~4 min,
  mais a escrita e a revisão. O que tira essas esperas:
  - **sessões na nuvem:** o hook de SessionStart instala o .NET (com os domínios liberados), então build e testes
    unitários do back (`dotnet test tests/ProtocoloApp.UnitTests`) rodam ali mesmo;
  - **dev box:** testes de integração (Docker), migrations e `gen:api`.
- **Por que as tarefas rodam em fila:** os planos rodam uma tarefa por vez porque elas mexem nos mesmos arquivos. O que
  mais rende é planejar em **trilhas independentes**, por exemplo:
  - back-end e front em paralelo, com o contrato da API (`frontend/openapi.json`) definido antes;
  - ou features que não tocam os mesmos arquivos.
  
  Cada trilha vira um agente numa worktree própria e abre o próprio PR; cada PR ganha uma prévia em
  `<número do PR>.zsyne9rwmi9ojzerca9merr5.148.230.77.89.sslip.io` para conferir sem esperar o merge.
- **Quanto paralelo aguenta:** o limite real de agentes simultâneos é a cota da conta Claude, não o servidor.

## CI (`.github/workflows/ci.yml`)

Ajustes já aplicados:

- **Docs sem build:** o job `changes` compara com a base; se só mudaram `docs/**` ou `*.md`, back, front, imagem, E2E e
  APK são pulados. O Privacy roda sempre (o workflow não usa `paths-ignore`, então nenhum check fica "pendente").
- **Cache da imagem:** `docker/build-push-action` com `cache-from`/`cache-to: type=gha`.
- **Cache do Chromium do Playwright** por versão; as bibliotecas do sistema continuam vindo do apt.
- NuGet e npm já tinham cache; `concurrency` cancela o run anterior do mesmo branch (nunca na `main`).
