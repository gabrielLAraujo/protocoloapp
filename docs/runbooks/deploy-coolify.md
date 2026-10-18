# Deploy no Coolify

Passo a passo para colocar o ProtocoloApp no ar: Postgres 18, bucket R2, app Docker, primeiro usuário e verificação final.
Quem executa é o Gabriel; os comandos e nomes abaixo são exatos. Nenhum valor secreto aparece neste arquivo: gere os seus e
guarde no gerenciador de senhas.

A imagem é única: a API .NET 10 serve o front React na mesma origem (`https://protocolo.frauchesgabriel.work`). O APK
Android fala com a mesma API.

## Visão geral

| Peça | Onde | Observação |
| --- | --- | --- |
| App (API + front) | Coolify, Dockerfile `backend/Dockerfile` | Porta interna 8080, só atrás do Traefik |
| Postgres 18 | Coolify (banco gerenciado) | Rede interna, sem porta publicada |
| Arquivos (PDFs, fotos) | Cloudflare R2, bucket privado | URLs pré-assinadas; o app nunca vê as chaves |
| APK | GitHub Release (CI na `main`) | Veja [docs/ci/README.md](../ci/README.md) |

## Checklist rápido

- [ ] 1. Bucket R2 criado, privado, com token e regra de CORS
- [ ] 2. Postgres 18 criado no Coolify
- [ ] 3. App criado no Coolify (repositório, Dockerfile, porta, domínio, health check)
- [ ] 4. Variáveis de ambiente preenchidas
- [ ] 5. Primeiro deploy verde
- [ ] 6. Usuário criado com `create-user`
- [ ] 7. Token do GitHub para a checagem de atualização
- [ ] 8. Verificação pós-deploy (última seção) toda marcada

## 1. Cloudflare R2

1. Cloudflare, R2, **Create bucket**. Nome sugerido: `protocolo-files`. Deixe **privado**: não ative "Public access" nem
   domínio público. Todo acesso é por URL pré-assinada (upload 10 min, download 5 min).
2. Anote o **Account ID** (R2, painel lateral direito). Ele vira `R2__AccountId`.
3. R2, **Manage API tokens**, **Create API token**:
   - Permissão: **Object Read & Write**.
   - Escopo: **apenas o bucket** `protocolo-files` (não "All buckets").
   - Copie **Access Key ID** e **Secret Access Key** na hora (o segredo só aparece uma vez).
   - "Object Read & Write" inclui listar objetos, e isso é necessário: o `/health/ready` testa o bucket com uma listagem
     (`ListObjectsV2`). Um token só de leitura/escrita de objetos sem listagem deixa `/health/ready` em 503.
4. Bucket, **Settings**, **CORS Policy**, adicione:

   ```json
   [
     {
       "AllowedOrigins": [
         "https://localhost",
         "capacitor://localhost",
         "https://protocolo.frauchesgabriel.work"
       ],
       "AllowedMethods": ["PUT", "GET"],
       "AllowedHeaders": ["Content-Type"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   - O upload do app é um `PUT` direto ao bucket, feito do WebView do APK (`https://localhost`; `capacitor://localhost` é a
     variante antiga) ou da web (`https://protocolo.frauchesgabriel.work`). Sem esta regra o navegador bloqueia o envio.
   - `Content-Type` precisa estar em `AllowedHeaders`: o tipo do arquivo faz parte da assinatura do link.
5. **Arquivos órfãos (limpeza manual, sem regra de lifecycle).** Um upload que começou e nunca foi confirmado deixa uma
   linha `Pending` no banco e, se o envio chegou ao bucket, um objeto sem dono. Uma regra de lifecycle do R2 que apaga
   objetos antigos **não é segura**: ela não distingue o órfão de um arquivo confirmado (protocolo, fotos de check-in) com
   a mesma idade. Não crie essa regra. A limpeza é manual, de vez em quando:

   ```sql
   -- no terminal do Postgres (Coolify): envios iniciados há mais de 1 dia e nunca confirmados
   select id, storage_key, created_at from files where status = 'Pending' and created_at < now() - interval '1 day';
   ```

   Apague no painel do R2 os objetos com essas `storage_key` (se existirem) e depois as linhas:
   `delete from files where status = 'Pending' and created_at < now() - interval '1 day';`. Confirmados (`Confirmed`) nunca
   entram nessa limpeza. Em uso normal são raríssimos.

