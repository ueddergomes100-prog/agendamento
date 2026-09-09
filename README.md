# Maison Bella — apresentação do front-end

Experiência web responsiva para demonstrar o produto no computador ou em uma tela de celular. Os dados de demonstração são fictícios, persistidos neste navegador e separados da API de produção.

## Iniciar

Requer Node.js 24. Em `H:\app agendamento\app agendamento`:

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

Os testes cobrem o domínio PostgreSQL existente e o adaptador de apresentação, incluindo concorrência na mesma sessão, persistência, cancelamento, reagendamento, liberação de reserva, extras, preferências e separação dos dados de clientes. Não substituem homologação visual em dispositivos ou testes de produção.

## Limites da entrega

- **Web:** demonstração navegável com dados locais. Disponibilidade demonstrativa não deve ser usada para receber clientes reais ou conciliar reservas entre dispositivos.
- **Produção:** configure as variáveis públicas do Supabase. `?mode=live` usa Supabase quando configurado ou a API local na porta 4318. Sem credenciais, o modo padrão é demonstrativo; `?mode=demo` sempre força a demonstração.
- **Pagamentos, WhatsApp e push:** dependem de provedores e homologação. Na apresentação não há cobranças nem envios externos.
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

Na ausência das variáveis Supabase, a publicação abre em modo demonstrativo. Cada navegador mantém seus próprios dados fictícios; reservas feitas em um dispositivo não aparecem em outro. Configure `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` na Vercel somente quando o backend estiver pronto para uso real. Nunca publique chaves administrativas.

A pasta `mobile/` e a API Express de desenvolvimento não são implantadas na Vercel. A integração Git permite republicar o front-end após novos commits na branch `main`.
