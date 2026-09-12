# Maison Bella — agendamento web/PWA

Aplicação responsiva conectada ao Firebase (`agendamento-salao-bfe26`), publicada em https://agendamento-taupe-mu.vercel.app/. A entrada usa contas e salões reais. O seletor de demonstração foi removido; links antigos com `mode=demo` retornam à entrada real. Dados legados de apresentação são limpos do navegador sem apagar sessões ou preferências reais.

## Testar o uso

1. Crie sua conta, cadastre o salão e configure profissionais, serviços, horários e políticas.
2. Mantenha o sinal em zero enquanto o gateway está pendente; use pagamento no salão.
3. Publique o salão e abra seu link em outra conta para testar reserva, reagendamento e cancelamento. Os dados cadastrados nesse fluxo são reais e persistentes.
4. Para dar acesso à equipe, a pessoa precisa criar uma conta primeiro. A proprietária pode vinculá-la pelo e-mail na gestão de acessos.
5. No perfil do salão, toque em **Ativar notificações** e permita os alertas. Depois use **Enviar notificação de teste**. A autorização é individual por aparelho.
6. No iPhone/iPad com iOS 16.4+, adicione o site à Tela de Início pelo menu Compartilhar e abra pelo ícone antes de ativar o push. No Android, instale pelo menu do navegador. Teste também com o app em segundo plano.

FCM registra o aparelho, renova seu token ao reabrir e remove o registro no logout. Confirmações/alterações usam um gatilho Firestore; lembretes de 24h/2h passam pelo Scheduler a cada cinco minutos. Permissões, conexão e configurações do sistema afetam o recebimento. Aceitação pelo FCM não comprova entrega no aparelho.

## Desenvolvimento e validação

Requisitos: Node 22+, Java 21+ para emuladores, `npm ci` na raiz e `npm ci --prefix functions`.

```sh
npm run typecheck
npm test
npm run test:firebase
npm run build:vercel
npm run preview:vercel
```

Para desenvolvimento local, inicie `npm run firebase:emulators`, configure `VITE_FIREBASE_EMULATORS=true` no processo local e execute `npm run dev -- --port 3000`. Sem emuladores, configure a chave pública Enterprise de um domínio autorizado. Nunca use credenciais administrativas em variáveis `VITE_`.

Os testes Firebase usam somente `demo-salon` no emulador: isolamento, regras, concorrência, políticas, acessos e titularidade dos aparelhos push. Não substituem a validação em celulares reais. O service worker com FCM é gerado por `build:vercel`; o servidor de desenvolvimento usa o worker básico de cache.

## Publicação e escopo

GitHub: https://github.com/ueddergomes100-prog/agendamento. A Vercel publica `dist-vercel` usando `npm run build:vercel`. A chave pública Enterprise está em `VITE_FIREBASE_APP_CHECK_SITE_KEY`; a configuração Firebase e a chave pública VAPID estão versionadas. Consulte `docs/FIREBASE.md` para infraestrutura e limites.

WhatsApp oficial e gateway de pagamento ficam para a última etapa. Esta entrega é web/PWA instalável; `mobile/` permanece uma base Expo, sem publicação nativa nas lojas. A especificação completa e os componentes futuros em `docs/ARCHITECTURE.md` não representam funcionalidades já entregues.
