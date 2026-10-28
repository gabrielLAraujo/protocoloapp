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
- **Check-in em partes:** **Manhã** (sono, disposição ao acordar, intestino, peso opcional) e **Noite** (disposição no dia,
  ansiedade, água, observações), cada uma salva sozinha a partir da sua linha em Hoje (ou de Mais → Check-in de hoje). O
  cardio fica só no item Cardio de Hoje, com os minutos feitos. O Resumo conta um check-in quando as duas partes do dia
  foram salvas. Tudo funciona offline e sincroniza quando há rede.
- **Gamificação:** em Hoje, o **anel do dia** (o % do que estava previsto para o dia inteiro; Parcial vale meio) com
  "Meta do dia batida" a partir de 90% e uma comemoração curta ao chegar a 100%; a **sequência** de dias na meta (≥ 90% do
  previsto); o card **Semana** com as metas da semana (dieta e itens do protocolo ≥ 90%, todos os treinos, cardio previsto, água, check-ins completos). Em Mais →
  **Conquistas**, a sequência atual e o recorde e as medalhas conquistadas e a conquistar. O Resumo ganha a seção
  "Constância".

### Atualizar todos os aparelhos antes do check-in em partes

Antes de salvar o primeiro check-in em partes (só Manhã ou só Noite) em qualquer aparelho, **atualize todos**: no web/PWA,
toque em **Atualizar** quando o aviso de nova versão aparecer (ou feche e abra o app); no Android, instale o APK novo
("Baixar atualização"). Uma versão antiga guarda o check-in com todos os campos obrigatórios: ao receber uma linha só com a
manhã, a sincronização dela fica parada (nada se perde) até o aparelho ser atualizado. Marcar o Cardio no Hoje antes de
qualquer check-in do dia também cria uma linha parcial. No Android, instale o APK novo só depois que o deploy do servidor
terminar.

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

## Treino inteligente

A ficha de treino é lida com mais estrutura e a revisão e o treino do dia aproveitam isso.

- **Importação estruturada:** cada exercício da ficha ganha **grupamento muscular** e **par no catálogo** (o exercício
  equivalente do ExerciseDB, com demonstração) a partir de um dicionário pt-BR de exercícios
  (`frontend/src/domain/exercise-dictionary.json`), e as **técnicas** escritas na ficha viram campos: drop (`+ drop`,
  `+ 2 drop`, "drop na última"), rest-pause, bi-set, SST (com os intervalos) e outras. Acerto incerto aparece com "Confira".
  Tudo roda no aparelho, sem IA.
- **Revisão por etapas:** Rotação, um passo por dia (linhas compactas com miniatura, grupo, séries e etiquetas de técnica que
  explicam ao toque), Exercícios novos (grupo e par de demonstração) e Ativar. "Confirmar dia" salva o rascunho; só ativa com
  todos os dias confirmados. Escolher outro exercício para uma linha "Confira" ensina o apelido ao exercício.
- **GIFs do ExerciseDB:** o servidor copia só o **catálogo** (nome, músculos, equipamento e o endereço do GIF) de
  `oss.exercisedb.dev` em segundo plano, no primeiro start e depois a cada 30 dias. Os GIFs **não** são copiados nem ficam no
  repositório: o app carrega cada um do site do ExerciseDB (`static.exercisedb.dev`) e guarda um cache local limitado
  (até 60 GIFs, 90 dias). Uso pessoal; confira os termos do ExerciseDB antes de qualquer outro uso. No app nativo
  (Android e iOS) não há service worker, então **não há GIF offline** lá: sem internet aparece só o link "Ver no YouTube".
  Sem catálogo (sincronização desligada ou ainda não concluída) o app funciona igual, sem os GIFs.
- **Técnicas no treino:** a série com drop ganha, depois de concluída, as linhas "Drop 1", "Drop 2" com a carga sugerida
  (cerca de 20% menos que a anterior); rest-pause gera linhas com a mesma carga e descanso curto. Elas contam no volume mas
  não em recordes. Bi-set agrupa os dois exercícios num bloco que alterna as séries e só descansa depois do par. SST usa os
  intervalos curtos da ficha como descanso entre as séries.
- **Ao atualizar:** atualize o app em todos os aparelhos (PWA: "Atualizar"; Android: APK novo) antes de importar uma ficha
  nova. Uma versão antiga que abrir e salvar um rascunho novo descarta as técnicas e os pares do catálogo, e conta as
  sub-séries como séries normais nos recordes.

