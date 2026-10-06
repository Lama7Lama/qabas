// Use the project's dev dependency or an explicitly supplied external installation.
export async function launchBrowser() {
  const {chromium} = await import(process.env.QABAS_PLAYWRIGHT_MODULE || 'playwright');
  return chromium.launch({headless: true, ...(process.env.QABAS_CHROME ? {executablePath: process.env.QABAS_CHROME} : {})});
}