## 2. Postgres 18

1. Coolify, projeto, **New Resource**, **Database**, **PostgreSQL**, versão **18**.
2. Nome do banco `protocoloapp`, usuário `protocoloapp`, senha gerada. **Não** marque "Make it publicly available".
3. **Start**. Copie a **Postgres URL (internal)** ou monte a string no formato Npgsql:

   ```
   Host=<nome-do-servico-interno>;Port=5432;Database=protocoloapp;Username=protocoloapp;Password=<senha>
   ```

   O host é o nome interno que o Coolify mostra na página do banco (não é `localhost`). Esse texto vira
   `ConnectionStrings__Db`.
4. Backup: ative **Scheduled Backups** na página do banco (diário) apontando para um destino S3/R2 separado do bucket de
   arquivos. Os dados de saúde moram aqui e no celular; o banco é a única cópia do servidor.
5. **Depois de restaurar um backup**, antes de abrir o app, avance a sequência de versões do sync:

   ```sql
   SELECT setval('sync_version_seq', (SELECT COALESCE(MAX(version), 0) FROM daily_checkins) + 1000000);
   ```

   Por quê: cada aparelho guarda o último `version` que puxou (`since`) e só pede registros com versão maior. O backup é
   de um momento anterior; os aparelhos podem já ter visto versões mais altas que as do dump. Sem o salto, as próximas
   gravações receberiam versões que os aparelhos acham que já têm, e nunca seriam puxadas. O `+ 1000000` deixa a
   sequência acima de qualquer `since` que um aparelho possa ter (a sequência é global e só cresce; buracos são
   inofensivos). Ao criar uma nova tabela sincronizada, inclua o `MAX(version)` dela na conta (`GREATEST(...)`).

## 3. App no Coolify

1. **New Resource**, **Application**, repositório privado `gabrielLAraujo/protocoloapp` (GitHub App do Coolify ou deploy
   key), branch **`main`**.
2. **Build Pack: Dockerfile** e:

   | Campo | Valor |
   | --- | --- |
   | Base Directory | `/` |
   | Dockerfile Location | `/backend/Dockerfile` |
   | Ports Exposes | `8080` |
   | Domains | `https://protocolo.frauchesgabriel.work` |

   O contexto do build é a raiz do repositório (a imagem copia `frontend/` e `backend/`).
3. **Health Check** (aba Healthcheck, ligado):

   | Campo | Valor |
   | --- | --- |
   | Path | `/health` |
   | Port | `8080` |
   | Method / Scheme | `GET` / `http` |
   | Return code | `200` |

   Use `/health` (liveness: só o Postgres). **Não** use `/health/ready` no Coolify: ele inclui o R2, e uma indisponibilidade do
   Cloudflare faria o Coolify reiniciar um app saudável. `/health/ready` serve para você conferir o bucket (verificação
   pós-deploy). A imagem já traz `curl`, que o Coolify usa na checagem.
4. **Não publique a porta no host.** Deixe **Ports Mappings** vazio. O app só deve ser alcançável pelo Traefik do
   Coolify. Motivo: a API confia no cabeçalho `X-Forwarded-For` para saber o IP do cliente (o limite de tentativas de login
   é por IP). Se a porta 8080 ficasse aberta, qualquer um poderia forjar o cabeçalho e escapar do limite. Também não
   altere o Traefik para repassar `X-Forwarded-For` de clientes externos sem sobrescrever (o padrão do Coolify sobrescreve).
5. **Auto Deploy** ligado: cada push na `main` gera um deploy.
6. Rede: o app e o Postgres precisam estar na mesma rede do Coolify (o padrão do projeto/ambiente já resolve).

## 4. Variáveis de ambiente

Aba **Environment Variables** do app. Marque como **runtime** (desmarque "Available at Buildtime" nos segredos: eles não
entram na imagem).

