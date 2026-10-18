# Backlog herdado da Fundação

Itens menores adiados durante as revisões do subprojeto 1 (nenhum bloqueia o merge). Revisar ao planejar os subprojetos 2–5.

- Task 1: minor (deferred): entrypoint sem guard p/ ConnectionStrings__Db; SPA fallback sem teste; devbox playwright/claude-code sem pin; README devbox com tempos herdados do Fechamento; ForwardedHeaders confia em qualquer origem (ok atrás do Traefik)
- Task 2: minor (deferred): timing leak conta bloqueada; lockout permite DoS do dono (sem unlock-user CLI); XFF confiável só c/ porta não exposta (documentar no runbook T10); chave dev aceita fora de Development; codegen git add backend/src amplo; actions por tag
- Task 2: minor (deferred): openapi marca bodies de auth como opcionais (X | null) — tratar no client T5
- Task 3: minor (deferred): FakeTimeProvider p/ fronteira now+5min; Query() deve preservar ElementType (QueryTyped selado); hook ValidateReferencesAsync p/ entidades filhas; log por mudança em Information (→ Debug); ~6 round trips por item; JsonNumberHandling.Strict global documentar
- Task 3: minor (deferred): teste de concorrência sem confirmação positiva via pg_locks; 500 ms pode ser curto em runner frio
- Task 4: minor (deferred): PUT após confirm pode trocar objeto; órfãos sem cleanup (lifecycle rule no bucket — runbook T10); probe exige s3:ListBucket (runbook); Pending ilimitado; FileKind.Test em produção
- Task 4: minor (deferred): /confirm sob R2 pendurado → 500 após ~20 s (HeadAsync só trata 404), sem teste
- Task 5: minor (deferred): /me sem bearer no boot (1 round trip extra); a11y aria-invalid/describedby e botão desabilitado; copy 429 inventada; request.clone() em todo request (fotos); cast TokenResponse sem guard; auth responses sem tipo no OpenAPI (Produces<TokenResponse>); refresh token em localStorage na web (risco aceito, CSP futura)
- Task 6: minor (deferred): head-of-line com 5xx determinístico (bisseção após N tentativas); hasPending ignora rejeitados; relógio adiantado >5 min rejeita até o tempo real alcançar; caminhos web/Android não executados (verificar no APK/e2e); aviso ao trocar usuário com pendências
- Task 6: minor (deferred): falha de saveToStore web reporta erro p/ dado já commitado + rollback redundante; lifecycle promise sem catch no DataProvider
- Task 7: minor (deferred): teste de fuso não falha em CI UTC (TZ=America/Sao_Paulo no vitest); valor recarregado com ponto em vez de vírgula; virada de meia-noite com app aberto; `failed` não limpa; ScaleField sem ref/aria-required, erros dentro do label; invalid_payload desconhecido mostra snake_case; retry sem try/catch
- Task 8+9: minor (deferred): keystore no workspace em vez de RUNNER_TEMP; tag por run_number; 500 sem CORS header; file_paths.xml amplo; usesCleartextTraffic explícito
- Task 10: minor (deferred): ignoreBackoff zera attempts e é descartado se juntar a run em curso; apkUrl depende de Host encaminhado; download por blob no WebView não verificado (fallback Releases); read -rsp bash-only; form não recarrega após pull
- Task 10: minor (deferred): e2e falhou 2x em "B vê valores" (provável corrida pull × form que não recarrega após pull); 404 cacheado 1 min atrasa release nova
- Sair e apagar dados do aparelho (M-5) e uso de TanStack Query (M-6): subprojeto 3.
- Segunda aba continua com o aviso depois que a primeira fecha (precisa recarregar).
- Banner falso raro "Atualizado em outro aparelho" logo após salvar (janela de microtask).
- Consistência: as tabelas do Identity ficam em PascalCase com colunas snake_case (`"AspNetUsers".normalized_email`), enquanto as nossas são snake_case. Padronizar (renomear tabelas do Identity para snake_case via migration) — não feito agora; exige aspas nas consultas manuais.
