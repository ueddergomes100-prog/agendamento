# Firebase: implementação e ativação

Projeto único: `agendamento-salao-bfe26`. Região do banco e das funções: `southamerica-east1` (São Paulo). A especificação Firebase substitui PostgreSQL/RLS/Supabase para o runtime de produção. O SQL antigo permanece apenas como referência e testes do domínio legado.

## O que foi implementado

- SDK Firebase web, autenticação e-mail/senha, recuperação de senha e persistência de sessão do Auth. Nenhum token é salvo manualmente no localStorage.
- Cadastro self-service separado: contas **CLIENT** reservam horários; contas **SALON** criam salões em rascunho, convidam equipe e administram o espaço. O servidor bloqueia o provisionamento de salão para contas de cliente. Slug reservado em transação, provisionamento idempotente e limite inicial de 10 salões por conta.
- Catálogo público limitado, separado de documentos privados, com projeção atualizada atomicamente. Os oito temas usam o ThemeProvider existente. Upload de logo/capa via Storage, com regras de tamanho/tipo e papel.
- Membros OWNER, MANAGER, RECEPTIONIST, PROFESSIONAL e FINANCE. Usuário pode ter vínculos diferentes por salão. Super Admin é uma claim global validada no servidor; não existe autopromoção pelo cliente.
- Firestore Rules negam todas as escritas diretas. Operações críticas usam a callable `salonApi`, Zod, Auth, App Check obrigatório em produção e verificação de membro por transação.
- Holds de cinco minutos; confirmação; cancelamento; reagendamento atômico; check-in; conclusão; avaliação; bloqueios; antecedência; janela futura; jornada; intervalos; preço e duração calculados no servidor.
- Perfil, favoritos por salão, preferências/consentimentos, notificações internas, lista de espera, solicitação de exclusão e exportação limitada dos registros do salão atual.
- Agenda Business limitada por data e por papel; profissional não recebe o CRM. Metricas de conclusão agregadas por dia e auditoria privada.
- Push FCM com chave VAPID, registro/renovação por aparelho, retirada no logout, transferência de titularidade ao trocar contas e botão de teste restrito ao próprio aparelho. Worker incluído no build da Vercel, gatilho imediato para alterações e lembretes de 24h/2h pelo Scheduler, respeitando consentimento. Recebimento precisa ser conferido no celular real.
- PWA não armazena respostas do Firebase/API no cache de assets.

## Modelo de dados

`salons/{salonId}` contém owner/estado/plano. Subcoleções: members, professionals, services, units, branding, settings, policies, categories, features, appointments, appointmentHolds, scheduleDays, clients, blocks, auditLogs, metrics, outbox e waitlist.

`users/{uid}` guarda perfil. Subcoleções: salons (favoritos e consentimentos por salão), notifications, devices, provisionRequests e limits. `pushDevices/{sha256(token)}` é um registro privado de titularidade para impedir que o mesmo token continue associado a contas diferentes.

`publicSalons/{salonId}` contém apenas dados publicáveis e um catálogo limitado; `salonSlugs/{slug}` resolve o tenant. Não contém clientes, tokens, pagamentos ou agenda detalhada. `privacyRequests` é privado. `rateLimits` é privado e expira por TTL. `plans` e `platformSettings` estão reservados na política de acesso.

O contrato web existente usa snake_case para entidades; cada caminho é isolado por salonId. Payloads nunca concedem autorização. Claims transportam somente privilégios globais.

## Garantia de concorrência

Cada `scheduleDays/{professionalId}_{YYYY-MM-DD}` guarda intervalos compactos de uma profissional naquele dia. Todos os canais leem e alteram esse documento na mesma transação da reserva. O bloqueio é compartilhado entre unidades. A duração bloqueada inclui limpeza. Esse mecanismo evita depender de uma consulta sem resultados para impedir reservas simultâneas.

Expiração é revalidada com o relógio do servidor. TTL apenas remove lixo; não determina disponibilidade. Reagendamento lê os dias de origem e destino antes de gravar, mantém o horário anterior se o destino conflita e libera a origem na mesma transação. Coleções e catálogo têm limites explícitos para não atingir 1 MiB por documento. Mudanças de preço futuras não alteram o valor já reservado.

## Estado da configuração externa

- App web `Maison Bella Web` registrado.
- Firestore existente em São Paulo.
- Authentication inicializado; e-mail/senha habilitados.
- `agendamento-taupe-mu.vercel.app` autorizado no Authentication.
- Firestore Rules publicadas e compiladas com sucesso.
- Blaze ativo e confirmado pela API. Functions em São Paulo, com dois jobs Scheduler habilitados. Os oito índices compostos estão prontos; as políticas TTL foram enviadas. `deliverBookingUpdate` complementa o Scheduler com entrega imediata de eventos vencidos na criação do outbox.
- Bucket `agendamento-salao-bfe26.firebasestorage.app` criado em São Paulo e regras publicadas. O agente do Storage recebeu o papel específico de consulta ao Firestore usado pelas regras.
- App Check com reCAPTCHA Enterprise, domínio de produção autorizado e tokens de uma hora. Verificação obrigatória na callable, no Firestore e no Storage. O agente do App Check possui seu papel de serviço específico.
- A interface usa Firebase e não oferece mais modo de demonstração. Links antigos com `mode=demo` retornam à entrada real. O PWA inicia em `/`; o `id` original do manifesto foi mantido para preservar a identidade das instalações existentes.
- APIs FCM e FCM Registration habilitadas; chave VAPID pública gerada no Console Firebase e incluída em `shared/push.ts`. A chave privada permanece no Firebase.
- Artifact Registry remove imagens de builds com mais de sete dias para limitar acúmulo de armazenamento.
- Pagamento e WhatsApp ficam pendentes por decisão do usuário. Sinal maior que zero bloqueia confirmação até existir gateway; não há aprovação fictícia.

