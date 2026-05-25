import { chromium } from 'playwright';
console.log('execPath:', chromium.executablePath());
try {
  const b = await chromium.launch({ headless: true });
  console.log('headless launch OK');
  await b.close();
} catch (e) {
  console.error('headless fail:', e.message);
}
try {
  const b = await chromium.launch({ headless: false, slowMo: 100 });
  console.log('headed launch OK');
  await b.close();
} catch (e) {
  console.error('headed fail:', e.message);
}
