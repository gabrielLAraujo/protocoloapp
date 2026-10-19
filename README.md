# ProtocoloApp

App pessoal para acompanhar a consultoria de bodybuilding: protocolos, treinos e atualizações. Um usuário só,
offline-first (SQLite no aparelho, sincronização com a API quando há rede).

- `backend/`: API .NET 10 (ASP.NET, EF Core, PostgreSQL 18) que também serve o build web na mesma origem.
- `frontend/`: React + Capacitor (web e APK Android).
- `infra/devbox/`: estação de trabalho dos agentes (Coolify), com Postgres e Docker para os testes.
- Arquivos (PDFs, fotos) ficam num bucket Cloudflare R2, acessados por URLs pré-assinadas.

## O que o app faz hoje

- **Resumo** (tela inicial): ciclo do protocolo com contagem regressiva para a atualização, calendário de treinos feitos,
  números do ciclo (treinos, cardio, sono, água, check-ins), peso e força por grupo muscular.
- **Planejamento:** importa o PDF do protocolo e da ficha de treino, extrai com a API da Anthropic (`Anthropic__ApiKey`),
  mostra a revisão com diff e campos a conferir, e só ativa depois da sua confirmação. Versões ficam no histórico.
- **Treino:** treino do dia pela rotação da ficha, registro de séries offline (carga, repetições, tipo), timer de descanso,
  troca e pulo de exercício, histórico, recordes e evolução de 1RM estimado.
- **Hoje:** o dia em ordem de horário (refeições, itens do protocolo, cardio, treino e check-in), marcação Feito / Parcial /
  Não fiz com motivo, atrasados em destaque. O Resumo mostra a adesão do ciclo (Dieta e Itens do protocolo).
- **Lembretes** por notificação (Web Push) nos horários de cada item, configuráveis em Configurações → Horários.
- **Check-in diário**, com cardio; tudo funciona offline e sincroniza quando há rede.

## Lembretes no iPhone

1. iPhone com **iOS 16.4 ou mais novo**.
2. No Safari, abra o app e toque em **Compartilhar → Adicionar à Tela de Início**. No iPhone, notificação web só funciona no
   app instalado assim, não numa aba do Safari.
3. Abra o app **pelo ícone da Tela de Início** e entre.
4. **Mais → Configurações → Ativar lembretes** e aceite a permissão. **Enviar teste** confere se chegou.
5. Em **Configurações → Horários**, ajuste o horário de cada refeição e item (dia de treino e dia de descanso) e ligue ou
   desligue o lembrete de cada um. "Copiar do dia de treino" repete os horários no descanso.

Bom saber:

- O lembrete só chega para o que **ainda não foi marcado** em Hoje. Marcou antes do horário, não chega nada.
- A notificação diz só a refeição ou o tipo de item e o horário ("Itens em jejum", "Refeicao 1 — 07:00"): **nunca** nomes
  de compostos nem doses. Tocar nela abre Hoje.
- O servidor calcula os horários no fuso **America/Sao_Paulo**. Com o celular em outro fuso (viagem), a tela Hoje usa o fuso
  do aparelho e os lembretes continuam no horário de Brasília.
- Restaurou ou limpou o banco do servidor? Toque em "Ativar lembretes" de novo em cada aparelho.

## Importar PDF (sem IA)

Em **Planejamento**, "Enviar novo PDF" sobe o arquivo para o R2 (precisa de internet) e o próprio aparelho lê o texto
(`pdfjs-dist`, em `frontend/src/features/plans/pdf/`): a ficha de treino (blocos `(nome) séries`, linhas `- exercício`,
`DESCANSO`) e o protocolo (colunas de refeições, alimentos e suplementos; datas, fase, cardio, água, compostos) viram um
rascunho (`POST /api/plans/drafts`) que abre na revisão. O que foi inferido (ano das datas, horário pela posição, séries
herdadas) aparece com "Confira". Um PDF sem texto selecionável (escaneado) ou fora do modelo abre um rascunho vazio para
preencher à mão. Nada é enviado a uma IA; se a API tiver `Anthropic__ApiKey`, a revisão mostra também "Ler com IA", que
lê o mesmo arquivo pelo servidor e abre um novo rascunho.

## Documentação

