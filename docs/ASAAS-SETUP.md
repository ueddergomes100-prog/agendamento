# Configuração do Asaas

O app usa duas contas separadas no Asaas: a conta da plataforma recebe a mensalidade dos salões; cada salão aprovado recebe os pagamentos de suas clientes na própria subconta, e o repasse para a conta bancária cadastrada é executado pelo agendador.

O app não armazena chave de API no navegador nem no bundle web. A chave da plataforma fica no Secret Manager do Firebase em `ASAAS_CONFIG`. Chaves de subcontas são armazenadas cifradas no Firestore, com a chave de criptografia no Secret Manager.

## Preparar o segredo

No repositório, execute:

```powershell
npm run asaas:config:init
```

O arquivo criado em `work/secrets/asaas-config.json` é ignorado pelo Git. Defina `monthlyCents` em centavos (por exemplo, `7900` para R$ 79,00), confirme `appUrl` e mantenha `environment` como `sandbox` durante o teste.

No painel Asaas, crie uma chave de API em **Integrações > API**. Ela deve ser inserida somente no arquivo temporário local, no campo `apiKey`. Não cole a chave nesta conversa e não a coloque em `.env` do frontend.

Valide o arquivo:

```powershell
npm run asaas:config:validate
```

Depois publique o JSON no Secret Manager. O comando abaixo lê o arquivo e não imprime o valor da chave:

```powershell
firebase functions:secrets:set ASAAS_CONFIG --project agendamento-salao-bfe26 --data-file work/secrets/asaas-config.json
```

Quando a conta de produção estiver aprovada, altere `environment` para `production` e `subaccountsApproved` para `true` somente após a liberação de subcontas pelo Asaas. Faça uma nova versão do segredo; nunca apague a versão anterior antes de verificar o deploy.

## Webhook

Após publicar as funções, cadastre no painel Asaas:

`https://southamerica-east1-agendamento-salao-bfe26.cloudfunctions.net/asaasWebhook`

Use o token `webhookToken` do segredo. Para contas de salões, o app envia uma URL com `?salon=<id>` automaticamente na criação da subconta. O webhook confirma pagamentos apenas depois de consultar o estado atual no Asaas; o redirecionamento da página não é tratado como confirmação.

## Teste seguro

1. Mantenha `enabled: false` até publicar as funções e conferir o painel.
2. Use `sandbox` e uma conta de teste Asaas para criar uma cobrança de atendimento.
3. Abra o checkout, confira o pagamento no painel do salão e simule o webhook.
4. Teste uma reserva paga, uma reserva expirada e um estorno.
5. Cadastre uma subconta sandbox do salão, informe os dados bancários do mesmo titular e teste o repasse com saldo suficiente.
6. Para executar testes reais no sandbox, habilite somente uma configuração com chave de sandbox. Uma chave de produção não serve para o sandbox. Promova para produção apenas após homologação, aprovação cadastral e liberação do modelo de subcontas.

Os testes automatizados atuais usam Firestore Emulator e respostas simuladas do provedor; eles não comprovam a integração com o sandbox real. Antes da ativação, ainda é necessário validar a recorrência de cartão no checkout hospedado, os webhooks da conta principal e os repasses no Asaas. A implementação atual de mensalidade cria `/subscriptions`; a migração e homologação do fluxo `/checkouts` recorrente ainda estão pendentes.

As operações externas têm idempotência e tratamento de resposta ambígua. Se a rede cair depois que o Asaas aceitar uma cobrança ou repasse, o app bloqueia uma repetição automática e mostra a operação para conciliação no histórico.

O valor da mensalidade e a frequência de repasse continuam sendo decisões de negócio: o código já aceita mensalidade em centavos e repasses diário, semanal ou mensal, mas não inventa esses valores.
