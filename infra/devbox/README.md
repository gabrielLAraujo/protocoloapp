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

O que de fato limita a velocidade, medido nos últimos PRs:

- **O CI não é o gargalo.** Uma rodada completa leva cerca de 3,5 min:
  - back-end 3 a 3,5 min, dos quais ~2,5 min são os testes;
  - front ~1,3 min;
  - imagem ~1,5 min.
  
  A fila é de 2 s. Um runner próprio economizaria pouco.
- **Quanto tempo leva uma tarefa:** cada tarefa de agente leva de 7 a 20 min. São duas ou três rodadas de CI de ~4 min,
  mais a escrita e a revisão. Testar dentro do dev box tira essas esperas.
- **Por que as tarefas rodam em fila:** os planos rodam uma tarefa por vez porque elas mexem nos mesmos arquivos. O que
  mais rende é planejar em **trilhas independentes**, por exemplo:
  - back-end e front em paralelo, com o contrato da API definido antes;
  - ou features que não tocam os mesmos arquivos.
  
  Cada trilha vira um agente numa worktree própria.
- **Quanto paralelo aguenta:** o limite real de agentes simultâneos é a cota da conta Claude, não o servidor.

## Ajustes sugeridos no CI (`.github/workflows/ci.yml`)

Opcionais; o workflow vive em `.github/workflows/ci.yml`.

- **Docs sem CI:** `paths-ignore` para que mudanças só de documentação não rodem o pipeline:
  ```yaml
  on:
    pull_request:
      paths-ignore: ['docs/**', '**/*.md']
    push:
      branches: [main]
      paths-ignore: ['docs/**', '**/*.md']
    workflow_dispatch:
  ```
- **Cache da imagem:** cache de camadas no job `imagem`, com `docker/build-push-action` e `cache-from`/`cache-to:
  type=gha`. O build hoje leva ~1,5 min e quase não muda entre commits.