| O quê | Onde |
| --- | --- |
| Spec (decisões e escopo) | [docs/superpowers/specs/2026-10-18-protocoloapp-design.md](docs/superpowers/specs/2026-10-18-protocoloapp-design.md) |
| Spec de Planejamento, Treino e Resumo | [docs/superpowers/specs/2026-10-18-planejamento-treino-resumo-design.md](docs/superpowers/specs/2026-10-18-planejamento-treino-resumo-design.md) |
| Spec de Hoje e lembretes | [docs/superpowers/specs/2026-10-19-hoje-lembretes-design.md](docs/superpowers/specs/2026-10-19-hoje-lembretes-design.md) |
| Plano da Fundação | [docs/superpowers/plans/2026-10-18-fundacao.md](docs/superpowers/plans/2026-10-18-fundacao.md) |
| Deploy no Coolify (passo a passo) | [docs/runbooks/deploy-coolify.md](docs/runbooks/deploy-coolify.md) |
| CI, APK e release | [docs/ci/README.md](docs/ci/README.md) |
| Dev box | [infra/devbox/README.md](infra/devbox/README.md) |

## Rodar localmente (dev box)

Precisa de .NET 10, Node 24 e de um Postgres (o do dev box serve; o Docker do dev box roda os testes de integração).

```bash
# API em http://localhost:5190 (usa appsettings.Development.json: chaves e R2 fictícios)
cd backend
ConnectionStrings__Db="Host=<postgres>;Database=protocoloapp;Username=protocoloapp;Password=<senha>" \
  dotnet run --project src/ProtocoloApp.Api --launch-profile http

# Primeiro usuário (não há cadastro público)
PROTOCOLOAPP_PASSWORD='uma-senha-com-10-ou-mais' \
  dotnet run --project src/ProtocoloApp.Api -- create-user voce@example.com

# Front com recarga automática (o Vite faz proxy de /api para a API)
cd frontend && npm ci && npm run dev
```

Em Development a API expõe o OpenAPI em `/openapi/v1.json` e o Scalar em `/scalar`.

## Comandos do dia a dia

```bash
# Back-end
cd backend && dotnet build            # também gera frontend/openapi.json (versionado; o CI falha se divergir)
cd backend && dotnet test             # integração usa Testcontainers (precisa de Docker)
dotnet ef migrations add <Nome> --project src/ProtocoloApp.Api --output-dir Shared/Data/Migrations

# Front
cd frontend && npm run gen:api        # regenera src/api/schema.d.ts a partir de openapi.json
cd frontend && npm run lint && npm test && npm run build
VITE_API_URL=https://protocolo.frauchesgabriel.work npm run cap:sync   # copia o build para o projeto Android

# E2E (Playwright): precisa da API servindo o front e de um usuário criado
cd frontend && npx playwright install chromium
E2E_BASE_URL=http://localhost:5190 E2E_EMAIL=... E2E_PASSWORD=... npx playwright test

# Imagem Docker (contexto = raiz do repositório)
docker build -f backend/Dockerfile -t protocoloapp .
```

Rotas úteis: `GET /health` (liveness, só o Postgres), `GET /health/ready` (inclui o bucket R2).

## CI

`.github/workflows/ci.yml`, em PRs e em pushes para `main` e `feat/**`:

- **Backend:** build, testes (Testcontainers), checagem das migrations e do `openapi.json`.
- **Frontend:** lint, testes e build.
- **Docker image:** o mesmo build que o Coolify faz.
- **E2E smoke:** Playwright com a API real publicada, Postgres 18 e dois navegadores: check-in offline que sincroniza e, em
  outro teste, importação de um protocolo e de uma ficha (PDFs fictícios gerados em memória por `frontend/e2e/fixtures/make-pdfs.mjs`,
  lidos no navegador pelo leitor local), treino registrado offline e Resumo; um PDF sem texto e o botão "Ler com IA"; depois, uma refeição marcada offline em Hoje que sincroniza e aparece na Dieta do
  Resumo. Por último, capturas das telas principais (claro e escuro, 390×844) no artifact `screenshots`. Dois stubs em Node (`frontend/e2e/fixtures/anthropic-stub.mjs` e `storage-stub.mjs`)
  fazem o papel da API da Anthropic e do bucket R2 (`Anthropic__BaseUrl`, `R2__ServiceUrl`); nada de rede externa.
- **Android APK:** APK de debug como artifact; na `main`, o job **Android release** publica o APK assinado numa GitHub Release.

`.github/workflows/codegen.yml` gera migrations e `openapi.json` quando a mensagem do commit tem `[codegen]` ou
`[migration:<Nome>]`.

## Regras do projeto

Veja [CLAUDE.md](CLAUDE.md): código em inglês, textos de UI em pt-BR, nenhum dado real no repositório, commits sem marca do
Claude, uma branch por subprojeto e `main` só recebe merge com OK do Gabriel.