## Rodar e testar

Requisitos: Node 22, Java 21+, `npm ci` na raiz e `npm ci --prefix functions`.

```sh
npm run test:firebase
npm test
npm run typecheck
npm run build:vercel
```

O primeiro comando inicia emulador do projeto fictício `demo-salon`. Testes recusam execução sem `FIRESTORE_EMULATOR_HOST`; não gravam no projeto real. Cobrem isolamento de tenants/usuários, regras de leitura e escrita, membros revogados, disputa de reservas sobrepostas, limpeza, holds expirados, provisionamento idempotente, políticas, bloqueios e reagendamento atômico.

Para testar a interface: inicie `npm run firebase:emulators`, defina `VITE_FIREBASE_EMULATORS=true` somente no processo local e inicie Vite. Acesse `/`. O frontend recusa usar emuladores fora de localhost/127.0.0.1. A criação de usuários pelos emuladores não envia e-mails reais. O push real usa o build publicado com App Check, sem tokens de debug.

## Publicação após as dependências externas

1. O proprietário ativa Blaze e configura orçamento/alertas no Google Cloud.
2. Registrar o app no App Check com reCAPTCHA Enterprise do domínio. Habilitar a API App Check e a identidade de serviço. Configurar a chave pública em `VITE_FIREBASE_APP_CHECK_SITE_KEY`.
3. Inicializar bucket Storage e publicar `npm run firebase:deploy`. Instalar índices e TTL com o arquivo versionado; aguardar índices prontos.
4. Publicar o frontend com `npm run build:vercel`, incluindo o service worker FCM. Nenhuma service account ou segredo entra no build web.
5. Confirmar no dispositivo: cadastro, criação de salão, upload, reserva em duas contas, reabertura da agenda e regra de cancelamento. Só então habilitar operação real para clientes.
6. FCM: no perfil, ativar notificações e enviar um teste; conferir também com o app em segundo plano. No iPhone/iPad, requer iOS 16.4+ e instalação na Tela de Início. Permissão deve ser concedida pelo próprio usuário. A aceitação do envio pelo FCM não comprova recebimento pelo sistema operacional; não houve homologação em celular conectado neste ambiente.

## Limites e trabalho restante da especificação completa

Validação de produção em 11/09/2026: chamadas sem App Check recusadas; perfil e provisionamento de salão; catálogo em rascunho isolado e catálogo publicado acessível; papel administrativo negado à cliente; disputa simultânea com exatamente uma reserva vencedora; confirmação protegida por titularidade; persistência, reagendamento e cancelamento; upload permitido à proprietária e recusado à cliente; leitura de perfil alheio e escrita direta no Firestore recusadas. A interface publicada também consultou horários e confirmou uma reserva com o provedor Enterprise normal. Contas, salão e imagem de validação são temporários e removidos após os testes; tokens de debug nunca são incluídos no frontend.

Esta entrega é o núcleo Firebase de agendamento web/PWA, não toda a plataforma das 76 seções. Limites iniciais por salão: 150 serviços, 100 profissionais, catálogo público de 700 KB, 400 intervalos por profissional/dia; listas paginadas/limitadas. Esses limites são proteções iniciais, não evidência de capacidade para 100 mil salões.

Ainda pendentes: fluxo nativo completo Expo (o mobile existente continua scaffold), Apple/Google/telefone completos na UI e consoles; App Check nativo, FCM no dispositivo; recursos compartilhados entre profissionais, combos, deslocamento, múltiplas unidades gerenciáveis, agenda semanal/drag-and-drop, paginação de todo histórico/CRM, Salon Builder com tokens avançados e ordenação de módulos; planos/entitlements comerciais, painel visual Super Admin, avaliações agregadas, atendimento da lista de espera, exclusão/exportação integral com retenção, Analytics/Crashlytics/Performance e Remote Config.

Pagamentos, Pix, split, webhook, estorno e WhatsApp oficial ficam para a última etapa. O adaptador e as fixtures de apresentação permanecem apenas para testes legados, sem entrada no aplicativo publicado. Os registros temporários conhecidos de validação, suas subcoleções e a imagem de teste foram removidos com verificação. As filas registram estado real; criar uma notificação interna não comprova envio externo. Jobs têm entrega pelo menos uma vez; tags estáveis reduzem duplicações em retries, sem prometer exatamente uma entrega.

Referências oficiais: [Cloud Functions callable](https://firebase.google.com/docs/functions/callable), [App Check](https://firebase.google.com/docs/app-check/cloud-functions), [testes de Rules](https://firebase.google.com/docs/firestore/security/test-rules-emulator).
