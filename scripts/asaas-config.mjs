import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'work', 'secrets', 'asaas-config.json');
const command = process.argv[2] || 'init';

function read() {
  if (!existsSync(output)) throw new Error(`Arquivo não encontrado: ${output}. Execute "init" primeiro.`);
  return JSON.parse(readFileSync(output, 'utf8'));
}

function validate(config) {
  if (typeof config !== 'object' || !config) throw new Error('Configuração inválida.');
  if (!['sandbox', 'production'].includes(config.environment)) throw new Error('environment deve ser sandbox ou production.');
  if (typeof config.encryptionKey !== 'string' || Buffer.from(config.encryptionKey, 'base64').length !== 32) throw new Error('encryptionKey deve ser uma chave base64 de 32 bytes.');
  if (typeof config.webhookToken !== 'string' || config.webhookToken.length < 32) throw new Error('webhookToken deve ter pelo menos 32 caracteres.');
  if (config.enabled && (!config.apiKey || config.apiKey.startsWith('COLE_'))) throw new Error('Não habilite sem uma chave API do Asaas.');
  if (config.environment === 'production' && config.enabled && config.subaccountsApproved !== true) throw new Error('Subcontas ainda não foram aprovadas pelo Asaas.');
  if (config.monthlyCents !== null && (!Number.isInteger(config.monthlyCents) || config.monthlyCents < 100)) throw new Error('monthlyCents deve ser null ou um inteiro de pelo menos 100.');
  return config;
}

if (command === 'init') {
  if (existsSync(output)) throw new Error(`O arquivo já existe: ${output}. Não será sobrescrito.`);
  mkdirSync(dirname(output), { recursive: true });
  const config = {
    enabled: false,
    environment: 'sandbox',
    apiKey: '',
    encryptionKey: randomBytes(32).toString('base64'),
    webhookToken: randomBytes(32).toString('base64url'),
    webhookUrl: 'https://southamerica-east1-agendamento-salao-bfe26.cloudfunctions.net/asaasWebhook',
    appUrl: 'https://agendamento-taupe-mu.vercel.app',
    monthlyCents: null,
    subaccountsApproved: false
  };
  writeFileSync(output, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  console.log(`Modelo seguro criado em ${output}`);
  console.log('Edite apenas fora do repositório: a chave API deve entrar no Secret Manager, nunca no frontend.');
} else if (command === 'validate') {
  const config = validate(read());
  console.log(JSON.stringify({ ...config, apiKey: config.apiKey ? '[present]' : '[missing]', encryptionKey: '[present]', webhookToken: '[present]' }, null, 2));
} else if (command === 'rotate-webhook') {
  const config = read();
  config.webhookToken = randomBytes(32).toString('base64url');
  validate(config);
  writeFileSync(output, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  console.log('Token do webhook renovado no arquivo local. Publique uma nova versão do segredo antes de reativar webhooks.');
} else if (command === 'prepare-disabled') {
  const config = read();
  if (!config.apiKey) throw new Error('Preencha a chave API antes de preparar a configuração.');
  const environment = config.apiKey.includes('_prod_') ? 'production' : config.apiKey.includes('_hmlg_') ? 'sandbox' : null;
  if (!environment) throw new Error('Ambiente da chave desconhecido. Confira no painel antes de publicar.');
  config.environment = environment;
  config.enabled = false;
  validate(config);
  writeFileSync(output, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  console.log(`Configuração preparada para ${environment}, com pagamentos desativados.`);
} else {
  throw new Error('Uso: node scripts/asaas-config.mjs init | validate | rotate-webhook | prepare-disabled');
}
