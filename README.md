# Maison Bella — plataforma Firebase para salões

Experiência web responsiva com modo de demonstração e modo Firebase. O modo de demonstração usa dados fictícios neste navegador; o modo Firebase usa Authentication, Firestore, Storage e Cloud Functions do projeto `agendamento-salao-bfe26`.

## Iniciar

Requer Node.js 22+ para as Functions e Java 21+ para o Firebase Emulator Suite. Em `H:\app agendamento\app agendamento`:

```powershell
npm install # somente se as dependências não estiverem instaladas
npm run dev -- --port 3000
```

Abra o endereço exibido pelo servidor, normalmente http://localhost:3000/?mode=demo.

## Roteiro de apresentação

1. **Cliente:** abra a home e escolha **Agendar meu momento**. Selecione serviço, extras, profissional, data e horário. Aceite as políticas e confirme. Pix/cartão são explicitamente simulados; pagamento no salão também está disponível.
2. **Confirmação:** adicione o arquivo `.ics` ao calendário ou compartilhe os detalhes pelo menu do dispositivo. Se o compartilhamento nativo estiver indisponível, copie a confirmação.
3. **Agenda:** abra os detalhes, reagende ou cancele uma reserva dentro do prazo. O horário original permanece quando a nova escolha conflita. Check-in fica disponível no dia da visita. O histórico permite avaliar um atendimento concluído.
4. **Relacionamento:** salve profissionais, ajuste a frequência da rotina e guarde inspirações. Rotinas, inspirações e benefícios ficam separados por cliente e salão neste dispositivo.
5. **Gestão:** use o botão **Apresentação**, no canto inferior, para alternar para **Proprietária**. Explore agenda, clientes, equipe, serviços, resultados e identidade. A área **Profissional** oferece a visão dos atendimentos da profissional.
6. **White-label:** mude o preset em **Identidade**, aplique e volte para a experiência da cliente. Também é possível escolher o Atelier Lavender pelo seletor de salão. Experimente o modo escuro.

Use **Apresentação → Recomeçar a demonstração** para restaurar os registros e as preferências demonstrativas. Navegação por `?view=agenda`, `?view=services` etc. pode ser atualizada ou percorrida com voltar/avançar do navegador.

## Validação

```powershell
npm run typecheck
npm test
npm run build
```

Os testes cobrem o núcleo Firebase no emulador (multi-tenancy, regras, holds, concorrência, expiração, bloqueios, políticas, reagendamento, membros revogados e preferências), além do domínio legado e do adaptador de apresentação. Não substituem homologação visual em dispositivos ou testes de produção.

## Limites da entrega

- **Web:** demonstração navegável com dados locais. Disponibilidade demonstrativa não deve ser usada para receber clientes reais ou conciliar reservas entre dispositivos.
- **Produção:** `?mode=live` usa Firebase quando `VITE_FIREBASE_ENABLED=true`; sem essa variável, a URL pública continua no modo demonstrativo. `?mode=demo` sempre força a demonstração.
- **Pagamentos e WhatsApp:** ficam pendentes de provedor e homologação, conforme decisão atual. Serviços com sinal não são confirmados sem gateway; nenhuma mensagem externa é declarada como enviada.
- **iOS/Android:** a pasta `mobile/` ainda contém a base Expo inicial. Esta entrega concentra o front-end web responsivo; não é um aplicativo nativo concluído nem publicado nas lojas.
- **Publicação Sites:** o projeto referenciado em `.openai/hosting.json` não foi encontrado na conta conectada. O vínculo foi preservado; a versão local funciona independentemente dessa publicação.

Consulte `docs/ARCHITECTURE.md` para a arquitetura planejada. Suas descrições de componentes futuros não devem ser interpretadas como comprovação de que integrações ou o app nativo já estejam implementados.

## GitHub e Vercel

Repositório: https://github.com/ueddergomes100-prog/agendamento

A configuração `vercel.json` publica a mesma experiência React como aplicação estática Vite, sem depender do runtime Cloudflare/Sites. Os comandos locais originais permanecem disponíveis.

- Instalação: `npm ci`
- Build da Vercel: `npm run build:vercel`
- Diretório publicado: `dist-vercel`
- Teste local do build: `npm run preview:vercel`
- Node.js: 24.x

Na ausência de `VITE_FIREBASE_ENABLED=true`, a publicação abre em modo demonstrativo. Para liberar o modo real na Vercel, publique as Functions, configure App Check e defina apenas `VITE_FIREBASE_ENABLED=true` e `VITE_FIREBASE_APP_CHECK_SITE_KEY`; a configuração pública do Firebase está versionada e não substitui regras, Authentication ou Functions. Nunca publique credenciais administrativas.

A pasta `mobile/` e a API Express de desenvolvimento não são implantadas na Vercel. A integração Git permite republicar o front-end após novos commits na branch `main`.