## Atualização (questionário e fotos)

Em **Mais → Atualização** (e no cartão de Hoje a partir de 3 dias antes da data), a atualização do ciclo em três etapas:

- **Fotos:** uma por pose (Frente, Costas, Lado direito, Lado esquerdo, Abdômen, ou as do modelo), com a mesma pose do ciclo
  anterior por cima da câmera para repetir o enquadramento, temporizador de 5 s e troca de câmera. Sem câmera, escolhe-se um
  arquivo. A foto fica numa fila no aparelho (funciona offline) e sobe para o **R2** quando há rede; o aparelho guarda só a
  miniatura. "Baixar fotos (.zip)" monta o zip no próprio aparelho.
- **Questionário:** montado a partir do **modelo** importado em Configurações. Perguntas ligadas a uma métrica (adesão da
  dieta, treinos perdidos, peso, médias do check-in, notas do ciclo...) chegam respondidas com o selo **Calculado** pelo
  servidor e podem ser editadas (a edição vale) ou recalculadas; as demais são livres, com "Ver notas do ciclo" à mão. O
  rascunho salva a cada mudança e sincroniza.
- **Revisar e enviar:** "Gerar PDF" (impressão do navegador; não aparece no APK), "Copiar texto", "Baixar fotos (.zip)" e
  "Marcar como enviada".

Tudo calculado por regras fixas: **nada vai para uma IA**.

### Carregar o seu questionário

O modelo real (as perguntas do seu coach) **nunca entra no repositório**: fica só no seu banco, sincronizado entre os
aparelhos. Para carregá-lo:

1. Monte um JSON no formato de [`fixtures/questionnaire-template.example.json`](fixtures/questionnaire-template.example.json)
   (perguntas fictícias): `title`, `sections[].questions[]` com `key`, `text`, `kind` (`text`, `long_text`, `number`,
   `choice` com `options`) e, se quiser o cálculo, `fill` (uma das métricas, ex.: `diet_error_pct`, `missed_workouts`,
   `weight`, `checkin_notes`); `poses` opcional.
2. No app, **Configurações → Questionário de atualização → Importar JSON** e escolha o arquivo. Um arquivo inválido é
   recusado com a mensagem do erro e o modelo atual fica intacto; importar de novo pede "Substituir o modelo atual?".
3. Ajuste perguntas, "Preencher com" e poses ali mesmo; "Exportar JSON" guarda uma cópia.

Guarde o arquivo **fora do repositório** (nunca o commite). O `npm run privacy` e o `.gitignore` não sabem reconhecer um
JSON de perguntas reais: o cuidado é seu.

## Hevy

Em **Configurações → Hevy**, a chave da API do Hevy (conta **Pro**; no site do Hevy, Settings → Developer) liga a importação:
os treinos do Hevy chegam como sessões encerradas, a cada 30 minutos (`Hevy__IntervalMinutes`) e em "Sincronizar agora",
contam como treino feito em Hoje e no Resumo e aparecem no Histórico com o selo **Hevy** (o mesmo treino registrado no app e
no Hevy ganha o aviso "Manter só um"). O dia da ficha vem do título do treino, ou dos exercícios em comum, ou da rotação.
Exercícios sem par viram provisórios para confirmar em "Exercícios do Hevy para confirmar".

