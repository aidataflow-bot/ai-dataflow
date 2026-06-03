const { chromium } = require('playwright');
const fs = require('fs');

const baseUrl = process.env.BASE_URL || 'http://localhost:4173';
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: fs.existsSync(chromePath) ? chromePath : undefined
  });
  const page = await browser.newPage();
  const errors = [];

  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400 && response.url().includes('/api/') && !response.url().includes('/api/recommendations/analyze')) {
      errors.push(`${response.status()} ${response.url()}`);
    }
  });

  const suffix = Date.now().toString().slice(-6);
  const email = `qa${suffix}@aidataflow.test`;
  const password = `StrongPass${suffix}!`;
  const company = `Acme Automation ${suffix}`;

  await page.goto(`${baseUrl}/register.html`);
  await page.fill('#firstName', 'QA');
  await page.fill('#lastName', 'User');
  await page.fill('#company', 'AI DataFlow QA');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.fill('#confirmPassword', password);
  await page.check('input[name="terms"]');
  await page.click('#registerForm button[type="submit"]');
  await page.waitForURL('**/dashboard.html');

  await page.goto(`${baseUrl}/clients.html`);
  await page.click('#addClientBtn');
  await page.fill('#companyName', company);
  await page.fill('#contactName', 'Jordan Lee');
  await page.fill('#email', `jordan${suffix}@acme.test`);
  await page.selectOption('#industry', 'technology');
  await page.click('#saveClientBtn');
  await page.waitForSelector(`text=${company}`);

  await page.locator('.client-card', { hasText: company }).click();
  await page.waitForURL('**/client-detail.html?id=*');
  const clientId = new URL(page.url()).searchParams.get('id');
  if (!clientId) throw new Error('Client detail URL did not include a client id');

  await page.getByText('Edit Client').click();
  await page.waitForURL('**/clients.html?edit=*');
  await page.waitForSelector('#clientModal', { state: 'visible' });

  await page.goto(`${baseUrl}/client-detail.html?id=${encodeURIComponent(clientId)}`);
  await page.getByText('New Analysis for Client').click();
  await page.waitForURL('**/recommendations.html');
  const selectedClientId = await page.inputValue('#clientSelect');
  if (selectedClientId !== clientId) {
    throw new Error(`Expected selected client ${clientId}, got ${selectedClientId}`);
  }

  await page.selectOption('#processArea', 'automation');
  await page.fill(
    '#processDescription',
    'Manual intake and invoice routing are slowing the team down. We need a repeatable automation roadmap with quick wins.'
  );
  await page.check('input[name="goals"][value="improve-efficiency"]');
  await page.click('#analyzeBtn');

  if (process.env.OPENAI_API_KEY) {
    await page.waitForSelector('#resultsSection', { state: 'visible', timeout: 30000 });
  } else {
    await page.waitForSelector('text=AI is not configured', { timeout: 10000 });
  }

  if (errors.length > 0) {
    throw new Error(`Browser/API errors: ${errors.join(' | ')}`);
  }

  await browser.close();
  console.log('Production smoke test passed');
  console.log(JSON.stringify({ email, company, clientId, aiConfigured: Boolean(process.env.OPENAI_API_KEY) }, null, 2));
})().catch(async error => {
  console.error(error);
  process.exit(1);
});
