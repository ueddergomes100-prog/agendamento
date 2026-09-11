# Maison Bella — arquitetura

## Produto e limites

Aplicativo de clientes para iOS/Android (Expo + Router + TypeScript), experiência web responsiva e áreas de recepção/profissional/proprietária. Uma única API Firebase e o Firestore decidem disponibilidade e gravam reservas de todos os canais. O salão inicial é um estabelecimento fictício de demonstração; seus dados são editáveis e persistidos.

## Camadas

- `shared/`: contratos, cliente da API, formatação e design tokens usados na web e no mobile.
- `app/`, `components/salon/`: experiência web no Sites, sem regras de disponibilidade no navegador.
- `mobile/`: aplicativo Expo com o mesmo contrato de domínio.
- `firebase.json`, `firestore.rules`, `storage.rules`: configuração e isolamento por tenant.
- `functions/`: callable Firebase, transações de reserva, provisionamento, jobs e validações server-side.
- `server/` e `supabase/`: runtime legado mantido para a demonstração histórica e testes de domínio; não é o runtime Firebase de produção.

Produção: Firebase Authentication autentica; a callable `salonApi` valida usuário, tenant, profissão, jornada, duração, antecedência, recursos e conflitos. O cliente usa apenas identificadores públicos; Admin SDK e segredos ficam nas Functions. Desenvolvimento: Firebase Emulator Suite executa as mesmas operações e regras com o projeto fictício `demo-salon`.

## Modelo e multi-tenancy

Organização → salão → unidades. Cada entidade operacional tem `salon_id`. Referências compostas impedem relacionar IDs de salões distintos. Catálogo público é deliberadamente legível; clientes, agenda e financeiro exigem autorização. Identidade da cliente é global; vínculo e preferências são por salão. Papéis: cliente, profissional, recepção, gerente, proprietária; superadmin apenas por concessão administrativa fora do app. Nenhum cadastro público pode conceder papel administrativo.

Firestore Rules negam todas as escritas diretas e isolam leituras por membro/cliente. Escritas críticas acontecem por callable e transações, com validação explícita do `salonId`. Catálogos públicos nunca incluem ficha da cliente.

## Agenda e regras

Instantes são timestamps; jornadas locais são interpretadas com o fuso da unidade. Disponibilidade: interseção entre expediente e jornada, menos pausas, bloqueios e reservas. Duração considera serviço + preparação + limpeza + extras. Um documento `scheduleDays/{professionalId}_{YYYY-MM-DD}` por profissional serializa confirmação/hold/reagendamento. Um hold de cinco minutos ocupa a agenda. Expiração é revalidada em cada leitura/escrita e pode ser antecipada pelo job. Reagendamento valida o novo intervalo e atualiza em uma transação: rollback preserva o anterior. Limites e políticas são lidos no servidor, nunca aceitos do cliente.

Preços são inteiros em centavos. Confirmação referencia o hold pertencente ao usuário. Só serviços com pagamento presencial podem ser confirmados sem provedor. Serviços com sinal exigem payment intent aprovado por webhook verificado. Nenhuma tela simula pagamento aprovado.

## Integrações

Outbox transacional registra eventos de agendamento. Um worker com chave administrativa processa entregas com chave idempotente, tentativas, backoff e dead letter. WhatsApp usa templates aprovados e consentimento; push usa Expo. Gateway de pagamento usa idempotência e webhook assinado, com revalidação de valor/moeda/tenant. Quando credenciais não estão configuradas, a interface informa a indisponibilidade. Calendário via ICS é gerado apenas ao toque da cliente.

## Design system

Presets Rose, Champagne, Blossom, Noir, Clean e Lavender. `ThemeProvider` deriva tokens por salão, incluindo modo escuro, fontes, raios e espaçamentos. Cores não pertencem às telas. Tipografia editorial para títulos e sans-serif para leitura, superfícies arredondadas, fotografias de beleza, movimento discreto e suporte a reduced motion. A navegação da cliente é horizontal/bottom bar, separada das ferramentas de gestão.

## Entrega e fases

Prioridade: MVP executável com autenticação, descoberta, catálogo, profissional, slots reais, hold, confirmação, cancelamento, reagendamento, check-in, histórico, avaliação, recepção, cadastro de serviços/profissionais e identidade. Integrações externas dependem de configuração de provedores e contas. Fases 2/3 (gift cards, assinatura recorrente, IA conversacional, publicação white-label individual) não devem ser apresentadas como concluídas sem implementação e homologação.

## Validação

Testes de domínio executam PostgreSQL real embarcado: concorrência, isolamento, tenant cruzado, autorização, duração, bloqueios, cancelamento e reagendamento atômico. Typecheck web/mobile e build web/native bundle. Build não comprova publicação nas lojas nem entrega externa de WhatsApp/push/pagamento. RLS também deve ser homologada no projeto Supabase antes de produção.

Referências técnicas: https://firebase.google.com/docs/functions/callable, https://firebase.google.com/docs/firestore/security/rules-conditions e https://docs.expo.dev/get-started/create-a-project/.