| Variável | Obrigatória | Valor |
| --- | --- | --- |
| `ConnectionStrings__Db` | sim | String Npgsql do passo 2 |
| `Auth__SigningKey` | sim | Chave aleatória de no mínimo 32 bytes: `openssl rand -base64 48`. Trocar invalida os tokens de acesso em uso (o app renova sozinho). |
| `R2__AccountId` | sim | Account ID do passo 1 |
| `R2__AccessKeyId` | sim | Access Key ID do token do passo 1 |
| `R2__SecretAccessKey` | sim | Secret Access Key do token do passo 1 |
| `R2__Bucket` | sim | `protocolo-files` |
| `Cors__AllowedOrigins__0` | sim | `https://localhost` |
| `Cors__AllowedOrigins__1` | sim | `capacitor://localhost` |
| `GitHub__Token` | não | Token de leitura do repositório (passo 7). Sem ele só a checagem de atualização do APK responde 503. |
| `Anthropic__ApiKey` | não | Chave da API Anthropic. **Ainda não é usada**: entra a partir do subprojeto 2. |
| `MIGRATE_ON_START` | não | `true` (padrão): aplica as migrations antes de subir a API. |

Pontos de atenção:

- O app **não sobe** sem `Auth__SigningKey` (32 bytes ou mais) e sem as quatro variáveis `R2__*`: a mensagem nos logs diz qual
  falta (`R2:AccountId, R2:AccessKeyId, R2:SecretAccessKey and R2:Bucket are required.`). O R2 é só conferido na
  inicialização, não é chamado até alguém usar arquivos.
- `Cors__AllowedOrigins__N` **substitui** a lista padrão (que já é `https://localhost` e `capacitor://localhost`). A web na
  mesma origem não precisa de CORS na API. Se um dia houver outra origem, acrescente `Cors__AllowedOrigins__2`.
- Logs são JSON estruturado no console (aba Logs do Coolify). Conteúdo de check-ins e arquivos nunca é logado.

## 5. Primeiro deploy

1. **Deploy**. Acompanhe os logs: `Applying migrations...` e depois a API escutando em `8080`.
2. Se o container reiniciar em loop, leia a primeira linha de erro nos logs: quase sempre é variável faltando (tabela acima)
   ou `ConnectionStrings__Db` com host errado.
3. Quando o health check ficar verde, confira de fora:

   ```bash
   curl -i https://protocolo.frauchesgabriel.work/health   # 200 e "Healthy"
   ```

## 6. Criar o usuário (único)

Não existe cadastro público. A conta nasce por comando, no **Terminal** do Coolify (aba Terminal do app, container do app):

```bash
read -rsp "Senha: " PROTOCOLOAPP_PASSWORD; echo      # digita a senha sem aparecer na tela nem no histórico
export PROTOCOLOAPP_PASSWORD
dotnet /app/ProtocoloApp.Api.dll create-user seu@email.com
unset PROTOCOLOAPP_PASSWORD
```

- A senha precisa ter **10 caracteres ou mais**. Ela vem de `PROTOCOLOAPP_PASSWORD` (ou da primeira linha da entrada
  padrão); nunca de argumento, que ficaria no histórico do shell.
- Saída esperada: `Usuário criado.` Se o usuário já existir: `Usuário já existe.`
- 5 senhas erradas seguidas bloqueiam a conta por 15 minutos (e o login tem limite de tentativas por IP). Não há comando de
  desbloqueio: espere os 15 minutos.

## 7. Token do GitHub (checagem de atualização do APK)

O repositório é privado; o app não consegue ver as releases sozinho. A API consulta o GitHub e repassa o APK.

1. GitHub, Settings, Developer settings, **Fine-grained personal access tokens**, **Generate new token**.
2. **Repository access: Only select repositories**, escolha só `gabrielLAraujo/protocoloapp`.
3. Permissões do repositório: **Contents: Read-only** (Metadata: Read-only vem junto). Nada além disso.
4. Expiração: a máxima que quiser, **e anote a data**. Quando vencer, a checagem passa a responder 503 (o resto do app não é
   afetado); gere outro e atualize `GitHub__Token`.
5. Cole em `GitHub__Token` no Coolify e faça **Redeploy** (variáveis são lidas na inicialização).

As secrets do **GitHub Actions** (assinatura do APK) são outra coisa: veja [docs/ci/README.md](../ci/README.md). A release só
é criada em push na `main`, com as quatro secrets de assinatura configuradas.