A chave vai uma vez ao servidor, que a guarda cifrada (AES-GCM) com `Integrations__EncryptionKey` (32 bytes em base64,
`openssl rand -base64 32`, no Coolify); sem essa variável o app funciona e a tela diz "Não configurado no servidor". Perder a
variável só obriga a informar a chave do Hevy de novo. `Hevy__Enabled=false` desliga a sincronização automática. Passo a
passo no [runbook](docs/runbooks/deploy-coolify.md#10-hevy-importação-de-treinos).

## Documentação

| O quê | Onde |
| --- | --- |
| Spec (decisões e escopo) | [docs/superpowers/specs/2026-10-18-protocoloapp-design.md](docs/superpowers/specs/2026-10-18-protocoloapp-design.md) |
| Spec de Planejamento, Treino e Resumo | [docs/superpowers/specs/2026-10-18-planejamento-treino-resumo-design.md](docs/superpowers/specs/2026-10-18-planejamento-treino-resumo-design.md) |
| Spec de Hoje e lembretes | [docs/superpowers/specs/2026-10-19-hoje-lembretes-design.md](docs/superpowers/specs/2026-10-19-hoje-lembretes-design.md) |
| Spec de Check-in em partes e gamificação | [docs/superpowers/specs/2026-10-19-checkin-gamificacao-design.md](docs/superpowers/specs/2026-10-19-checkin-gamificacao-design.md) |
| Spec do Treino inteligente | [docs/superpowers/specs/2026-10-20-treino-inteligente-design.md](docs/superpowers/specs/2026-10-20-treino-inteligente-design.md) |
| Spec da Atualização (questionário e fotos) | [docs/superpowers/specs/2026-10-23-atualizacao-design.md](docs/superpowers/specs/2026-10-23-atualizacao-design.md) |
| Plano da Atualização | [docs/superpowers/plans/2026-10-23-atualizacao.md](docs/superpowers/plans/2026-10-23-atualizacao.md) |
| Spec da sincronização com o Hevy | [docs/superpowers/specs/2026-10-24-hevy-design.md](docs/superpowers/specs/2026-10-24-hevy-design.md) |
| Plano da sincronização com o Hevy | [docs/superpowers/plans/2026-10-24-hevy.md](docs/superpowers/plans/2026-10-24-hevy.md) |
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

- **Privacy:** `scripts/privacy-guard.mjs` (Node, sem dependências) varre os arquivos versionados e falha se alguma linha contém um termo da lista `privacy/denylist.sha256`, que guarda só hashes sha256 (de 1 a 3 palavras, normalizadas: minúsculas, sem acento). A saída mostra apenas `arquivo:linha`. Rode local com `npm run privacy` em `frontend/`. Para incluir um termo, gere o hash no seu computador, sem commitar o termo: `node -e "import('./scripts/privacy-guard.mjs').then(m=>console.log(m.hashTerm(process.argv[1])))" "termo aqui"` e acrescente a saída em uma linha nova do `privacy/denylist.sha256`.
- **Backend:** build, testes (Testcontainers), checagem das migrations e do `openapi.json`.
- **Frontend:** lint, testes e build.
- **Docker image:** o mesmo build que o Coolify faz.
- **E2E smoke:** Playwright com a API real publicada, Postgres 18 e dois navegadores: importação de um protocolo e de uma ficha (PDFs fictícios gerados em memória por `frontend/e2e/fixtures/make-pdfs.mjs`,
  lidos no navegador pelo leitor local), treino registrado offline e Resumo; um PDF sem texto e o botão "Ler com IA"; depois, uma refeição marcada offline em Hoje que sincroniza e aparece na Dieta do
  Resumo; em seguida (projeto `today`, com o protocolo já ativo), o check-in em partes salvo offline (Manhã, depois Noite) que
  sincroniza com um segundo navegador, sobe o anel do dia e conta 1 check-in completo no Resumo. Esse teste pressupõe o
  banco novo de cada run e que `offline.spec.ts` salvou só a Noite de hoje. No mesmo projeto, a conexão com o Hevy (chave de teste), "Sincronizar agora" com 1 treino fictício importado, o selo "Hevy" no Histórico, o treino feito em Hoje e "Remover". Por último, capturas das telas principais (claro e escuro, 390×844) no artifact `screenshots`. Três stubs em Node (`frontend/e2e/fixtures/anthropic-stub.mjs`, `storage-stub.mjs` e `hevy-stub.mjs`)
  fazem o papel da API da Anthropic, do bucket R2 e da API do Hevy (`Anthropic__BaseUrl`, `R2__ServiceUrl`, `Hevy__BaseUrl`, com `Integrations__EncryptionKey` de teste e o agendador do Hevy desligado); nada de rede externa.
- **Android APK:** APK de debug como artifact; na `main`, o job **Android release** publica o APK assinado numa GitHub Release.

`.github/workflows/codegen.yml` gera migrations e `openapi.json` quando a mensagem do commit tem `[codegen]` ou
`[migration:<Nome>]`.

## Regras do projeto

Veja [CLAUDE.md](CLAUDE.md): código em inglês, textos de UI em pt-BR, nenhum dado real no repositório, commits sem marca do
Claude, uma branch por subprojeto e `main` só recebe merge com OK do Gabriel.