## Verificação pós-deploy

Critérios do spec (seção 9.1). Marque um a um.

- [ ] **Saúde:** `curl https://protocolo.frauchesgabriel.work/health` responde 200 com `Healthy`.
- [ ] **Bucket:** `curl https://protocolo.frauchesgabriel.work/health/ready` responde 200 com `Healthy`. Se vier 503 com o
  `/health` ok, o problema é o R2: chaves, nome do bucket, `R2__AccountId` ou a permissão de listagem do token.
- [ ] **Login na web:** abra `https://protocolo.frauchesgabriel.work`, entre com o usuário do passo 6. A tela "Check-in de
  hoje" abre e o cabeçalho mostra "Sincronizado".
- [ ] **Login no APK:** instale o APK da release (Releases do GitHub; veja [docs/ci/README.md](../ci/README.md)) e entre com o
  mesmo usuário.
- [ ] **Offline no APK:** coloque o celular em modo avião, salve o check-in de hoje (aparece "Offline — 1 pendente"),
  desligue o modo avião e espere "Sincronizado". Abra a web: o mesmo check-in aparece (abra a tela de novo se já estava
  aberta).
- [ ] **Sem duplicar:** toque em "Sincronizar agora" mais de uma vez; a web continua com um único check-in do dia e a tela
  `/sync` não lista pendências nem itens com problema.
- [ ] **Arquivos:** no APK e na web, Diagnóstico, **Testar armazenamento**. Esperado: "Armazenamento OK: envio, confirmação e
  download funcionaram." Se falhar, a mensagem diz a etapa; "o envio ao bucket falhou" aponta para a regra de CORS do bucket
  (origens, `PUT`, `Content-Type`) ou para as chaves do R2.
- [ ] **Deploy automático:** um push na `main` dispara um deploy no Coolify e o `/health` volta a responder 200.
- [ ] **Release do APK:** o CI da `main` publicou a release `v0.1.<n>` com o arquivo `protocolo-0.1.<n>.apk`.
- [ ] **Aviso de atualização:** com um APK mais antigo instalado, ao abrir o app aparece "Nova versão disponível" e o botão
  "Baixar atualização" baixa o APK (precisa de `GitHub__Token`). Se não aparecer, veja a tabela abaixo.
- [ ] **CI:** todos os jobs do último run da `main` verdes (Backend, Frontend, Docker image, E2E smoke, Android APK, Android release).

## Problemas comuns

| Sintoma | Causa provável |
| --- | --- |
| Container reinicia em loop, log cita `Auth:SigningKey` ou `R2:` | Variável obrigatória faltando ou chave com menos de 32 bytes |
| Deploy "unhealthy" mas o app responde por dentro | Health check apontando para outra porta/caminho; use `/health` na `8080` |
| `/health` 503 | Postgres inacessível: `ConnectionStrings__Db` (host interno, senha) ou banco parado |
| `/health/ready` 503 e `/health` 200 | R2: chaves, bucket, Account ID ou token sem permissão de listagem |
| Login no APK falha com erro de rede, web funciona | CORS: `Cors__AllowedOrigins__0/1` ausentes ou digitados diferente |
| Upload falha só no APK/web, "Testar armazenamento" aponta o envio | Regra de CORS do bucket (origens, `PUT`, header `Content-Type`) |
| Login responde 429 | Limite de 5 tentativas por minuto por IP; espere 1 minuto |
| Conta bloqueada | 5 senhas erradas; espere 15 minutos |
| Banner de atualização nunca aparece | `GitHub__Token` ausente/expirado (a API responde 503 a `/api/app/latest-release`) ou ainda não há release |

## Operação

- **Reverter um deploy:** no Coolify, Deployments, **Redeploy** do commit anterior. As migrations só avançam: antes de
  reverter uma versão que criou migration, avalie se o código antigo funciona com o esquema novo.
- **Trocar uma chave do R2:** crie outro token no escopo do bucket, atualize `R2__AccessKeyId` e `R2__SecretAccessKey`,
  redeploy e só então revogue o antigo.
- **Trocar `Auth__SigningKey`:** invalida os tokens de acesso (duram 15 min); os aparelhos renovam com o refresh token, sem novo login.
